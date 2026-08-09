import Localbase from 'localbase'

/**
 * Data access layer.
 *
 * Everything above this file talks in plain objects and promises — no component
 * imports Localbase directly. Swapping IndexedDB for a REST API later means
 * reimplementing the handful of primitives exported here (`list`, `get`,
 * `insert`, `update`, `remove`, `replaceAll`) and nothing else.
 *
 * Two implementation notes that shape the code below:
 *
 * 1. Localbase has no query engine, so reads pull a whole collection and filter
 *    in memory. At laboratory scale that is instant, and a cache keyed by
 *    collection stops the dashboard re-reading the same rows for every widget.
 *
 * 2. Localbase stores the pending collection/document selection on the database
 *    *instance*, so two overlapping chains can clobber each other's target.
 *    Every operation therefore runs through `enqueue`, a one-at-a-time promise
 *    queue. It also serialises IndexedDB store creation, which avoids the
 *    version-upgrade races localforage hits when several new stores are opened
 *    at once.
 */

export const DB_NAME = 'smart-tool-monitoring'

export const COLLECTIONS = {
  users: 'users',
  tools: 'tools',
  transactions: 'transactions',
  notifications: 'notifications',
  maintenance: 'maintenance',
  activityLogs: 'activityLogs',
  settings: 'settings',
}

export const ALL_COLLECTIONS = Object.values(COLLECTIONS)

const db = new Localbase(DB_NAME)
// Localbase logs every operation by default; keep the console usable.
db.config.debug = false

/* ------------------------------------------------------------------ *
 * Serial operation queue
 * ------------------------------------------------------------------ */

let tail = Promise.resolve()

function enqueue(operation) {
  const run = tail.then(operation, operation)
  // Keep the chain alive even when an operation rejects.
  tail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/* ------------------------------------------------------------------ *
 * Cache + change notification
 * ------------------------------------------------------------------ */

const cache = new Map()
const listeners = new Set()

/** Subscribe to writes. The listener receives the collection name, or '*'. */
export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(collection) {
  if (collection === '*') cache.clear()
  else cache.delete(collection)
  for (const listener of listeners) {
    try {
      listener(collection)
    } catch (err) {
      console.error('[db] change listener failed', err)
    }
  }
}

export function invalidate(collection) {
  if (collection) cache.delete(collection)
  else cache.clear()
}

/* ------------------------------------------------------------------ *
 * Internal primitives (already inside the queue)
 * ------------------------------------------------------------------ */

async function readCollection(collection) {
  try {
    const rows = await db.collection(collection).get()
    return Array.isArray(rows) ? rows : []
  } catch (err) {
    console.error(`[db] failed to read "${collection}"`, err)
    return []
  }
}

async function writeDoc(collection, key, doc) {
  await db.collection(collection).add(doc, key)
}

async function deleteDoc(collection, key) {
  try {
    await db.collection(collection).doc(key).delete()
  } catch {
    // Deleting a key that is already gone is not an error for callers.
  }
}

/**
 * Empty a collection by removing each document.
 *
 * Localbase's `collection().delete()` drops the whole IndexedDB object store,
 * which forces a version upgrade and can leave later writes pointing at a
 * detached store. Removing documents individually keeps the store intact.
 */
async function emptyCollection(collection) {
  const rows = await readCollection(collection)
  for (const row of rows) {
    if (row?.id != null) await deleteDoc(collection, row.id)
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** Every document in a collection. Returns `[]` for a collection with no rows. */
export async function list(collection) {
  const cached = cache.get(collection)
  if (cached) return cached
  const rows = await enqueue(() => readCollection(collection))
  cache.set(collection, rows)
  return rows
}

/** Read several collections in one call. */
export async function listMany(names) {
  const rows = await Promise.all(names.map((n) => list(n)))
  return names.reduce((acc, name, i) => {
    acc[name] = rows[i]
    return acc
  }, {})
}

export async function get(collection, id) {
  if (id == null) return null
  const rows = await list(collection)
  return rows.find((r) => r.id === id) ?? null
}

export async function query(collection, predicate) {
  const rows = await list(collection)
  return typeof predicate === 'function' ? rows.filter(predicate) : rows
}

export async function count(collection, predicate) {
  return (await query(collection, predicate)).length
}

export async function exists(collection, id) {
  return (await get(collection, id)) != null
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Insert a document. The document's `id` doubles as the IndexedDB key, so
 * key-based reads and deletes stay cheap.
 */
export async function insert(collection, doc) {
  if (!doc?.id) throw new Error(`[db] cannot insert into "${collection}" without an id`)
  await enqueue(() => writeDoc(collection, doc.id, doc))
  emit(collection)
  return doc
}

export async function insertMany(collection, docs) {
  if (!docs.length) return docs
  await enqueue(async () => {
    for (const doc of docs) {
      if (!doc?.id) throw new Error(`[db] cannot insert into "${collection}" without an id`)
      await writeDoc(collection, doc.id, doc)
    }
  })
  emit(collection)
  return docs
}

/** Shallow-merge a patch into an existing document. */
export async function update(collection, id, patch) {
  const current = await get(collection, id)
  if (!current) throw new Error(`[db] "${id}" was not found in "${collection}"`)
  const next = { ...current, ...patch, id }
  await enqueue(() => writeDoc(collection, id, next))
  emit(collection)
  return next
}

/** Insert when absent, merge when present. */
export async function upsert(collection, doc) {
  const current = await get(collection, doc.id)
  if (current) return update(collection, doc.id, doc)
  return insert(collection, doc)
}

export async function remove(collection, id) {
  await enqueue(() => deleteDoc(collection, id))
  emit(collection)
  return true
}

export async function removeWhere(collection, predicate) {
  const rows = await query(collection, predicate)
  if (!rows.length) return 0
  await enqueue(async () => {
    for (const row of rows) await deleteDoc(collection, row.id)
  })
  emit(collection)
  return rows.length
}

/** Replace an entire collection — used by seeding and database import. */
export async function replaceAll(collection, docs) {
  await enqueue(async () => {
    await emptyCollection(collection)
    for (const doc of docs) {
      if (doc?.id != null) await writeDoc(collection, doc.id, doc)
    }
  })
  emit(collection)
  return docs
}

export async function clearCollection(collection) {
  await enqueue(() => emptyCollection(collection))
  emit(collection)
}

export async function clearAll() {
  await enqueue(async () => {
    for (const name of ALL_COLLECTIONS) await emptyCollection(name)
  })
  emit('*')
}

/**
 * Open every collection once, sequentially, before the app starts reading them
 * in parallel. localforage creates an object store lazily on first use and each
 * creation bumps the IndexedDB version; doing them one at a time avoids the
 * upgrade collisions that otherwise surface as `InvalidStateError` on load.
 */
export async function ready() {
  await enqueue(async () => {
    for (const name of ALL_COLLECTIONS) {
      try {
        await db.collection(name).get()
      } catch (err) {
        console.error(`[db] could not open "${name}"`, err)
      }
    }
  })
  return true
}

/* ------------------------------------------------------------------ *
 * Import / export
 * ------------------------------------------------------------------ */

export async function exportDatabase() {
  const data = {}
  for (const name of ALL_COLLECTIONS) {
    data[name] = await list(name)
  }
  return {
    meta: {
      app: 'smart-tool-monitoring',
      version: 1,
      exportedAt: new Date().toISOString(),
      counts: Object.fromEntries(ALL_COLLECTIONS.map((n) => [n, data[n].length])),
    },
    data,
  }
}

/**
 * Restore a previously exported snapshot. The payload is validated before
 * anything is deleted, so a malformed file cannot wipe the laboratory records.
 */
export async function importDatabase(payload) {
  const data = payload?.data
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid backup file: missing a "data" section.')
  }
  const known = ALL_COLLECTIONS.filter((n) => Array.isArray(data[n]))
  if (!known.length) {
    throw new Error('Invalid backup file: no recognised collections were found.')
  }
  const summary = {}
  for (const name of known) {
    const rows = data[name].filter((r) => r && typeof r === 'object' && r.id != null)
    await replaceAll(name, rows)
    summary[name] = rows.length
  }
  emit('*')
  return summary
}

export async function stats() {
  const entries = await Promise.all(ALL_COLLECTIONS.map(async (n) => [n, (await list(n)).length]))
  return Object.fromEntries(entries)
}

/** Escape hatch for debugging from the browser console. */
export const raw = db
