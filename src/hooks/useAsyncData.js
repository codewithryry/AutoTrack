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

  /* ------------------------------------------------------------------ *
   * Background revalidation
   *
   * Realtime is the first way a screen learns that something moved, and it
   * covers the tables the app publishes. This is the safety net under it: a
   * quiet re-read while the tab is actually being looked at, and one the moment
   * it is looked at again after being in the background — which is exactly when
   * a phone has been asleep and the socket has been dropped.
   *
   * It re-runs the same loader, so nothing about permissions or scoping
   * changes, and it goes through `run()` above: with data already on screen the
   * loading flag is never raised, so the page never blanks and no filter,
   * search, selection or form state is touched. Only the resolved data changes.
   * ------------------------------------------------------------------ */
  const lastRunRef = useRef(0)
  useEffect(() => {
    if (!enabled) return
    const stamp = () => {
      lastRunRef.current = performance.now()
    }
    stamp()

    // Never twice inside this window, however many signals arrive at once.
    const MIN_GAP = 15_000
    const INTERVAL = 60_000

    const revalidate = () => {
      if (document.visibilityState === 'hidden') return
      if (performance.now() - lastRunRef.current < MIN_GAP) return
      stamp()
      run()
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') revalidate()
    }

    const timer = setInterval(revalidate, INTERVAL)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', revalidate)
    window.addEventListener('online', revalidate)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', revalidate)
      window.removeEventListener('online', revalidate)
    }
  }, [run, enabled])

  return { data, loading, error, reload: run, setData }
}
