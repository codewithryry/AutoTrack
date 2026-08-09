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
import { PERM, assertCan, canBorrowFor, canReturnTransaction } from '../utils/permissions'
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

/** The open loan for a tool, if any. */
export async function findActiveForTool(toolId) {
  const rows = await db.query(
    COLLECTIONS.transactions,
    (t) => t.toolId === toolId && ACTIVE_TXN_STATUSES.includes(t.status),
  )
  return sortBy(rows, 'borrowDate', 'desc')[0] ?? null
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
 * Side effects, in order: create the transaction, flip the tool to Borrowed,
 * write an activity entry, raise a notification.
 */
export async function borrow(input, actor, { maxDays = 30 } = {}) {
  assertCan(actor, PERM.BORROW, 'Your role is not allowed to borrow tools.')

  const errors = validateBorrow(input, { maxDays })
  if (Object.keys(errors).length) throw new ValidationError(errors)

  if (!canBorrowFor(actor, input.userId)) {
    throw new Error('Students can only borrow tools for themselves.')
  }

  const tool = await db.get(COLLECTIONS.tools, input.toolId)
  if (!tool) throw new Error('Tool not found. Please check the QR code.')

  if (tool.status !== TOOL_STATUS.AVAILABLE) {
    throw new Error(
      tool.status === TOOL_STATUS.MAINTENANCE
        ? 'This tool is currently under maintenance.'
        : `${tool.name} is not available (${tool.status}).`,
    )
  }

  // Guard against a double-issue caused by two tabs or a double-tap.
  const openLoan = await findActiveForTool(tool.id)
  if (openLoan) {
    throw new Error(`${tool.name} is already issued to ${openLoan.userName}.`)
  }

  const user = await db.get(COLLECTIONS.users, input.userId)
  if (!user) throw new Error('Borrower not found.')
  if (user.status && user.status !== 'Active') {
    throw new Error(`${user.fullName}'s account is ${user.status.toLowerCase()} and cannot borrow.`)
  }

  const timestamp = nowISO()
  const txn = {
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
  }

  await db.insert(COLLECTIONS.transactions, txn)
  await db.update(COLLECTIONS.tools, tool.id, {
    status: TOOL_STATUS.BORROWED,
    updatedAt: timestamp,
  })

  await activity.log({
    action: ACTIVITY.TOOL_BORROWED,
    toolId: tool.id,
    toolName: tool.name,
    userId: user.id,
    userName: user.fullName,
    transactionId: txn.id,
    message: `${user.fullName} borrowed the tool${
      input.purpose ? ` for ${input.purpose}` : ''
    }.`,
    meta: { dueDate: txn.dueDate, issuedBy: actor?.fullName ?? null },
  })

  await notifications.create(notifications.templates.borrowed(tool, txn, user))

  // If it is already due within the warning window, say so immediately.
  if (isDueSoon(txn.dueDate, 1)) {
    await notifications.create(notifications.templates.dueSoon(tool, txn, user))
  }

  return txn
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
export async function returnTool({ transactionId, condition, notes }, actor) {
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

  const tool = await db.get(COLLECTIONS.tools, txn.toolId)
  const timestamp = nowISO()
  const damaged = condition === CONDITION.DAMAGED
  const wasOverdue = txn.status === TXN_STATUS.OVERDUE

  const updatedTxn = await db.update(COLLECTIONS.transactions, txn.id, {
    returnDate: timestamp,
    status: damaged ? TXN_STATUS.DAMAGED : TXN_STATUS.RETURNED,
    conditionIn: condition,
    wasOverdue,
    notes: [txn.notes, notes?.trim()].filter(Boolean).join(' — '),
    receivedById: actor?.id ?? null,
    receivedByName: actor?.fullName ?? null,
    updatedAt: timestamp,
  })

  if (tool) {
    const previousCondition = tool.condition
    await db.update(COLLECTIONS.tools, tool.id, {
      status: damaged ? TOOL_STATUS.DAMAGED : TOOL_STATUS.AVAILABLE,
      condition,
      updatedAt: timestamp,
    })

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

    if (previousCondition !== condition) {
      await activity.log({
        action: ACTIVITY.CONDITION_CHANGED,
        toolId: tool.id,
        toolName: tool.name,
        userId: actor?.id,
        userName: actor?.fullName,
        transactionId: txn.id,
        message: `Condition changed from ${previousCondition} to ${condition}.`,
        meta: { from: previousCondition, to: condition },
      })
    }

    const user = await db.get(COLLECTIONS.users, txn.userId)
    await notifications.create(
      damaged
        ? notifications.templates.damaged(tool, updatedTxn, user)
        : notifications.templates.returned(tool, updatedTxn, user),
    )

    // The loan is closed, so its overdue/due-soon alerts are no longer actionable.
    await clearAlertsFor(txn.id)
  }

  return updatedTxn
}

/** Remove the open alerts tied to a transaction once it is closed. */
async function clearAlertsFor(transactionId) {
  await db.removeWhere(
    COLLECTIONS.notifications,
    (n) =>
      n.dedupeKey === `overdue:${transactionId}` || n.dedupeKey === `due-soon:${transactionId}`,
  )
}

/* ------------------------------------------------------------------ *
 * Overdue sweep
 * ------------------------------------------------------------------ */

/**
 * Reconcile every open loan against today's date.
 *
 * Runs on each app load and after any borrow/return. It flips due loans to
 * Overdue, syncs the tool status, and raises one notification per event —
 * deduplicated by transaction id so repeated sweeps stay quiet.
 *
 * @returns {{ overdue: number, dueSoon: number }}
 */
export async function runOverdueCheck({ dueSoonThresholdDays = 1, notify = true } = {}) {
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

/** Everything a return screen needs, resolved from a tool id. */
export async function activeLoanContext(toolId) {
  const txn = await findActiveForTool(toolId)
  if (!txn) return null
  const [tool, user] = await Promise.all([
    db.get(COLLECTIONS.tools, txn.toolId),
    db.get(COLLECTIONS.users, txn.userId),
  ])
  return { transaction: txn, tool, borrower: user }
}
