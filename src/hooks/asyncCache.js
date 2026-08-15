/**
 * The in-memory result cache behind `useAsyncData`.
 *
 * Its own module so the app context can clear it on a session change without
 * importing the hook that reads the context — which would be a cycle.
 */

const cache = new Map()

export const readCache = (key) => (key && cache.has(key) ? cache.get(key) : undefined)

export function writeCache(key, value) {
  if (key) cache.set(key, value)
}

/**
 * Forget one cached result — for a record that has just been deleted, so it is
 * not served from memory the next time its key is mounted.
 */
export const dropCache = (key) => {
  if (key) cache.delete(key)
}

/** Forgets every cached result. Called when the signed-in account changes. */
export function clearAsyncCache() {
  cache.clear()
}
