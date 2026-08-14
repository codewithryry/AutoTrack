import * as db from './db'
import { COLLECTIONS } from './db'
import * as activity from './activity'
import * as notifications from './notifications'
import { ValidationError } from './tools'
import {
  ACTIVE_TXN_STATUSES,
  ACTIVITY,
  CONDITION,
  RETURN_CONDITIONS,
  TOOL_STATUS,
  TXN_STATUS,
} from '../utils/constants'
import { PERM, assertCan, can, canBorrowFor, canReturnTransaction } from '../utils/permissions'
import { generateTxnId, matchesQuery, sortBy } from '../utils/helpers'
import {
  daysBetween,
  isOverdue,
  isDueSoon,
  nowISO,
  startOfDay,
  toDate,
  withinRange,
} from '../utils/dates'

/**
 * Borrow / return / overdue engine.
 *
 * A borrow or return is never a single write. Each one performs the full set of
 * side effects — transaction, tool status, activity log, notification — so the
 * dashboard, the tool page and the notification centre can never disagree about
 * where a tool is.
 *
 * The two writes that must not drift — the loan record and the tool's status —
 * go through `db.runAtomic()`, which rolls back on failure. It re-reads the tool
 * inside the transaction, so two tabs (or two students at the crib) cannot both
 * check out the same wrench: the second commit sees the tool is no longer
 * available and fails instead of overwriting.
 *
 * Reads are scoped by role in the data layer, so a student's queries here only
 * ever return their own loans.
 */

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listAll() {
  return sortBy(await db.list(COLLECTIONS.transactions), 'borrowDate', 'desc')
}

export async function getById(id) {
  return db.get(COLLECTIONS.transactions, id)
}

export async function listForTool(toolId) {
  const rows = await db.query(COLLECTIONS.transactions, (t) => t.toolId === toolId)
  return sortBy(rows, 'borrowDate', 'desc')
}

export async function listForUser(userId) {
  const rows = await db.query(COLLECTIONS.transactions, (t) => t.userId === userId)
  return sortBy(rows, 'borrowDate', 'desc')
}

export async function listActive() {
  const rows = await db.query(COLLECTIONS.transactions, (t) =>
    ACTIVE_TXN_STATUSES.includes(t.status),
  )
  return sortBy(rows, 'dueDate', 'asc')
}

/**
 * The open loan for a tool, if any.
 *
 * Staff get a targeted server-side query; a student sees only their own loans,
 * because the rules do not let them read anybody else's.
 */
export async function findActiveForTool(toolId, actor) {
  // Falls back to the session's role rather than to "see everything" when no
  // actor is passed: an unfiltered query would be rejected for a student.
  const viewer = actor ?? { role: db.currentScope().role }
  const rows = can(viewer, PERM.TXN_VIEW_ALL)
    ? await db.findWhere(COLLECTIONS.transactions, [['toolId', '==', toolId]])
    : await db.query(COLLECTIONS.transactions, (t) => t.toolId === toolId)

  return sortBy(
    rows.filter((t) => ACTIVE_TXN_STATUSES.includes(t.status)),
    'borrowDate',
    'desc',
  )[0] ?? null
}

export async function listOverdue() {
  return (await listActive()).filter((t) => t.status === TXN_STATUS.OVERDUE)
}

const SEARCH_FIELDS = ['id', 'toolId', 'toolName', 'userName', 'purpose', 'notes']

export function filterTransactions(
  rows,
  { search, status, userId, toolId, from, to, sort } = {},
) {
  let out = rows.filter((txn) => {
    if (status && status !== 'all' && txn.status !== status) return false
    if (userId && userId !== 'all' && txn.userId !== userId) return false
    if (toolId && toolId !== 'all' && txn.toolId !== toolId) return false
    if ((from || to) && !withinRange(txn.borrowDate, from, to)) return false
    return matchesQuery(txn, search, SEARCH_FIELDS)
  })

  switch (sort) {
    case 'oldest':
      out = sortBy(out, 'borrowDate', 'asc')
      break
    case 'due-soonest':
      out = sortBy(out, 'dueDate', 'asc')
      break
    case 'tool':
      out = sortBy(out, 'toolName', 'asc')
      break
    case 'borrower':
      out = sortBy(out, 'userName', 'asc')
      break
    case 'newest':
    default:
      out = sortBy(out, 'borrowDate', 'desc')
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Location
 *
 * A loan carries three separate things, and they are never merged:
 *
 *   borrowLocation        where the tool changed hands, at the moment it did
 *   locationCheckpoints   readings the borrower chose to record while it was out
 *   returnLocation        where it was handed back, at the moment it was
 *
 * Each one is a single fix with its own timestamp. None of them describes where
 * the tool was at any other time, and nothing here is ever written without a
 * person having just pressed something — there is no sweep, no timer and no
 * background write anywhere in this module.
 * ------------------------------------------------------------------ */

/** Columns added by `0008_location_checkpoints.sql`. */
const LOCATION_COLUMN = 'borrowLocation'
const MAX_CHECKPOINTS = 100

/**
 * Whether this database has had the location migration applied.
 *
 * Until it has, every location write is skipped and the borrow, return and
 * transaction flows behave exactly as they did before — an un-migrated project
 * loses the new feature, never the working one.
 */
export const locationTrackingAvailable = () =>
  db.supportsColumn(COLLECTIONS.transactions, LOCATION_COLUMN)

/** Strip a captured reading down to what is stored, with the actor stamped on. */
function toStoredLocation(location, actor, note) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null
  return {
    lat: location.lat,
    lng: location.lng,
    accuracy: Number.isFinite(location.accuracy) ? location.accuracy : null,
    capturedAt: location.capturedAt ?? nowISO(),
    capturedById: actor?.id ?? null,
    capturedByName: actor?.fullName ?? null,
    ...(note ? { note: String(note).slice(0, 200) } : {}),
  }
}

export const checkpointsOf = (txn) =>
  Array.isArray(txn?.locationCheckpoints) ? txn.locationCheckpoints : []

/**
 * Record where the tool is right now, on a loan that is still open.
 *
 * This is the only way a point is added mid-loan, and it exists solely so a
 * borrower can answer "where is it now?" on purpose. It is one append of one
 * reading; calling it again later appends another. Nothing calls it on a
 * schedule.
 *
 * The borrower may do this for their own loan, and staff for any loan — the same
 * split the database enforces in `transactions_guard_borrower_update()`. No new
 * permission is introduced: `PERM.RETURN` is what a role needs to act on a loan
 * it holds, and `PERM.TXN_EDIT` is what staff already need to correct one.
 */
export async function addLocationCheckpoint(
  { transactionId, location, note = '' },
  actor,
) {
  const txn = await getById(transactionId)
  if (!txn) throw new Error('Transaction not found.')
  if (!ACTIVE_TXN_STATUSES.includes(txn.status)) {
    throw new Error('This loan is closed, so its location can no longer be updated.')
  }
  // Exactly who may close this loan may also say where the tool is: the
  // borrower, or staff. `canReturnTransaction` is that rule, unchanged.
  if (!canReturnTransaction(actor, txn)) {
    throw new Error('You can only record the location of a tool you borrowed yourself.')
  }

  const entry = toStoredLocation(location, actor, note)
  if (!entry) throw new Error('No usable location reading was provided.')

  if (!(await locationTrackingAvailable())) {
    throw new Error(
      'Location checkpoints are not enabled on this database yet. Ask an administrator to apply the latest migration.',
    )
  }

  const existing = checkpointsOf(txn)
  if (existing.length >= MAX_CHECKPOINTS) {
    throw new Error(
      `This loan already has the maximum of ${MAX_CHECKPOINTS} location checkpoints.`,
    )
  }

  // Append only — the guard trigger rejects an update that drops or rewrites an
  // entry, so the list can only ever grow.
  const updated = await db.update(COLLECTIONS.transactions, txn.id, {
    locationCheckpoints: [...existing, entry],
    updatedAt: nowISO(),
  })

  await afterWrite('location checkpoint follow-up', async () => {
    await activity.log({
      action: ACTIVITY.STATUS_CHANGED,
      toolId: txn.toolId,
      toolName: txn.toolName,
      userId: actor?.id,
      userName: actor?.fullName,
      transactionId: txn.id,
      message: `Location checkpoint recorded while the tool was out with ${txn.userName}.`,
      meta: { checkpoint: existing.length + 1, accuracy: entry.accuracy },
    })
  })

  return updated
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export function validateBorrow({ toolId, userId, borrowDate, dueDate, purpose }, { maxDays = 30 } = {}) {
  const errors = {}
  if (!toolId) errors.toolId = 'Select a tool.'
  if (!userId) errors.userId = 'Select the borrower.'

  const borrow = toDate(borrowDate)
  const due = toDate(dueDate)

  if (!borrowDate) errors.borrowDate = 'Borrow date is required.'
  else if (!borrow) errors.borrowDate = 'Enter a valid borrow date.'

  if (!dueDate) errors.dueDate = 'Due date is required.'
  else if (!due) errors.dueDate = 'Enter a valid due date.'

  if (borrow && due) {
    if (startOfDay(due) < startOfDay(borrow)) {
      errors.dueDate = 'Due date cannot be before the borrow date.'
    } else if (daysBetween(borrow, due) > maxDays) {
      errors.dueDate = `A tool cannot be borrowed for more than ${maxDays} days.`
    }
  }
  if (borrow && daysBetween(new Date(), borrow) > 0) {
    errors.borrowDate = 'Borrow date cannot be in the future.'
  }
  if (purpose && purpose.length > 300) errors.purpose = 'Purpose is too long (max 300).'

  return errors
}

/* ------------------------------------------------------------------ *
 * Borrow
 * ------------------------------------------------------------------ */

/**
 * Issue a tool.
 *
 * The transaction record and the tool's status change together inside one
 * atomic step, which re-checks availability before committing. Everything
 * after that — activity entry, notifications — is follow-up: a failure there is
 * logged but does not undo a completed loan.
 */
export async function borrow(input, actor, { maxDays = 30 } = {}) {
  assertCan(actor, PERM.BORROW, 'Your role is not allowed to borrow tools.')

  const errors = validateBorrow(input, { maxDays })
  if (Object.keys(errors).length) throw new ValidationError(errors)

  if (!canBorrowFor(actor, input.userId)) {
    throw new Error('Students can only borrow tools for themselves.')
  }

  // Borrowing for yourself uses the session profile: a student is not allowed to
  // read anyone else's, and does not need to.
  const user =
    input.userId === actor?.id ? actor : await db.get(COLLECTIONS.users, input.userId)
  if (!user) throw new Error('Borrower not found.')
  if (user.status && user.status !== 'Active') {
    throw new Error(`${user.fullName}'s account is ${user.status.toLowerCase()} and cannot borrow.`)
  }

  // A friendlier message than "not available" when staff can see who has it.
  if (can(actor, PERM.TXN_VIEW_ALL)) {
    const openLoan = await findActiveForTool(input.toolId, actor)
    if (openLoan) throw new Error(`${openLoan.toolName} is already issued to ${openLoan.userName}.`)
  }

  const timestamp = nowISO()

  // Where the tool was handed over, if the borrower agreed to a reading and the
  // database has somewhere to keep it. A refusal, a failed fix or a pending
  // migration all land here as `null`, and the loan proceeds unchanged.
  const borrowLocation = (await locationTrackingAvailable())
    ? toStoredLocation(input.borrowLocation, actor)
    : null

  const { record, tool } = await db.runAtomic(async (atomic) => {
    const tool = await atomic.get(COLLECTIONS.tools, input.toolId)
    if (!tool) throw new Error('Tool not found. Please check the QR code.')

    if (tool.status !== TOOL_STATUS.AVAILABLE) {
      throw new Error(
        tool.status === TOOL_STATUS.MAINTENANCE
          ? 'This tool is currently under maintenance.'
          : `${tool.name} is not available (${tool.status}).`,
      )
    }

    const record = {
      id: generateTxnId(toDate(input.borrowDate) ?? new Date()),
      toolId: tool.id,
      toolName: tool.name,
      toolCategory: tool.category,
      userId: user.id,
      userName: user.fullName,
      userRole: user.role,
      borrowDate: input.borrowDate,
      dueDate: input.dueDate,
      returnDate: null,
      status: TXN_STATUS.BORROWED,
      conditionOut: tool.condition,
      conditionIn: null,
      purpose: input.purpose?.trim() ?? '',
      notes: input.notes?.trim() ?? '',
      issuedById: actor?.id ?? null,
      issuedByName: actor?.fullName ?? null,
      receivedById: null,
      receivedByName: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      // Omitted entirely when the migration is not applied, so the insert never
      // names a column this database does not have.
      ...(borrowLocation ? { borrowLocation, locationCheckpoints: [] } : {}),
    }

    atomic.set(COLLECTIONS.transactions, record)
    // `currentBorrowerId` is what the security rules use to let the borrower —
    // and only the borrower — hand this tool back again.
    atomic.update(COLLECTIONS.tools, tool.id, {
      status: TOOL_STATUS.BORROWED,
      currentBorrowerId: user.id,
      currentTransactionId: record.id,
      updatedAt: timestamp,
    })

    // The tool is carried out for the notification copy below.
    return { record, tool }
  })

  await afterWrite('borrow follow-up', async () => {
    await activity.log({
      action: ACTIVITY.TOOL_BORROWED,
      toolId: record.toolId,
      toolName: record.toolName,
      userId: user.id,
      userName: user.fullName,
      transactionId: record.id,
      message: `${user.fullName} borrowed the tool${
        input.purpose ? ` for ${input.purpose}` : ''
      }.`,
      meta: { dueDate: record.dueDate, issuedBy: actor?.fullName ?? null },
    })

    await notifications.create(
      addressed(notifications.templates.borrowed(tool, record, user), actor, user.id),
    )

    // If it is already due within the warning window, say so immediately.
    if (isDueSoon(record.dueDate, 1)) {
      await notifications.create(notifications.templates.dueSoon(tool, record, user))
    }
  })

  return record
}

/**
 * Run the bookkeeping that follows a committed loan or return.
 *
 * The tool has physically changed hands by this point, so a failed activity
 * entry or notification must not surface as "the borrow failed". It is reported
 * to the console instead.
 */
async function afterWrite(label, fn) {
  try {
    await fn()
  } catch (err) {
    console.error(`[transactions] ${label} incomplete`, err)
  }
}

/**
 * Address a notification.
 *
 * Staff actions raise a laboratory-wide alert (`userId: null`), which is what the
 * tool room wants to see. A student acting for themselves gets a personal
 * confirmation instead: the security rules only let them notify themselves, so
 * that one account cannot fill every notification centre with broadcasts nobody
 * else is able to delete. Staff still see the loan itself in transactions and the
 * activity log.
 */
function addressed(input, actor, recipientId) {
  return can(actor, PERM.TXN_VIEW_ALL) ? input : { ...input, userId: recipientId }
}

/* ------------------------------------------------------------------ *
 * Return
 * ------------------------------------------------------------------ */

/**
 * Take a tool back.
 *
 * A damaged return pulls the tool out of circulation rather than returning it
 * to the Available pool, and marks the transaction itself as Damaged so the
 * report on breakages stays accurate.
 */
export async function returnTool({ transactionId, condition, notes, returnLocation }, actor) {
  assertCan(actor, PERM.RETURN, 'Your role is not allowed to return tools.')

  const txn = await getById(transactionId)
  if (!txn) throw new Error('Transaction not found.')
  if (!ACTIVE_TXN_STATUSES.includes(txn.status)) {
    throw new Error('This tool is not currently borrowed, so it cannot be returned.')
  }
  if (!canReturnTransaction(actor, txn)) {
    throw new Error('You can only return tools that you borrowed yourself.')
  }
  if (!RETURN_CONDITIONS.includes(condition)) {
    throw new ValidationError({ condition: 'Select the condition of the returned tool.' })
  }

  const timestamp = nowISO()
  const damaged = condition === CONDITION.DAMAGED
  const wasOverdue = txn.status === TXN_STATUS.OVERDUE

  // Where it came back, on the same terms as the borrow point: optional, and
  // never a reason for the return to fail.
  const closingLocation = (await locationTrackingAvailable())
    ? toStoredLocation(returnLocation, actor)
    : null

  const patch = {
    ...(closingLocation ? { returnLocation: closingLocation } : {}),
    returnDate: timestamp,
    status: damaged ? TXN_STATUS.DAMAGED : TXN_STATUS.RETURNED,
    conditionIn: condition,
    wasOverdue,
    notes: [txn.notes, notes?.trim()].filter(Boolean).join(' — '),
    receivedById: actor?.id ?? null,
    receivedByName: actor?.fullName ?? null,
    updatedAt: timestamp,
  }

  // Closing the loan and putting the tool back (or pulling it out of service)
  // is one atomic step, so the tool can never be left "Borrowed" against a
  // closed transaction.
  const tool = await db.runAtomic(async (atomic) => {
    const current = await atomic.get(COLLECTIONS.transactions, txn.id)
    if (!current) throw new Error('Transaction not found.')
    if (!ACTIVE_TXN_STATUSES.includes(current.status)) {
      throw new Error('This tool has already been returned.')
    }

    atomic.update(COLLECTIONS.transactions, txn.id, patch)

    const toolRecord = await atomic.get(COLLECTIONS.tools, current.toolId)
    if (toolRecord) {
      atomic.update(COLLECTIONS.tools, toolRecord.id, {
        status: damaged ? TOOL_STATUS.DAMAGED : TOOL_STATUS.AVAILABLE,
        condition,
        currentBorrowerId: null,
        currentTransactionId: null,
        updatedAt: timestamp,
      })
    }
    return toolRecord
  })

  const updatedTxn = { ...txn, ...patch }

  if (tool) {
    await afterWrite('return follow-up', async () => {
      await activity.log({
        action: ACTIVITY.TOOL_RETURNED,
        toolId: tool.id,
        toolName: tool.name,
        userId: txn.userId,
        userName: txn.userName,
        transactionId: txn.id,
        message: damaged
          ? `Tool returned damaged by ${txn.userName} and removed from circulation.`
          : `Tool returned by ${txn.userName}${wasOverdue ? ' (was overdue)' : ''}.`,
        meta: { condition, wasOverdue },
      })

      if (tool.condition !== condition) {
        await activity.log({
          action: ACTIVITY.CONDITION_CHANGED,
          toolId: tool.id,
          toolName: tool.name,
          userId: actor?.id,
          userName: actor?.fullName,
          transactionId: txn.id,
          message: `Condition changed from ${tool.condition} to ${condition}.`,
          meta: { from: tool.condition, to: condition },
        })
      }

      const borrower = txn.userId === actor?.id ? actor : { fullName: txn.userName }
      const template = damaged
        ? notifications.templates.damaged(tool, updatedTxn, borrower)
        : notifications.templates.returned(tool, updatedTxn, borrower)
      await notifications.create(addressed(template, actor, txn.userId))

      // The loan is closed, so its overdue/due-soon alerts are no longer
      // actionable. A student may not delete laboratory-wide alerts, so this is
      // deliberately best-effort.
      await clearAlertsFor(txn.id)
    })
  }

  return updatedTxn
}

/** Remove the open alerts tied to a transaction once it is closed. */
async function clearAlertsFor(transactionId) {
  try {
    await db.removeWhere(
      COLLECTIONS.notifications,
      (n) =>
        n.dedupeKey === `overdue:${transactionId}` || n.dedupeKey === `due-soon:${transactionId}`,
    )
  } catch (err) {
    console.warn('[transactions] closed-loan alerts could not be cleared', err)
  }
}

/* ------------------------------------------------------------------ *
 * Overdue sweep
 * ------------------------------------------------------------------ */

/**
 * Reconcile every open loan against today's date.
 *
 * Runs when staff open the app and when the tab regains focus. It flips due
 * loans to Overdue, syncs the tool status, and raises one notification per event
 * — deduplicated by transaction id so repeated sweeps stay quiet.
 *
 * Staff only: it writes to transactions and tools, which the security rules do
 * not allow a student to do. A student's own late loan is still shown as overdue
 * by the due-date comparison in the UI.
 *
 * @returns {{ overdue: number, dueSoon: number, skipped?: boolean }}
 */
export async function runOverdueCheck({ dueSoonThresholdDays = 1, notify = true } = {}) {
  const { role } = db.currentScope()
  if (!can({ role }, PERM.TXN_EDIT)) return { overdue: 0, dueSoon: 0, skipped: true }

  const active = await listActive()
  let overdueCount = 0
  let dueSoonCount = 0

  for (const txn of active) {
    const tool = await db.get(COLLECTIONS.tools, txn.toolId)

    if (isOverdue(txn.dueDate)) {
      overdueCount++

      if (txn.status !== TXN_STATUS.OVERDUE) {
        await db.update(COLLECTIONS.transactions, txn.id, {
          status: TXN_STATUS.OVERDUE,
          updatedAt: nowISO(),
        })
        if (tool) {
          await activity.log({
            action: ACTIVITY.TOOL_OVERDUE,
            toolId: tool.id,
            toolName: tool.name,
            userId: txn.userId,
            userName: txn.userName,
            transactionId: txn.id,
            message: `Tool became overdue — it was due on ${new Date(
              txn.dueDate,
            ).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`,
          })
        }
      }

      // The tool record follows the transaction, even if it drifted.
      if (tool && tool.status !== TOOL_STATUS.OVERDUE) {
        await db.update(COLLECTIONS.tools, tool.id, {
          status: TOOL_STATUS.OVERDUE,
          updatedAt: nowISO(),
        })
      }

      if (notify && tool) {
        const user = await db.get(COLLECTIONS.users, txn.userId)
        await notifications.create(notifications.templates.overdue(tool, txn, user))
      }
    } else if (isDueSoon(txn.dueDate, dueSoonThresholdDays)) {
      dueSoonCount++
      if (notify && tool) {
        const user = await db.get(COLLECTIONS.users, txn.userId)
        await notifications.create(notifications.templates.dueSoon(tool, txn, user))
      }
    }
  }

  return { overdue: overdueCount, dueSoon: dueSoonCount }
}

/* ------------------------------------------------------------------ *
 * Administrative corrections
 * ------------------------------------------------------------------ */

/** Mark an overdue loan as lost. Admin/instructor only. */
export async function markLost(transactionId, actor, note) {
  assertCan(actor, PERM.TXN_EDIT, 'Only an administrator can write off a tool as lost.')

  const txn = await getById(transactionId)
  if (!txn) throw new Error('Transaction not found.')
  if (!ACTIVE_TXN_STATUSES.includes(txn.status)) {
    throw new Error('Only an open transaction can be marked as lost.')
  }

  const timestamp = nowISO()
  const updated = await db.update(COLLECTIONS.transactions, txn.id, {
    status: TXN_STATUS.LOST,
    notes: [txn.notes, note].filter(Boolean).join(' — '),
    updatedAt: timestamp,
  })

  const tool = await db.get(COLLECTIONS.tools, txn.toolId)
  if (tool) {
    await db.update(COLLECTIONS.tools, tool.id, {
      status: TOOL_STATUS.LOST,
      currentBorrowerId: null,
      currentTransactionId: null,
      updatedAt: timestamp,
    })
    await activity.log({
      action: ACTIVITY.STATUS_CHANGED,
      toolId: tool.id,
      toolName: tool.name,
      userId: actor?.id,
      userName: actor?.fullName,
      transactionId: txn.id,
      message: `Tool reported lost while borrowed by ${txn.userName}.`,
      meta: { from: tool.status, to: TOOL_STATUS.LOST },
    })
    await notifications.create(
      notifications.templates.statusChanged(tool, tool.status, TOOL_STATUS.LOST),
    )
  }
  await clearAlertsFor(txn.id)
  return updated
}

/** Extend a due date — instructors granting more laboratory time. */
export async function extendDueDate(transactionId, newDueDate, actor) {
  assertCan(actor, PERM.TXN_EDIT, 'Only an administrator can extend a due date.')

  const txn = await getById(transactionId)
  if (!txn) throw new Error('Transaction not found.')
  if (!ACTIVE_TXN_STATUSES.includes(txn.status)) {
    throw new Error('Only an open transaction can be extended.')
  }
  const due = toDate(newDueDate)
  if (!due) throw new ValidationError({ dueDate: 'Enter a valid due date.' })
  if (startOfDay(due) < startOfDay(txn.borrowDate)) {
    throw new ValidationError({ dueDate: 'Due date cannot be before the borrow date.' })
  }

  const stillOverdue = isOverdue(newDueDate)
  const updated = await db.update(COLLECTIONS.transactions, txn.id, {
    dueDate: newDueDate,
    status: stillOverdue ? TXN_STATUS.OVERDUE : TXN_STATUS.BORROWED,
    updatedAt: nowISO(),
  })

  const tool = await db.get(COLLECTIONS.tools, txn.toolId)
  if (tool) {
    await db.update(COLLECTIONS.tools, tool.id, {
      status: stillOverdue ? TOOL_STATUS.OVERDUE : TOOL_STATUS.BORROWED,
      updatedAt: nowISO(),
    })
    await activity.log({
      action: ACTIVITY.STATUS_CHANGED,
      toolId: tool.id,
      toolName: tool.name,
      userId: actor?.id,
      userName: actor?.fullName,
      transactionId: txn.id,
      message: `Due date extended to ${new Date(newDueDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })}.`,
    })
  }
  if (!stillOverdue) await clearAlertsFor(txn.id)
  return updated
}

/**
 * Everything a return screen needs, resolved from a tool id.
 *
 * The borrower's profile is a bonus: a student scanning a tool that somebody
 * else has out may not read that profile, and does not need to — the loan record
 * already carries the borrower's name.
 */
export async function activeLoanContext(toolId, actor) {
  const txn = await findActiveForTool(toolId, actor)
  if (!txn) return null
  const tool = await db.get(COLLECTIONS.tools, txn.toolId)
  const borrower =
    txn.userId === actor?.id
      ? actor
      : await db.get(COLLECTIONS.users, txn.userId).catch(() => null)
  return { transaction: txn, tool, borrower: borrower ?? { id: txn.userId, fullName: txn.userName } }
}
