/**
 * The offline read cache.
 *
 * Every collection the data layer reads successfully is written here, keyed by
 * the account that read it. When the network is unreachable — or the student has
 * turned Offline mode on — `db.list()` serves the last copy it stored instead of
 * failing, so the cached shell opens onto real records rather than an error.
 *
 * IndexedDB rather than localStorage: a laboratory's transaction history is far
 * past the 5MB localStorage ceiling, and writing it synchronously on every read
 * would block the page.
 *
 * What this is not: it is a cache of what the server already returned, never a
 * source of records of its own. Nothing is invented here, and a collection that
 * has never been read simply is not in it.
 */

const DB_NAME = 'stms-offline'
const DB_VERSION = 1
const STORE = 'collections'

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

async function withStore(mode, fn) {
  const database = await open()
  if (!database) return null
  return new Promise((resolve) => {
    let result = null
    const tx = database.transaction(STORE, mode)
    const store = tx.objectStore(STORE)
    fn(store, (value) => {
      result = value
    })
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => resolve(null)
    tx.onabort = () => resolve(null)
  })
}

/** One account's copy of one collection. */
const keyFor = (collection, uid) => `${uid ?? 'anon'}:${collection}`

/** Store what the server just returned. Failures are not worth surfacing. */
export async function putCollection(collection, uid, rows) {
  try {
    await withStore('readwrite', (store) => {
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
    const entry = await withStore('readonly', (store, done) => {
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
    await withStore('readwrite', (store) => {
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
