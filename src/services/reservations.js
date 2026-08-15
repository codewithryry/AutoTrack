import * as db from './db'
import { COLLECTIONS } from './db'
import { RESERVATION_STATUS } from '../utils/constants'
import { PERM, assertCan, can } from '../utils/permissions'
import { padId, sortBy } from '../utils/helpers'
import { nowISO, toDate } from '../utils/dates'

/**
 * Reservations — the hold an approved request creates.
 *
 * A reservation says a tool is spoken for between two dates. It is deliberately
 * *not* a loan: the tool's status, the transaction record, the scanner and the
 * borrow desk are all untouched, and the hold only becomes a loan when the tool
 * is actually collected through the existing flow — at which point `fulfil()`
 * ties the two together.
 *
 * Created by whoever approves the request, which is staff, and readable by the
 * person it is for. The policies in `0012` enforce both.
 */

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listAll() {
  return sortBy(await db.list(COLLECTIONS.reservations), 'startsAt', 'asc')
}

export async function getById(id) {
  return db.get(COLLECTIONS.reservations, id)
}

export async function listForUser(userId) {
  const rows = await db.query(COLLECTIONS.reservations, (r) => r.userId === userId)
  return sortBy(rows, 'startsAt', 'asc')
}

export async function listForTool(toolId) {
  const rows = await db.query(COLLECTIONS.reservations, (r) => r.toolId === toolId)
  return sortBy(rows, 'startsAt', 'asc')
}

/** The holds still standing — what makes a tool unavailable to reserve again. */
export async function listActive() {
  const rows = await db.query(
    COLLECTIONS.reservations,
    (r) => r.status === RESERVATION_STATUS.RESERVED,
  )
  return sortBy(rows, 'startsAt', 'asc')
}

/**
 * The standing hold one account has on one tool, if any.
 *
 * This is what an approved request leaves behind, and what the borrow desk
 * turns into a loan — so it is also the answer to "has this been approved for
 * them?". A student's read is scoped to their own rows, which is exactly the
 * question being asked.
 */
export async function activeFor(toolId, userId) {
  if (!toolId || !userId) return null
  const rows = await db.query(
    COLLECTIONS.reservations,
    (r) =>
      r.toolId === toolId &&
      r.userId === userId &&
      r.status === RESERVATION_STATUS.RESERVED,
  )
  return sortBy(rows, 'startsAt', 'asc')[0] ?? null
}

async function nextId() {
  const rows = await db.list(COLLECTIONS.reservations)
  const highest = rows.reduce((max, row) => {
    const n = Number(String(row.id).replace(/^RSV-/, ''))
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return padId('RSV', highest + 1)
}

/** Do two windows touch? Used to keep one tool from being promised twice. */
export const overlaps = (aFrom, aTo, bFrom, bTo) => {
  const [af, at, bf, bt] = [aFrom, aTo, bFrom, bTo].map((v) => toDate(v)?.getTime() ?? null)
  if (af == null || at == null || bf == null || bt == null) return false
  return af <= bt && bf <= at
}

/**
 * Is this window still free on this tool?
 *
 * Only standing holds count — a cancelled, expired or already-collected one
 * says nothing about availability.
 */
export async function conflictFor(toolId, from, to, { ignoreId = null } = {}) {
  const held = (await listForTool(toolId)).filter(
    (r) => r.status === RESERVATION_STATUS.RESERVED && r.id !== ignoreId,
  )
  return held.find((r) => overlaps(from, to, r.startsAt, r.endsAt)) ?? null
}

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */

/**
 * Hold a tool for an approved request.
 *
 * Called by `requests.approve()`, which is the only way a reservation comes
 * into being — a hold without an approved request behind it would be a second
 * way to promise a tool, and there is deliberately only one.
 */
export async function createForRequest(request, actor) {
  assertCan(actor, PERM.RESERVATION_MANAGE, 'Only laboratory staff can hold a tool.')

  const clash = await conflictFor(request.toolId, request.neededFrom, request.neededTo)
  if (clash) {
    throw new Error(
      `${request.toolName} is already held for ${clash.userName} over those dates.`,
    )
  }

  const timestamp = nowISO()
  const record = {
    id: await nextId(),
    requestId: request.id,
    toolId: request.toolId,
    toolName: request.toolName,
    userId: request.userId,
    userName: request.userName,
    startsAt: request.neededFrom,
    endsAt: request.neededTo,
    status: RESERVATION_STATUS.RESERVED,
    transactionId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  await db.insert(COLLECTIONS.reservations, record)
  return record
}

/**
 * The hold was collected: point it at the loan that now represents it.
 *
 * The loan itself is created by the existing borrow flow — this only records
 * that the two are the same event, so a fulfilled hold stops blocking the tool.
 *
 * Closed by whoever performed the collection: staff issuing at the desk, or the
 * student the hold was approved for taking their own tool out. Both are the two
 * callers `borrow()` can have, and `0018` allows the same pair on the server.
 */
export async function fulfil(id, transactionId, actor) {
  const existing = await getById(id)
  if (existing && existing.userId !== actor?.id) {
    assertCan(actor, PERM.RESERVATION_MANAGE, 'Only laboratory staff can close a hold.')
  }

  const reservation = existing
  if (!reservation) throw new Error('Reservation not found.')
  if (reservation.status !== RESERVATION_STATUS.RESERVED) return reservation

  return db.update(COLLECTIONS.reservations, id, {
    status: RESERVATION_STATUS.FULFILLED,
    transactionId: transactionId ?? null,
    updatedAt: nowISO(),
  })
}

/** Release a hold. The person it is for may release their own; staff may release any. */
export async function cancel(id, actor) {
  const reservation = await getById(id)
  if (!reservation) throw new Error('Reservation not found.')

  const own = reservation.userId === actor?.id
  if (!own && !can(actor, PERM.RESERVATION_MANAGE)) {
    throw new Error('You can only cancel your own reservations.')
  }
  if (reservation.status !== RESERVATION_STATUS.RESERVED) return reservation

  return db.update(COLLECTIONS.reservations, id, {
    status: RESERVATION_STATUS.CANCELLED,
    updatedAt: nowISO(),
  })
}

/** A hold whose window has passed without being collected. */
export async function expire(id) {
  const reservation = await getById(id)
  if (!reservation || reservation.status !== RESERVATION_STATUS.RESERVED) return reservation
  return db.update(COLLECTIONS.reservations, id, {
    status: RESERVATION_STATUS.EXPIRED,
    updatedAt: nowISO(),
  })
}

/**
 * Sweep holds whose window has passed. Staff-only and idempotent, like the
 * overdue check it sits beside.
 */
export async function expireStale({ now = new Date() } = {}) {
  const { role } = db.currentScope()
  if (!can({ role }, PERM.RESERVATION_MANAGE)) return { expired: 0, skipped: true }

  let expired = 0
  for (const reservation of await listActive()) {
    const end = toDate(reservation.endsAt)
    if (!end || end >= now) continue
    await expire(reservation.id)
    expired++
  }
  return { expired }
}

/** Reservations visible to one account — the belt-and-braces filter for lists. */
export function visibleReservations(user, rows = []) {
  if (!user) return []
  if (can(user, PERM.RESERVATION_MANAGE)) return rows
  return rows.filter((r) => r.userId === user.id)
}
