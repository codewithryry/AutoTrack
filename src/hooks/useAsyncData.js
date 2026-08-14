import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import { readCache, writeCache } from './asyncCache'

/**
 * Run an async loader and keep its result in sync with the database.
 *
 * The loader re-runs whenever `deps` change or the app's revision counter ticks
 * (which every database write does), so a borrow on the scanner page updates
 * the dashboard behind it without any manual wiring.
 *
 * Navigating back to a page must not look like a fresh load. A keyed hook keeps
 * its last result in the module cache below, so a second mount renders that
 * result on the first paint and revalidates behind it: the skeletons belong to
 * the genuinely-empty first load, not to every visit. An unkeyed hook behaves
 * exactly as it always did.
 *
 * The cache is in-memory only and holds whatever the signed-in account was
 * allowed to read, so it is dropped on a session change (`clearAsyncCache` in
 * `hooks/asyncCache.js`) rather than left for the next account on a shared
 * laboratory machine.
 *
 * @param {() => Promise<any>} loader
 * @param {any[]} deps
 * @returns {{ data, loading, error, reload, setData }}
 */

export function useAsyncData(
  loader,
  deps = [],
  { initial = null, enabled = true, cacheKey = null } = {},
) {
  const { revision } = useApp()
  const cached = readCache(cacheKey)
  const [data, setData] = useState(cached === undefined ? initial : cached)
  // Only the first load — with nothing to show — is a loading state. A revisit
  // or a revalidation renders the cached records while the request runs.
  const [loading, setLoading] = useState(enabled && cached === undefined)
  const [error, setError] = useState(null)

  const loaderRef = useRef(loader)
  loaderRef.current = loader

  // Whether anything is on screen right now, read inside `run` without making
  // it depend on the data (which would re-run the effect on every result).
  const hasDataRef = useRef(cached !== undefined)

  // Guards against a stale response overwriting a newer one.
  const runIdRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // A keyed hook whose key changes is looking at a different record — the tool
  // detail page moving from one tool to the next. Its previous result must not
  // stand in for the new one, so the state is resynced from that key's cache (or
  // back to the initial value, which is what shows the loading state again).
  const keyRef = useRef(cacheKey)
  if (keyRef.current !== cacheKey) {
    keyRef.current = cacheKey
    const next = readCache(cacheKey)
    hasDataRef.current = next !== undefined
    setData(next === undefined ? initial : next)
    setLoading(enabled && next === undefined)
  }

  const run = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }
    const runId = ++runIdRef.current
    // Silent when there is already something to look at.
    if (!hasDataRef.current) setLoading(true)
    setError(null)
    try {
      const result = await loaderRef.current()
      if (mountedRef.current && runId === runIdRef.current) {
        setData(result)
        hasDataRef.current = true
      }
      if (runId === runIdRef.current) writeCache(cacheKey, result)
    } catch (err) {
      console.error('[useAsyncData] loader failed', err)
      if (mountedRef.current && runId === runIdRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      if (mountedRef.current && runId === runIdRef.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cacheKey])

  useEffect(() => {
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, revision, ...deps])

  return { data, loading, error, reload: run, setData }
}
