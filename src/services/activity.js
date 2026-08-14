import * as db from './db'
import { COLLECTIONS } from './db'
import { ACTIVITY } from '../utils/constants'
import { uid } from '../utils/helpers'
import { nowISO } from '../utils/dates'

/**
 * Append-only activity log. Every mutation that changes the state of a tool,
 * user or transaction writes one entry here, and the tool history timeline is
 * rendered straight from these records.
 */

/**
 * @param {object} entry
 * @param {string} entry.action    one of ACTIVITY
 * @param {string} [entry.toolId]
 * @param {string} [entry.userId]  the actor
 * @param {string} [entry.message] human-readable summary
 * @param {object} [entry.meta]    extra structured detail (from/to values, ids)
 */
export async function log(entry) {
  const record = {
    id: uid('LOG'),
    action: entry.action ?? ACTIVITY.SYSTEM,
    toolId: entry.toolId ?? null,
    toolName: entry.toolName ?? null,
    userId: entry.userId ?? null,
    userName: entry.userName ?? 'System',
    transactionId: entry.transactionId ?? null,
    message: entry.message ?? '',
    meta: entry.meta ?? {},
    createdAt: entry.createdAt ?? nowISO(),
  }
  await db.insert(COLLECTIONS.activityLogs, record)
  return record
}

/** Bulk append — used by the seeder so it writes one batch instead of many. */
export async function logMany(entries) {
  const records = entries.map((entry) => ({
    id: uid('LOG'),
    action: entry.action ?? ACTIVITY.SYSTEM,
    toolId: entry.toolId ?? null,
    toolName: entry.toolName ?? null,
    userId: entry.userId ?? null,
    userName: entry.userName ?? 'System',
    transactionId: entry.transactionId ?? null,
    message: entry.message ?? '',
    meta: entry.meta ?? {},
    createdAt: entry.createdAt ?? nowISO(),
  }))
  await db.insertMany(COLLECTIONS.activityLogs, records)
  return records
}

const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt)

/**
 * The streamed tail of the log — the newest entries, not the whole history.
 * Copied before sorting: the array from `db.list()` is the live cache.
 */
export async function listAll() {
  return [...(await db.list(COLLECTIONS.activityLogs))].sort(byNewest)
}

export async function listRecent(limit = 10) {
  return (await listAll()).slice(0, limit)
}

/**
 * Full timeline for one tool, newest first.
 *
 * A targeted server-side query rather than a filter over the streamed tail,
 * which would silently stop at the newest few hundred entries and quietly lose
 * an older tool's history.
 */
export async function listForTool(toolId) {
  const rows = await db.findWhere(COLLECTIONS.activityLogs, [['toolId', '==', toolId]])
  return rows.sort(byNewest)
}

export async function listForUser(userId) {
  const rows = await db.findWhere(COLLECTIONS.activityLogs, [['userId', '==', userId]])
  return rows.sort(byNewest)
}

export async function removeForTool(toolId) {
  return db.removeWhere(COLLECTIONS.activityLogs, (r) => r.toolId === toolId)
}
