import * as db from './db'
import { COLLECTIONS } from './db'
import * as activity from './activity'
import * as notifications from './notifications'
import * as reservations from './reservations'
import * as requests from './requests'
import { ValidationError } from './tools'
import {
  ACTIVE_TXN_STATUSES,
  ACTIVITY,
  CONDITION,
  NOTIF_TYPE,
  REQUEST_STATUS,
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
  isToday,
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
 * Where this loan's tool was last actually recorded.
 *
 * Read from the loan itself, which is what ties a tool to the one borrower
 * holding it — so the answer is that student's own recorded whereabouts for
 * that tool and cannot be another borrower's. The most recent usage checkpoint
 * wins; failing that, the point captured when the tool was collected. A loan
 * with neither returns null, which is "not recorded" and not a default.
 *
 * No new store: these are the same two columns `0008` added and the trail
 * already displays.
 */
export function lastKnownLocation(txn) {
  const stamped = (point) => new Date(point?.capturedAt ?? 0).getTime() || 0
  const latest = checkpointsOf(txn)
    .filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng))
    .reduce((newest, point) => (!newest || stamped(point) >= stamped(newest) ? point : newest), null)

  if (latest) return { ...latest, source: 'checkpoint' }

  const borrow = txn?.borrowLocation
  if (Number.isFinite(borrow?.lat) && Number.isFinite(borrow?.lng)) {
    return { ...borrow, source: 'borrow' }
  }
  return null
}

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
 * The standing approval one account has on one tool, if any.
 *
 * Read straight from the request store rather than through the request service,
 * so this stays a lookup and can never be mistaken for a way of writing one. A
 * student's read is scoped to their own rows, which is exactly the question.
 */
async function approvedRequestFor(toolId, userId) {
  if (!toolId || !userId) return null
  const rows = await db.query(
    COLLECTIONS.toolRequests,
    (r) =>
      r.toolId === toolId &&
      r.userId === userId &&
      r.status === REQUEST_STATUS.APPROVED,
  )
  return sortBy(rows, 'decidedAt', 'desc')[0] ?? null
}

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

  // A student takes out only what has already been approved for them.
  //
  // The approval happens at the request stage, so the counter is not a second
  // decision — it is the handover. Scanning a tool and confirming it turns the
  // hold that approval created into the loan; without a hold there is nothing
  // to confirm, and the tool is asked for rather than taken.
  //
  // Staff are unaffected: issuing a tool at the desk is their decision to make,
  // and that is what `BORROW_FOR_OTHERS` already says.
  //
  // Staff issuing at the desk are unaffected — that is their decision to make,
  // and it is what `BORROW_FOR_OTHERS` already says. The hold is still looked
  // up for them, because closing it is what takes the approved item out of the
  // ready-to-borrow queue once the tool has actually been handed over.
  const hold = await reservations.activeFor(input.toolId, input.userId).catch(() => null)

  // The approval itself is the authorisation, and the request is where it
  // lives. The hold is the ordinary way of finding it, but a hold that could
  // not be read — a pending migration, a hold released early — must not turn a
  // genuinely approved request into "you have no permission", so the request is
  // consulted as the second reading of the same fact. Neither one is created
  // here; both are only looked up.
  const approvedRequest = hold
    ? null
    : await approvedRequestFor(input.toolId, input.userId).catch(() => null)

  if (!hold && !approvedRequest && !can(actor, PERM.BORROW_FOR_OTHERS)) {
    throw new Error(
      'This tool has not been approved for you yet. Request it first — once staff approve it, ' +
        'it appears on the borrow desk as ready to borrow.',
    )
  }

  // "Issued by" names the staff member whose approval put the tool in the
  // borrower's hands, not whoever tapped confirm: a student collecting their own
  // approved tool did not issue it to themselves. Staff issuing at the desk have
  // no approval behind it, so they stay the issuer, as before.
  const approval =
    approvedRequest ??
    (hold?.requestId ? await requests.getById(hold.requestId).catch(() => null) : null)
  // The batch the approval belonged to, carried onto the loan so a tool taken
  // out under a multi-tool ask can be traced back to it. Each tool keeps its
  // own transaction and is returned on its own.
  const batchId =
    approval?.batchId && (await db.supportsColumn(COLLECTIONS.transactions, 'batchId'))
      ? approval.batchId
      : null

  const issuer = approval?.decidedByName
    ? { id: approval.decidedById ?? null, name: approval.decidedByName }
    : // No approval to read: the issuer is whoever worked the counter. A
      // borrower collecting their own approved tool is never the issuer, so
      // rather than naming them the field is left empty.
      can(actor, PERM.BORROW_FOR_OTHERS)
      ? { id: actor?.id ?? null, name: actor?.fullName ?? null }
      : { id: null, name: null }

  // One approval is one borrowing. The atomic step below already refuses a tool that
  // is not available, but the borrower's own open loan is checked first so a
  // double-tapped checkout says what it means instead of "not available".
  const ownLoan = (await listForUser(input.userId).catch(() => [])).find(
    (t) => t.toolId === input.toolId && ACTIVE_TXN_STATUSES.includes(t.status),
  )
  if (ownLoan) {
    throw new Error(`${ownLoan.toolName} is already borrowed on ${ownLoan.id}. Return it first.`)
  }

  // A friendlier message than "not available" when staff can see who has it.
  if (can(actor, PERM.TXN_VIEW_ALL)) {
    const openLoan = await findActiveForTool(input.toolId, actor)
    if (openLoan) throw new Error(`${openLoan.toolName} is already issued to ${openLoan.userName}.`)
  }

  const timestamp = nowISO()

  // The form submits a calendar date, and `fromDateInput` anchors it at local
  // noon so the day cannot drift across timezones. For a loan being issued now
  // that noon is not the borrow time — every loan came out as 12:00 PM. A loan
  // dated today is therefore stamped with the clock reading of the handover
  // itself; a back-dated entry keeps the date it was given, because no real
  // time of day exists for it. Both are local-time ISO strings, so they render
  // in the same timezone as the rest of the record.
  const borrowDate = isToday(input.borrowDate) ? timestamp : input.borrowDate

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
      id: generateTxnId(toDate(borrowDate) ?? new Date()),
      toolId: tool.id,
      toolName: tool.name,
      toolCategory: tool.category,
      userId: user.id,
      userName: user.fullName,
      userRole: user.role,
      borrowDate,
      dueDate: input.dueDate,
      returnDate: null,
      status: TXN_STATUS.BORROWED,
      conditionOut: tool.condition,
      conditionIn: null,
      purpose: input.purpose?.trim() ?? '',
      notes: input.notes?.trim() ?? '',
      issuedById: issuer.id,
      issuedByName: issuer.name,
      // The ask this loan came out of, when several tools were requested
      // together. Omitted when there is none, or when `0020` has not been
      // applied, so the insert never names a column this database lacks.
      ...(batchId ? { batchId } : {}),
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
    // The approval has been collected: the hold becomes the loan, and the
    // approved item leaves the borrow desk's ready-to-borrow queue. The request
    // itself is left as it is — it stays the approval record.
    if (hold) {
      await reservations
        .fulfil(hold.id, record.id, actor)
        .catch((err) => console.warn('[transactions] the hold could not be closed', err))
    }

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
      meta: { dueDate: record.dueDate, issuedBy: issuer.name },
    })

    await notifyParties(
      {
        staff: notifications.templates.borrowed(tool, record, user),
        personal: notifications.templates.borrowedByYou(tool, record, user),
      },
      actor,
      user.id,
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
 * Address a transaction notification to both parties, explicitly.
 *
 * Every loan event has two audiences and they are not the same notification.
 * The tool room wants the operational line — "Tool borrowed, issued to X" — and
 * that stays a laboratory-wide alert (`userId: null`) that only staff read. The
 * borrower wants their own loan status, so they get a separate copy addressed to
 * them, in their own terms.
 *
 * Who may write what still follows the security rules: only a staff actor can
 * raise the laboratory-wide alert, and a student acting for themselves writes
 * their own copy alone. Both copies carry a per-recipient `dedupeKey`, so
 * nobody's centre gets the same event twice.
 */
async function notifyParties({ staff, personal }, actor, recipientId) {
  const broadcast = !!staff && can(actor, PERM.TXN_VIEW_ALL)
  if (broadcast) {
    await notifications.create(staff)
  }
  // One event, one notification per reader. A borrower who is also staff would
  // otherwise read the same handover twice — once as the laboratory-wide line
  // and once as their own copy — so the personal copy is skipped for a reader
  // the broadcast already reaches.
  const readsBroadcast = broadcast && recipientId === actor?.id
  if (personal && recipientId && !readsBroadcast) {
    await notifications.create({ ...personal, userId: recipientId })
  }
}

/* ------------------------------------------------------------------ *
 * Return
 * ------------------------------------------------------------------ */

/** Columns added by `0019_return_requests.sql`. */
const RETURN_REQUEST_COLUMN = 'returnRequestedAt'

/** Whether this database has the return-request columns `0019` adds. */
export const returnRequestsAvailable = () =>
  db.supportsColumn(COLLECTIONS.transactions, RETURN_REQUEST_COLUMN)

/** Has this loan already been handed in and is only waiting on the counter? */
export const returnRequested = (txn) => !!txn?.returnRequestedAt

/**
 * Ask to hand a tool back.
 *
 * What a student does instead of closing the loan themselves: the tool is still
 * out and the record still says `Borrowed` — only now the counter knows it is
 * coming back, in what condition the borrower says it is, and when they asked.
 * Staff confirm the actual return with `returnTool()`, which is the one place a
 * transaction is closed and a tool goes back on the shelf.
 *
 * One request per loan: asking again while one is open is refused rather than
 * overwriting the first, so the counter's queue cannot be re-stamped.
 */
export async function requestReturn({ transactionId, condition, notes }, actor) {
  assertCan(actor, PERM.RETURN, 'Your role is not allowed to return tools.')

  const txn = await getById(transactionId)
  if (!txn) throw new Error('Transaction not found.')
  if (!ACTIVE_TXN_STATUSES.includes(txn.status)) {
    throw new Error('This tool is not currently borrowed, so it cannot be handed back.')
  }
  if (!canReturnTransaction(actor, txn)) {
    throw new Error('You can only hand back tools that you borrowed yourself.')
  }
  if (returnRequested(txn)) {
    throw new Error('A return has already been requested for this tool. Staff will confirm it.')
  }
  if (!RETURN_CONDITIONS.includes(condition)) {
    throw new ValidationError({ condition: 'Select the condition of the tool you are handing back.' })
  }
  if (!(await returnRequestsAvailable())) {
    throw new Error(
      'Return requests are not enabled on this database yet. Ask an administrator to apply the latest migration.',
    )
  }

  const timestamp = nowISO()
  const updated = await db.update(COLLECTIONS.transactions, txn.id, {
    returnRequestedAt: timestamp,
    returnRequestCondition: condition,
    returnRequestNotes: notes?.trim() ?? '',
    updatedAt: timestamp,
  })

  await afterWrite('return request follow-up', async () => {
    await activity.log({
      action: ACTIVITY.TOOL_RETURNED,
      toolId: txn.toolId,
      toolName: txn.toolName,
      userId: txn.userId,
      userName: txn.userName,
      transactionId: txn.id,
      message: `${txn.userName} asked to hand ${txn.toolName} back (reported ${condition}).`,
      meta: { condition, returnRequest: true },
    })

    // The laboratory-wide alert is a staff write, so it is raised only when
    // staff are the ones asking; a student's request reaches the counter
    // through the return desk's own list, which reads the same column.
    await notifyParties(
      {
        staff: {
          type: NOTIF_TYPE.REQUEST,
          title: 'Return requested',
          message: `${txn.userName} is handing ${txn.toolName} back. Confirm it at the return desk.`,
          toolId: txn.toolId,
          toolName: txn.toolName,
          transactionId: txn.id,
          dedupeKey: `return-request:${txn.id}`,
        },
      },
      actor,
      null,
    )
  })

  return updated ?? { ...txn, returnRequestedAt: timestamp, returnRequestCondition: condition }
}

/**
 * Take a tool back.
 *
 * The counter's own step, and the only one that closes a loan: a student asks
 * with `requestReturn()` and a member of staff receives the tool here. A damaged
 * return pulls the tool out of circulation rather than returning it to the
 * Available pool, and marks the transaction itself as Damaged so the report on
 * breakages stays accurate.
 */
export async function returnTool({ transactionId, condition, notes, returnLocation }, actor) {
  assertCan(actor, PERM.RETURN, 'Your role is not allowed to return tools.')
  // Receiving equipment is the crib's job: a borrower hands the tool in, staff
  // confirm it. `BORROW_FOR_OTHERS` is the existing permission that says "works
  // the counter", so no new one is introduced for it.
  if (!can(actor, PERM.BORROW_FOR_OTHERS)) {
    throw new Error(
      'Only laboratory staff can confirm a return. Request the return and hand the tool in at the crib.',
    )
  }

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
      await notifyParties(
        {
          staff: damaged
            ? notifications.templates.damaged(tool, updatedTxn, borrower)
            : notifications.templates.returned(tool, updatedTxn, borrower),
          personal: notifications.templates.returnedByYou(tool, updatedTxn, txn.userId, {
            damaged,
          }),
        },
        actor,
        txn.userId,
      )

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
      // Prefix match: the overdue alert now exists as a staff line and a copy
      // addressed to the borrower (`overdue:<txn>:<uid>`), and closing the loan
      // retires both.
      (n) =>
        typeof n.dedupeKey === 'string' &&
        (n.dedupeKey === `overdue:${transactionId}` ||
          n.dedupeKey.startsWith(`overdue:${transactionId}:`) ||
          n.dedupeKey === `due-soon:${transactionId}`),
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
        // The staff line is about the laboratory's tool; the borrower needs to
        // be told it is theirs to bring back. Both are deduplicated per loan.
        await notifications.create(notifications.templates.overdue(tool, txn, user))
        if (txn.userId) {
          await notifications.create(
            notifications.templates.overdueForYou(tool, txn, txn.userId),
          )
        }
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
  // Neither read depends on the other, so they go out together — one round trip
  // on the scanner's path rather than two.
  const [tool, borrower] = await Promise.all([
    db.get(COLLECTIONS.tools, txn.toolId),
    txn.userId === actor?.id
      ? Promise.resolve(actor)
      : db.get(COLLECTIONS.users, txn.userId).catch(() => null),
  ])
  return { transaction: txn, tool, borrower: borrower ?? { id: txn.userId, fullName: txn.userName } }
}
