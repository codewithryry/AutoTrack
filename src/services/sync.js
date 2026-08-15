import * as db from './db'
import * as offlineCache from './offlineCache'
import { nowISO } from '../utils/dates'

/**
 * Background sync engine.
 *
 * Replays the account's queued outbox ops against the server, in the order they
 * were made, once the connection is back. It sits between the data layer and the
 * UI: it calls only `db.*Direct` (raw server writes) and `offlineCache`, so the
 * "Supabase stays behind the data layer" invariant is untouched.
 *
 * Safety:
 *  - One pass at a time per app (`running` guard) and a short lease per op
 *    (`lockedAt`), so a second tab cannot replay the same change mid-flight.
 *  - An op that fails stays queued with `attempts++` and the reason recorded,
 *    and is retried on the next pass — nothing is ever dropped silently.
 *  - A failed insert that the server already holds (`23505`, e.g. the response
 *    was lost on a previous attempt) is matched by id and treated as done.
 *  - The network error fast-path stops the whole pass, so a dead connection
 *    does not churn through every op.
 */

/** Guards against overlapping passes in one tab. */
let running = false

const summary = (overrides = {}) => ({
  synced: 0,
  failed: 0,
  pending: 0,
  skipped: false,
  ...overrides,
})

/**
 * Replay every queued op for the current account.
 *
 * @returns {Promise<{ synced: number, failed: number, pending: number, skipped: boolean }>}
 */
export async function syncPending() {
  const { uid } = db.currentScope()
  if (!uid) return summary({ skipped: true })
  if (running) return summary({ skipped: true })

  running = true
  let synced = 0
  let failed = 0
  try {
    const ops = await offlineCache.pendingOps(uid, { includeLocked: false })
    for (const op of ops) {
      // Reserve the op so another pass cannot take it while this one runs.
      const leased = await offlineCache.touchOp(op.id, { lockedAt: Date.now() })
      if (!leased) continue
      try {
        await replay(op, uid)
        await offlineCache.removeOp(op.id)
        synced++
      } catch (err) {
        failed++
        if (db.isNetworkError(err)) break
        await offlineCache.touchOp(op.id, {
          lockedAt: null,
          attempts: (op.attempts ?? 0) + 1,
          lastError: String(err?.message ?? err),
          lastAttemptAt: nowISO(),
        })
      }
    }
  } finally {
    running = false
  }
  return summary({ synced, failed, pending: await offlineCache.countPending(uid) })
}

/** Send one queued op to the server and reconcile the cache. */
async function replay(op, uid) {
  switch (op.kind) {
    case 'insert': {
      let serverDoc
      try {
        serverDoc = await db.insertDirect(op.collection, op.document)
      } catch (err) {
        if (err?.code === '23505') {
          // Already there — the earlier attempt reached the server even though
          // the reply never came back. Match it and move on.
          serverDoc = (await db.getDirect(op.collection, op.document.id)) ?? op.document
        } else {
          throw err
        }
      }
      await offlineCache.putServerRecord(uid, op.collection, serverDoc)
      return
    }
    case 'update': {
      const serverDoc = await db.updateDirect(op.collection, op.recordId, op.patch)
      if (serverDoc) await offlineCache.putServerRecord(uid, op.collection, serverDoc)
      else await offlineCache.removeLocalRecord(uid, op.collection, op.recordId)
      return
    }
    case 'upsert': {
      const serverDoc = await db.upsertDirect(op.collection, op.document)
      await offlineCache.putServerRecord(uid, op.collection, serverDoc)
      return
    }
    case 'remove': {
      await db.removeDirect(op.collection, op.recordId)
      await offlineCache.removeLocalRecord(uid, op.collection, op.recordId)
      return
    }
    case 'insertMany': {
      const serverDocs = await db.insertManyDirect(op.collection, op.documents)
      for (const doc of serverDocs) await offlineCache.putServerRecord(uid, op.collection, doc)
      return
    }
    case 'removeMany': {
      await db.removeManyDirect(op.collection, op.ids)
      for (const id of op.ids) await offlineCache.removeLocalRecord(uid, op.collection, id)
      return
    }
    case 'atomic':
      for (const step of op.steps ?? []) {
        if (step.type === 'set') {
          let serverDoc
          try {
            serverDoc = await db.upsertDirect(step.collection, step.document)
          } catch (err) {
            if (err?.code === '23505') {
              serverDoc =
                (await db.getDirect(step.collection, step.document.id)) ?? step.document
            } else {
              throw err
            }
          }
          await offlineCache.putServerRecord(uid, step.collection, serverDoc)
        } else if (step.type === 'update') {
          const serverDoc = await db.updateDirect(step.collection, step.recordId, step.patch)
          if (serverDoc) await offlineCache.putServerRecord(uid, step.collection, serverDoc)
          else await offlineCache.removeLocalRecord(uid, step.collection, step.recordId)
        } else if (step.type === 'remove') {
          await db.removeDirect(step.collection, step.recordId)
          await offlineCache.removeLocalRecord(uid, step.collection, step.recordId)
        }
      }
      return
    default:
      // Deliberately thrown as a non-network error so the op is kept and retried
      // rather than dropped — the engine must never silently lose a change.
      throw new Error(`Unknown queued operation kind "${op.kind}".`)
  }
}
