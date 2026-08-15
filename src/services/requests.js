import * as db from './db'
import { COLLECTIONS } from './db'
import * as activity from './activity'
import * as notifications from './notifications'
import * as reservations from './reservations'
import { ValidationError } from './tools'
import {
  ACTIVE_TXN_STATUSES,
  ACTIVITY,
  NOTIF_TYPE,
  OPEN_REQUEST_STATUSES,
  REQUEST_STATUS,
  ROLE,
} from '../utils/constants'
import { PERM, assertCan, can } from '../utils/permissions'
import { padId, sortBy } from '../utils/helpers'
import { nowISO, toDate } from '../utils/dates'

/**
 * Where the requester means to collect the tool, attached to the request the
 * same way a borrow attaches its collection point to the loan. Same shape, same
 * rules: optional, a single reading, and skipped entirely until the migration
 * has been applied — a pending migration loses the location, never the request.
 */
const COLLECTION_LOCATION_COLUMN = 'collectionLocation'

export const collectionLocationAvailable = () =>
  db.supportsColumn(COLLECTIONS.toolRequests, COLLECTION_LOCATION_COLUMN)

/**
 * The batch — one ask covering several tools (`0020`).
 *
 * Still one row per tool, because a hold, a loan and a return are all per tool.
 * The batch id is what ties those rows together: they were raised in one go,
 * they are decided in one action, and every loan they become carries the same
 * id so the history can be read back as one ask.
 */
const BATCH_COLUMN = 'batchId'

export const batchesAvailable = () => db.supportsColumn(COLLECTIONS.toolRequests, BATCH_COLUMN)

/** A fresh batch id. Generated once per submission, shared by its rows. */
export const newBatchId = () => `BATCH-${Date.now().toString(36).toUpperCase()}`

/** Every request raised under one batch, oldest first. */
export async function listForBatch(batchId) {
  if (!batchId) return []
  const rows = await db.query(COLLECTIONS.toolRequests, (r) => r.batchId === batchId)
  return sortBy(rows, 'createdAt', 'asc')
}

/** Strip a captured reading down to what is stored, with the actor stamped on. */
function toStoredLocation(location, actor) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null
  return {
    lat: location.lat,
    lng: location.lng,
    accuracy: Number.isFinite(location.accuracy) ? location.accuracy : null,
    capturedAt: location.capturedAt ?? nowISO(),
    capturedById: actor?.id ?? null,
    capturedByName: actor?.fullName ?? null,
  }
}

/**
 * Tool requests.
 *
 * A request is the step before a loan: a student asks for a tool for a window
 * of time, and staff approve or reject it. Nothing here issues a tool — an
 * approval creates a reservation, and the tool still leaves the crib through
 * the borrow desk or the scanner, unchanged.
 *
 * A request is never a conversation: borrowing is decided here and carried out
 * on the borrow desk, and Messages is left for actual messaging.
 *
 * Reads are scoped by role in the data layer and by the policies in `0012`: a
 * student only ever sees their own requests.
 */

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listAll() {
  return sortBy(await db.list(COLLECTIONS.toolRequests), 'createdAt', 'desc')
}

export async function getById(id) {
  return db.get(COLLECTIONS.toolRequests, id)
}

export async function listForUser(userId) {
  const rows = await db.query(COLLECTIONS.toolRequests, (r) => r.userId === userId)
  return sortBy(rows, 'createdAt', 'desc')
}

export async function listForTool(toolId) {
  const rows = await db.query(COLLECTIONS.toolRequests, (r) => r.toolId === toolId)
  return sortBy(rows, 'createdAt', 'desc')
}

/** The queue staff work from: everything still awaiting a decision. */
export async function listPending() {
  const rows = await db.query(
    COLLECTIONS.toolRequests,
    (r) => r.status === REQUEST_STATUS.PENDING,
  )
  return sortBy(rows, 'createdAt', 'asc')
}

/** Next free sequential id, e.g. `REQ-00007`. */
async function nextId() {
  const rows = await db.list(COLLECTIONS.toolRequests)
  const highest = rows.reduce((max, row) => {
    const n = Number(String(row.id).replace(/^REQ-/, ''))
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return padId('REQ', highest + 1)
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export function validate({ toolId, neededFrom, neededTo, purpose }, { maxDays = 30 } = {}) {
  const errors = {}
  if (!toolId) errors.toolId = 'Select a tool.'

  const from = toDate(neededFrom)
  const to = toDate(neededTo)

  if (!neededFrom) errors.neededFrom = 'Say when you need the tool from.'
  else if (!from) errors.neededFrom = 'Enter a valid date.'

  if (!neededTo) errors.neededTo = 'Say when you will return it.'
  else if (!to) errors.neededTo = 'Enter a valid date.'

  if (from && to) {
    if (to < from) errors.neededTo = 'The return date cannot be before the start date.'
    else if ((to - from) / 86400000 > maxDays) {
      errors.neededTo = `A tool cannot be held for more than ${maxDays} days.`
    }
  }
  if (purpose && purpose.length > 300) errors.purpose = 'Keep the purpose under 300 characters.'
  return errors
}

/* ------------------------------------------------------------------ *
 * Raising a request
 * ------------------------------------------------------------------ */

/**
 * Ask for a tool.
 *
 * A student may only request for themselves — the policy enforces the same
 * thing — and the request opens as `Pending`, waiting for the crib to decide it
 * on the Requests page.
 */
export async function create(input, actor, { maxDays = 30 } = {}) {
  assertCan(actor, PERM.REQUEST_CREATE, 'Your role is not allowed to request tools.')

  const errors = validate(input, { maxDays })
  if (Object.keys(errors).length) throw new ValidationError(errors)

  // Staff may raise a request on someone's behalf; a student may not.
  const forUserId = can(actor, PERM.REQUEST_VIEW_ALL) ? (input.userId ?? actor.id) : actor.id
  const requester =
    forUserId === actor.id ? actor : await db.get(COLLECTIONS.users, forUserId)
  if (!requester) throw new Error('Requester not found.')

  const tool = await db.get(COLLECTIONS.tools, input.toolId)
  if (!tool) throw new Error('Tool not found.')

  // One ask is one record.
  //
  // The borrow flow is the only way in, but it can be entered twice for the
  // same job — a double-tapped submit, a retry after a slow network, a second
  // tab. Rather than trusting every caller to guard itself, the duplicate is
  // refused here, at the write: any request this person already has open on
  // this tool — pending a decision, or approved and waiting to be collected —
  // *is* the request, so it is handed straight back. Nobody has to ask twice
  // for the same tool, and an approval is never left behind by a second row.
  //
  // "Open" is read against this requester's own rows only — never against the
  // tool — so another student's ask never stands in the way of this one. An
  // approval that has already been collected and handed back is spent, not
  // open: it named a borrowing that is over, so the same person may ask for the
  // same tool again.
  const mine = await listForUser(requester.id)
  const candidates = mine.filter(
    (r) => r.toolId === tool.id && OPEN_REQUEST_STATUSES.includes(r.status),
  )
  let twin = null
  for (const candidate of candidates) {
    if (candidate.status !== REQUEST_STATUS.APPROVED) {
      twin = candidate
      break
    }
    if (!(await isSpent(candidate, requester.id))) {
      twin = candidate
      break
    }
  }
  if (twin) return twin

  const timestamp = nowISO()
  const id = await nextId()

  // Where the requester will collect the tool, if they chose to give a reading
  // and the database has a column to keep it in — a refusal or a pending
  // migration both land here as `null`, and the request proceeds unchanged.
  const collectionLocation = (await collectionLocationAvailable())
    ? toStoredLocation(input.collectionLocation, actor)
    : null

  // The batch this row belongs to, when the caller raised several tools in one
  // go and the column exists. Omitted otherwise, so an un-migrated database
  // still takes the request — as a batch of one, which is what it always was.
  const batchId = input.batchId && (await batchesAvailable()) ? input.batchId : null

  const record = {
    id,
    ...(batchId ? { batchId } : {}),
    toolId: tool.id,
    toolName: tool.name,
    userId: requester.id,
    userName: requester.fullName,
    userRole: requester.role,
    purpose: input.purpose?.trim() ?? '',
    neededFrom: input.neededFrom,
    neededTo: input.neededTo,
    status: REQUEST_STATUS.PENDING,
    decisionNote: '',
    decidedById: null,
    decidedByName: null,
    decidedAt: null,
    reservationId: null,
    conversationId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    // Omitted entirely when the migration is not applied, so the insert never
    // names a column this database does not have.
    ...(collectionLocation ? { collectionLocation } : {}),
  }

  await db.insert(COLLECTIONS.toolRequests, record)

  const saved = record

  await afterWrite('request follow-up', async () => {
    await activity.log({
      action: ACTIVITY.TOOL_UPDATED,
      toolId: tool.id,
      toolName: tool.name,
      userId: requester.id,
      userName: requester.fullName,
      message: `${requester.fullName} requested this tool.`,
      meta: { requestId: id, from: input.neededFrom, to: input.neededTo },
    })

    // The crib is told there is something to decide; the requester already
    // knows, so nothing is addressed to them here. The alert is laboratory-wide
    // (`userId: null`), and the RLS rules only let staff raise those — so it is
    // sent only when staff raise the request on someone's behalf. A student
    // raising one still lands in the staff queue, where its pending count is
    // the signal; without this gate the insert would be refused by the policy
    // ("Your account is not allowed to do that") and the alert silently lost.
    if (can(actor, PERM.REQUEST_VIEW_ALL)) {
      await notifications.create({
        type: NOTIF_TYPE.REQUEST,
        title: 'Tool requested',
        message: `${requester.fullName} asked for ${tool.name}.`,
        dedupeKey: `request:${id}`,
        toolId: tool.id,
        toolName: tool.name,
        userId: null,
        link: `/requests/${id}`,
      })
    }
  })

  return saved
}

/**
 * Has this approval already been used up?
 *
 * An approved request is spent once the borrowing it authorised has been
 * collected *and* closed: the tool is back on the shelf and the ask it came
 * from is history, so it no longer stands between this person and a fresh
 * request for the same tool. A loan still out keeps the approval live — the
 * tool is in their hands, and asking for it again is not a thing to allow.
 *
 * Read from this requester's own transactions only. `db.query` is scoped by the
 * policies to what they may read, so it is their loans and nobody else's.
 */
async function isSpent(request, userId) {
  if (!request.decidedAt) return false
  const loans = await db
    .query(
      COLLECTIONS.transactions,
      (t) => t.toolId === request.toolId && t.userId === userId,
    )
    .catch(() => [])
  const collected = loans.filter(
    (t) => new Date(t.borrowDate) >= new Date(request.decidedAt),
  )
  if (!collected.length) return false
  // Every borrowing this approval produced is closed.
  return collected.every((t) => !ACTIVE_TXN_STATUSES.includes(t.status))
}

async function afterWrite(label, fn) {
  try {
    await fn()
  } catch (err) {
    console.error(`[requests] ${label} incomplete`, err)
  }
}

/* ------------------------------------------------------------------ *
 * Deciding
 * ------------------------------------------------------------------ */

/**
 * Approve a request, and hold the tool for the window that was asked for.
 *
 * The reservation is created here and linked both ways, so an approval is never
 * an approval without a hold. The tool's own status is left alone: it is still
 * available to whoever is standing at the counter until the reservation is
 * actually collected through the ordinary borrow flow.
 */
export async function approve(id, actor, { note = '' } = {}) {
  assertCan(actor, PERM.REQUEST_DECIDE, 'Only laboratory staff can decide tool requests.')

  const request = await getById(id)
  if (!request) throw new Error('Request not found.')
  if (request.status !== REQUEST_STATUS.PENDING) {
    throw new Error(`This request is already ${request.status.toLowerCase()}.`)
  }

  const reservation = await reservations.createForRequest(request, actor)

  const timestamp = nowISO()
  const saved = await db.update(COLLECTIONS.toolRequests, id, {
    status: REQUEST_STATUS.APPROVED,
    decisionNote: note.trim(),
    decidedById: actor?.id ?? null,
    decidedByName: actor?.fullName ?? null,
    decidedAt: timestamp,
    reservationId: reservation.id,
    updatedAt: timestamp,
  })

  // Approving *is* the issue.
  //
  // The decision the crib makes is "this student may have this tool", and there
  // is nothing further for the student to confirm — a second "collect it" step
  // only left approved asks sitting in a queue nobody worked. So the loan is
  // created here, through the ordinary borrow flow: the same service, the same
  // checks, the same hold closed behind it, with the approver as the issuer.
  //
  // Imported at the point of use because `transactions` reads this module for
  // the approval behind a loan — a static import would be a cycle.
  let issued = null
  try {
    const transactions = await import('./transactions')
    issued = await transactions.borrow(
      {
        toolId: saved.toolId,
        userId: saved.userId,
        borrowDate: nowISO(),
        dueDate: reservation?.endsAt ?? saved.neededTo,
        purpose: saved.purpose ?? '',
        // The point the borrower's own device recorded when they asked for the
        // tool. Approving *is* the issue, so that collection point is this
        // loan's collection point — carrying it here is what puts it under
        // "Borrowed here" without asking anyone to capture a second one. It
        // keeps the borrower's stamp and its original timestamp rather than
        // being re-attributed to the approver; see `toStoredLocation`.
        borrowLocation: saved.collectionLocation ?? null,
      },
      actor,
    )
  } catch (err) {
    // The approval stands even when the tool cannot go out right now — it is
    // already on the shelf for somebody else, or under maintenance. The hold
    // keeps it, and the counter releases it from the request as before.
    console.warn('[requests] the approved tool could not be issued yet', err)
  }

  await afterWrite('approval follow-up', async () => {
    // `borrow()` has already told the borrower their tool is out and when it is
    // due, so a second "approved" line would be the same event twice. Only an
    // approval that could not be issued announces itself here.
    if (issued) return
    await announce(saved, actor, {
      title: 'Request approved',
      body:
        `Your request for ${saved.toolName} was approved` +
        (note.trim() ? ` — ${note.trim()}` : '') +
        `. It is held for you until ` +
        `${new Date(saved.neededTo).toLocaleDateString()} — collect it at the crib.`,
      link: '/requests',
    })
  })

  return saved
}

/** Reject a request. Nothing is held, and the reason goes to the requester. */
export async function reject(id, actor, { note = '' } = {}) {
  assertCan(actor, PERM.REQUEST_DECIDE, 'Only laboratory staff can decide tool requests.')

  const request = await getById(id)
  if (!request) throw new Error('Request not found.')
  if (request.status !== REQUEST_STATUS.PENDING) {
    throw new Error(`This request is already ${request.status.toLowerCase()}.`)
  }

  const timestamp = nowISO()
  const saved = await db.update(COLLECTIONS.toolRequests, id, {
    status: REQUEST_STATUS.REJECTED,
    decisionNote: note.trim(),
    decidedById: actor?.id ?? null,
    decidedByName: actor?.fullName ?? null,
    decidedAt: timestamp,
    updatedAt: timestamp,
  })

  await afterWrite('rejection follow-up', async () => {
    await announce(saved, actor, {
      title: 'Request not approved',
      body:
        note.trim() ||
        `Your request for ${saved.toolName} was not approved. Ask the laboratory staff for the reason.`,
    })
  })

  return saved
}

/**
 * Decide a whole batch in one action.
 *
 * The tools asked for together are approved or rejected together: one press,
 * one decision, applied to every still-pending row of the batch through the
 * same `approve()` / `reject()` above — so each tool still gets its own hold,
 * its own notification and its own record, and no tool inside a batch is ever
 * decided on its own. A request with no batch is a batch of one.
 *
 * A row that cannot be approved (its tool is already held for those dates) does
 * not take the rest down with it: it is reported back alongside the ones that
 * went through, so staff can see exactly what happened.
 */
export async function decideBatch(request, actor, { approved, note = '' } = {}) {
  assertCan(actor, PERM.REQUEST_DECIDE, 'Only laboratory staff can decide tool requests.')
  if (!request) throw new Error('Request not found.')

  const rows = request.batchId ? await listForBatch(request.batchId) : [request]
  const pending = rows.filter((r) => r.status === REQUEST_STATUS.PENDING)
  if (!pending.length) {
    throw new Error(`This request is already ${request.status.toLowerCase()}.`)
  }

  const decided = []
  const failed = []
  for (const row of pending) {
    try {
      decided.push(approved ? await approve(row.id, actor, { note }) : await reject(row.id, actor, { note }))
    } catch (err) {
      failed.push({ request: row, message: err.message })
    }
  }

  if (!decided.length) throw new Error(failed[0]?.message ?? 'That decision could not be recorded.')
  return { decided, failed }
}

/**
 * Withdraw a request.
 *
 * The requester may cancel their own at any point before it is collected, and
 * staff may cancel any — releasing the hold if approval had already created
 * one. The policy allows the same two callers and nothing else.
 */
export async function cancel(id, actor, { note = '' } = {}) {
  const request = await getById(id)
  if (!request) throw new Error('Request not found.')

  const own = request.userId === actor?.id
  if (!own && !can(actor, PERM.REQUEST_DECIDE)) {
    throw new Error('You can only cancel your own requests.')
  }
  if (!OPEN_REQUEST_STATUSES.includes(request.status)) {
    throw new Error(`This request is already ${request.status.toLowerCase()}.`)
  }

  if (request.reservationId) {
    await reservations
      .cancel(request.reservationId, actor)
      .catch((err) => console.warn('[requests] the hold could not be released', err))
  }

  const saved = await db.update(COLLECTIONS.toolRequests, id, {
    status: REQUEST_STATUS.CANCELLED,
    decisionNote: note.trim() || request.decisionNote,
    updatedAt: nowISO(),
  })

  await afterWrite('cancellation follow-up', async () => {
    // Cancelled by staff: tell the requester. Cancelled by the requester: tell
    // the crib, which is the side that was waiting to act.
    if (own) {
      await notifications.create({
        type: NOTIF_TYPE.REQUEST,
        title: 'Request withdrawn',
        message: `${saved.userName} withdrew their request for ${saved.toolName}.`,
        dedupeKey: `request-cancelled:${saved.id}`,
        toolId: saved.toolId,
        toolName: saved.toolName,
        userId: null,
        link: `/requests/${saved.id}`,
      })
    } else {
      await announce(saved, actor, {
        title: 'Request cancelled',
        body:
          note.trim() ||
          `Your request for ${saved.toolName} was cancelled by the laboratory staff.`,
      })
    }
  })

  return saved
}

/**
 * Close out requests whose window has passed.
 *
 * Staff-only, like the overdue sweep it mirrors, and idempotent: a request is
 * only touched while it is still open and its end date is behind us.
 */
export async function expireStale({ now = new Date() } = {}) {
  const { role } = db.currentScope()
  if (!can({ role }, PERM.REQUEST_DECIDE)) return { expired: 0, skipped: true }

  const open = (await listAll()).filter((r) => OPEN_REQUEST_STATUSES.includes(r.status))
  let expired = 0

  for (const request of open) {
    const end = toDate(request.neededTo)
    if (!end || end >= now) continue

    if (request.reservationId) {
      await reservations
        .expire(request.reservationId)
        .catch((err) => console.warn('[requests] a hold could not be expired', err))
    }
    await db.update(COLLECTIONS.toolRequests, request.id, {
      status: REQUEST_STATUS.EXPIRED,
      updatedAt: nowISO(),
    })
    expired++
  }
  return { expired }
}

/**
 * Tell the requester what was decided, in their notification centre. The
 * decision itself lives on the request, which stays the approval record.
 */
async function announce(request, actor, { title, body, link }) {
  await notifications.create({
    type: NOTIF_TYPE.REQUEST,
    title,
    message: body,
    dedupeKey: `request-${request.status.toLowerCase()}:${request.id}`,
    toolId: request.toolId,
    toolName: request.toolName,
    userId: request.userId,
    link: link ?? `/requests/${request.id}`,
  })
}

/** Who a request thread belongs to, for the pickers and the thread header. */
export const isDecidable = (request) => request?.status === REQUEST_STATUS.PENDING
export const isCancellable = (request) => OPEN_REQUEST_STATUSES.includes(request?.status)

/** Requests visible to one account — the belt-and-braces filter for lists. */
export function visibleRequests(user, rows = []) {
  if (!user) return []
  if (can(user, PERM.REQUEST_VIEW_ALL)) return rows
  return rows.filter((r) => r.userId === user.id)
}

export { REQUEST_STATUS, ROLE }
