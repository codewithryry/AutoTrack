import { useCallback, useState } from 'react'

/**
 * The scan result, kept across a trip to the tool's own page.
 *
 * `ScanPage` is unmounted the moment somebody opens "View tool details", so a
 * plain `useState` result is gone by the time they press back — which is why
 * back used to land on an empty scanner. Holding it here means the page can be
 * rebuilt in the state it was left in.
 *
 * `sessionStorage`, deliberately:
 *
 *   - It is per tab and dies with it, so a scan never outlives the session or
 *     leaks into another one. A tool's status is a live fact; restoring a
 *     week-old scan would be showing a stale record as if it were current.
 *   - It survives the unmount that a route change causes, which is the entire
 *     problem, where component state and a ref do not.
 *
 * It is a cache of something already on screen, not a source of truth. Every
 * read is guarded: a browser with storage disabled, a private window, or a
 * malformed entry simply yields no result and the scanner opens as it always
 * has. Nothing here can fail in a way that breaks scanning.
 */
const KEY = 'tooltrack:scan-result'

/** Never throws: storage can be absent, full, or refused outright. */
function read() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Only a resolved tool is worth restoring. An error result is about a scan
    // that already happened and would be confusing to come back to.
    return parsed?.tool ? parsed : null
  } catch {
    return null
  }
}

function write(value) {
  try {
    if (value?.tool) sessionStorage.setItem(KEY, JSON.stringify(value))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* Storage is a convenience here; losing it costs the restore, nothing more. */
  }
}

export function useScanResult() {
  // Seeded from storage, so a page rebuilt by "back" starts in the state it
  // was left in rather than flashing the scanner and then replacing it.
  const [result, setResultState] = useState(read)

  const setResult = useCallback((next) => {
    setResultState(next)
    write(next)
  }, [])

  const clearResult = useCallback(() => {
    setResultState(null)
    write(null)
  }, [])

  return { result, setResult, clearResult }
}
