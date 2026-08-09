import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'

/**
 * Run an async loader and keep its result in sync with the database.
 *
 * The loader re-runs whenever `deps` change or the app's revision counter ticks
 * (which every database write does), so a borrow on the scanner page updates
 * the dashboard behind it without any manual wiring.
 *
 * @param {() => Promise<any>} loader
 * @param {any[]} deps
 * @returns {{ data, loading, error, reload, setData }}
 */
export function useAsyncData(loader, deps = [], { initial = null, enabled = true } = {}) {
  const { revision } = useApp()
  const [data, setData] = useState(initial)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(null)

  const loaderRef = useRef(loader)
  loaderRef.current = loader

  // Guards against a stale response overwriting a newer one.
  const runIdRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const run = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }
    const runId = ++runIdRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await loaderRef.current()
      if (mountedRef.current && runId === runIdRef.current) setData(result)
    } catch (err) {
      console.error('[useAsyncData] loader failed', err)
      if (mountedRef.current && runId === runIdRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      if (mountedRef.current && runId === runIdRef.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  useEffect(() => {
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, revision, ...deps])

  return { data, loading, error, reload: run, setData }
}
