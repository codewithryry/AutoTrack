import { useEffect, useState } from 'react'

/**
 * Keep a panel on screen for its closing animation.
 *
 * `open` is what the caller wants; `rendered` is whether the panel is mounted,
 * which stays true for `ms` after `open` turns false, with `closing` set so the
 * panel can play its exit (CSS reads `data-state="closing"`).
 */
export function useExitTransition(open, ms = 200) {
  const [rendered, setRendered] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setRendered(true)
      setClosing(false)
      return undefined
    }
    if (!rendered) return undefined
    setClosing(true)
    const timer = setTimeout(() => {
      setRendered(false)
      setClosing(false)
    }, ms)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ms])

  return { rendered, closing, state: closing ? 'closing' : 'open' }
}
