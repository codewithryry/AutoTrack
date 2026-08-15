/**
 * The offline store: a read cache plus an outbox of changes waiting to sync.
 *
 * Read cache
 * ----------
 * Every collection the data layer reads successfully is written here, keyed by
 * the account that read it. When the network is unreachable — or the student has
 * turned Offline mode on — `db.list()` serves the last copy it stored instead of
 * failing, so the cached shell opens onto real records rather than an error.
 *
 * Outbox
 * ------
 * A mutation made while there is no connection is queued here instead of being
 * refused. Each queued op is the exact change the caller intended, so the sync
 * engine (`services/sync.js`) can replay it to the server in order once the
 * connection returns. Until then the pending rows are overlaid on top of every
 * read (`overlayPendingRows`), marked with `__pending` so a screen can tell a
 * locally-made change from one that has reached the laboratory database.
 *
 * A pending op that is mid-flight is "leased" (`lockedAt`) so a second sync pass
 * — another tab, another app window — does not replay it at the same time.
 *
 * IndexedDB rather than localStorage: a laboratory's transaction history is far
 * past the 5MB localStorage ceiling, and writing it synchronously on every read
 * would block the page.
 *
 * What this is not: it is a cache of what the server already returned plus the
 * account's own unsynced changes, never a source of records of its own. Nothing
 * is invented here, and a collection that has never been read simply is not in
 * it.
 */

import { uid as makeId, unique } from '../utils/helpers'

const DB_NAME = 'stms-offline'
const DB_VERSION = 2
const STORE = 'collections'
const OUTBOX_STORE = 'outbox'

/**
 * The marker on a locally-created or locally-edited record that has not reached
 * the server yet. `db.toRow()` strips every `__`-prefixed key before a write, so
 * the marker can never leak into the laboratory database.
 */
export const PENDING_FLAG = '__pending'

/** How long a leased op stays reserved to its sync pass, in milliseconds. */
export const OP_LEASE_MS = 60_000

let handle = null

function open() {
  if (handle) return handle
  handle = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
      if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
        database.createObjectStore(OUTBOX_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    // Private browsing and blocked storage both land here. The app still works;
    // it simply has nothing to fall back on when the connection goes.
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
    void reject
  })
  return handle
}

async function withStore(storeName, mode, fn) {
  const database = await open()
  if (!database) return null
  return new Promise((resolve) => {
    let result = null
    const tx = database.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    fn(store, (value) => {
      result = value
    })
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => resolve(null)
    tx.onabort = () => resolve(null)
  })
}

/* ------------------------------------------------------------------ *
 * Read cache
 * ------------------------------------------------------------------ */

/** One account's copy of one collection. */
const keyFor = (collection, uid) => `${uid ?? 'anon'}:${collection}`

/** Store what the server just returned. Failures are not worth surfacing. */
export async function putCollection(collection, uid, rows) {
  try {
    await withStore(STORE, 'readwrite', (store) => {
      store.put({ rows, storedAt: Date.now() }, keyFor(collection, uid))
    })
  } catch {
    /* the cache is best-effort by design */
  }
}

/**
 * The last copy of a collection, or `null` when it has never been read on this
 * device by this account — which the caller must report honestly rather than
 * presenting as an empty laboratory.
 */
export async function getCollection(collection, uid) {
  try {
    const entry = await withStore(STORE, 'readonly', (store, done) => {
      const request = store.get(keyFor(collection, uid))
      request.onsuccess = () => done(request.result ?? null)
    })
    return entry?.rows ?? null
  } catch {
    return null
  }
}

/** Drops everything cached for one account — used when it signs out. */
export async function clearAccount(uid) {
  try {
    await withStore(STORE, 'readwrite', (store) => {
      const request = store.getAllKeys()
      request.onsuccess = () => {
        const prefix = `${uid ?? 'anon'}:`
        for (const key of request.result ?? []) {
          if (String(key).startsWith(prefix)) store.delete(key)
        }
      }
    })
  } catch {
    /* nothing to do */
  }
}

/* ------------------------------------------------------------------ *
 * Outbox
 * ------------------------------------------------------------------ */

/** A pending op's shape: `{ id, uid, kind, collection, createdAt, ... }`. */
export async function enqueueOp(uid, op) {
  const database = await open()
  if (!database) {
    // IndexedDB blocked or absent: queuing would silently drop the change.
    // Refuse loudly rather than let the caller believe it was saved.
    throw new Error('Offline storage is unavailable on this device.')
  }
  const record = {
    ...op,
    id: op.id ?? makeId('OP'),
    uid: uid ?? null,
    createdAt: op.createdAt ?? new Date().toISOString(),
    attempts: op.attempts ?? 0,
    lockedAt: op.lockedAt ?? null,
    lastError: op.lastError ?? null,
    lastAttemptAt: op.lastAttemptAt ?? null,
  }
  await withStore(OUTBOX_STORE, 'readwrite', (store) => store.put(record))
  return record
}

/**
 * The account's queued ops, oldest first, so the sync engine replays changes in
 * the order they were made. `includeLocked: false` skips ops another pass is
 * currently replaying (their lease has not expired yet).
 */
export async function pendingOps(uid, { includeLocked = false } = {}) {
  const entries = await withStore(OUTBOX_STORE, 'readonly', (store, done) => {
    const request = store.getAll()
    request.onsuccess = () => done(request.result ?? [])
  })
  if (!entries) return []
  const cutoff = Date.now() - OP_LEASE_MS
  return entries
    .filter((op) => op.uid === (uid ?? null))
    .filter((op) => includeLocked || op.lockedAt == null || op.lockedAt <= cutoff)
    .sort((a, b) =>
      a.createdAt === b.createdAt
        ? String(a.id).localeCompare(String(b.id))
        : String(a.createdAt).localeCompare(String(b.createdAt)),
    )
}

/** Forget an op once it has reached the server. */
export async function removeOp(id) {
  await withStore(OUTBOX_STORE, 'readwrite', (store) => store.delete(id))
}

/** Update a queued op (lease, attempt count, last error). Returns it, or null. */
export async function touchOp(id, patch) {
  return withStore(OUTBOX_STORE, 'readwrite', (store, done) => {
    const request = store.get(id)
    request.onsuccess = () => {
      const current = request.result
      if (!current) {
        done(null)
        return
      }
      const next = { ...current, ...patch }
      store.put(next)
      done(next)
    }
  })
}

/** How many of the account's changes are still waiting for the server. */
export async function countPending(uid) {
  const entries = await withStore(OUTBOX_STORE, 'readonly', (store, done) => {
    const request = store.getAll()
    request.onsuccess = () => done(request.result ?? [])
  })
  return (entries ?? []).filter((op) => op.uid === (uid ?? null)).length
}

/** Drop every queued op for an account — used when it signs out. */
export async function clearAccountOutbox(uid) {
  await withStore(OUTBOX_STORE, 'readwrite', (store) => {
    const request = store.getAll()
    request.onsuccess = () => {
      for (const op of request.result ?? []) {
        if (op.uid === (uid ?? null)) store.delete(op.id)
      }
    }
  })
}

/* ------------------------------------------------------------------ *
 * Applying a queued op to a collection of rows
 *
 * These are the pure transforms the read path uses to show pending changes and
 * the sync path uses to reconcile the cache. They never touch the network or
 * the database — only the array handed in.
 * ------------------------------------------------------------------ */

/** The marker applied to any row a pending op touches. */
const withPending = (doc) => ({ ...doc, [PENDING_FLAG]: true })

/** All collections one op writes to, so a cache write can touch exactly those. */
export function collectionsFor(op) {
  if (!op) return []
  if (op.kind === 'atomic') {
    return unique((op.steps ?? []).map((step) => step.collection).filter(Boolean))
  }
  return op.collection ? [op.collection] : []
}

function replaceOrAppend(rows, doc) {
  const index = rows.findIndex((row) => row.id === doc.id)
  if (index === -1) return [...rows, doc]
  const out = [...rows]
  out[index] = doc
  return out
}

function applyAtomicStep(collection, step, rows) {
  if (step?.collection !== collection) return rows
  switch (step.type) {
    case 'set':
      return replaceOrAppend(rows, withPending(step.document))
    case 'update':
      return rows.map((row) =>
        row.id === step.recordId ? withPending({ ...row, ...step.patch }) : row,
      )
    case 'remove':
      return rows.filter((row) => row.id !== step.recordId)
    default:
      return rows
  }
}

/**
 * The rows a collection would show with `op` applied on top. Pure and
 * deterministic: applying the same op twice gives the same result, which is what
 * makes overlaying an already-overlaid cache safe.
 */
export function applyOpToRows(collection, op, rows) {
  const base = rows ?? []
  switch (op?.kind) {
    case 'insert':
    case 'upsert':
      return op.collection === collection ? replaceOrAppend(base, withPending(op.document)) : base
    case 'update':
      return op.collection === collection
        ? base.map((row) =>
            row.id === op.recordId ? withPending({ ...row, ...op.patch }) : row,
          )
        : base
    case 'remove':
      return op.collection === collection ? base.filter((row) => row.id !== op.recordId) : base
    case 'insertMany': {
      if (op.collection !== collection) return base
      return (op.documents ?? []).reduce((out, doc) => replaceOrAppend(out, withPending(doc)), base)
    }
    case 'removeMany': {
      if (op.collection !== collection) return base
      const ids = new Set(op.ids ?? [])
      return base.filter((row) => !ids.has(row.id))
    }
    case 'atomic':
      return (op.steps ?? []).reduce((out, step) => applyAtomicStep(collection, step, out), base)
    default:
      return base
  }
}

/**
 * Overlay every queued op onto a collection's rows — the read-side view. The
 * sync engine keeps leased ops in the overlay too, so nothing pending ever
 * flickers away while it is being written to the server.
 */
export async function overlayPendingRows(uid, collection, rows) {
  const ops = await pendingOps(uid, { includeLocked: true })
  return ops.reduce((out, op) => applyOpToRows(collection, op, out), rows ?? [])
}

/** Persist the pending view of a collection into the cache. */
export async function applyOpToCache(uid, op) {
  for (const collection of collectionsFor(op)) {
    const rows = await getCollection(collection, uid)
    if (!rows) continue
    await putCollection(collection, uid, applyOpToRows(collection, op, rows))
  }
}

/**
 * Replace a pending row with the copy the server returned once it has synced,
 * so the cache is current before the next read even happens.
 */
export async function putServerRecord(uid, collection, doc) {
  if (!doc?.id) return
  const rows = await getCollection(collection, uid)
  if (!rows) return
  const clean = { ...doc }
  delete clean[PENDING_FLAG]
  await putCollection(collection, uid, replaceOrAppend(rows, clean))
}

/** Drop a record from the cache after its removal has reached the server. */
export async function removeLocalRecord(uid, collection, id) {
  const rows = await getCollection(collection, uid)
  if (!rows) return
  const next = rows.filter((row) => row.id !== id)
  if (next.length === rows.length) return
  await putCollection(collection, uid, next)
}
