import { useEffect, useRef } from 'react'

/**
 * Close a session that has been left standing.
 *
 * Idle is measured from the last thing the *person* did. Only real input
 * counts — a pointer, a key, a touch, a wheel — so the app's own background
 * work cannot hold a session open: sync passes, the revision counter, the
 * overdue sweep and any record arriving from another machine all happen without
 * touching the clock below.
 *
 * The stamp lives in `localStorage`, which is what makes an installed app and a
 * browser tab behave the same: closing the app does not pause the limit, so a
 * PWA reopened after the limit has passed expires on its first check instead of
 * resuming a session that was idle all night. It is read on wake-up too, so a
 * phone that was asleep is judged on elapsed time rather than on timers the
 * system stopped running.
 *
 * @param {object} options
 * @param {boolean} options.enabled     off for roles the limit does not cover
 * @param {number}  options.timeoutMs
 * @param {string|null} options.uid     the stamp is per account
 * @param {() => void} options.onExpire called once, when the limit passes
 */

/** Real input, not anything the app does to itself. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel']

/** How often the elapsed time is checked, and the finest resolution of a stamp. */
const CHECK_INTERVAL_MS = 15_000
const WRITE_INTERVAL_MS = 5_000

const keyFor = (uid) => `stms.activity:${uid ?? 'anon'}`

export function useIdleTimeout({ enabled, timeoutMs, uid, onExpire }) {
  // Read through refs so re-renders never restart the listeners or the clock.
  const expire = useRef(onExpire)
  expire.current = onExpire

  useEffect(() => {
    if (!enabled || !timeoutMs) return

    const key = keyFor(uid)
    let lastWrite = 0
    let done = false

    // The stamp is written at most this often, so a drag or a held key does not
    // write on every event. Kept well inside the limit — a coarser resolution
    // than the limit itself would let a stamp go stale while someone is working.
    const writeEvery = Math.max(250, Math.min(WRITE_INTERVAL_MS, Math.floor(timeoutMs / 10)))

    const now = () => Date.now()
    const read = () => {
      try {
        return Number(window.localStorage.getItem(key)) || 0
      } catch {
        return 0
      }
    }
    const write = (at) => {
      try {
        window.localStorage.setItem(key, String(at))
      } catch {
        /* storage unavailable: the in-memory interval below still applies */
      }
    }

    // An existing stamp is kept, never refreshed: time spent with the app shut
    // is still time the session stood idle, so an installed app reopened after
    // the limit expires on the check below instead of being handed a fresh
    // window by the act of opening it. Signing out clears the stamp, so a new
    // sign-in genuinely starts from now.
    if (!read()) write(now())

    const touch = () => {
      const at = now()
      if (at - lastWrite < writeEvery) return
      lastWrite = at
      write(at)
    }

    const check = () => {
      if (done) return
      const last = read()
      if (!last) return
      if (now() - last < timeoutMs) return
      done = true
      expire.current?.()
    }

    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, touch, { passive: true, capture: true })
    }
    // Coming back to the app is the moment to judge the time that passed while
    // it was hidden — a backgrounded tab or a closed PWA runs no interval.
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)

    // Fine enough that the limit is honoured promptly, and never coarser than a
    // quarter of it — so a short limit is not overshot by the checking rate.
    const every = Math.max(1000, Math.min(CHECK_INTERVAL_MS, Math.floor(timeoutMs / 4)))
    const interval = window.setInterval(check, every)
    check()

    return () => {
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, touch, { capture: true })
      }
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      window.clearInterval(interval)
    }
  }, [enabled, timeoutMs, uid])
}

/** Forget an account's idle stamp — used when its session ends. */
export function clearIdleStamp(uid) {
  try {
    window.localStorage.removeItem(keyFor(uid))
  } catch {
    /* nothing to clear */
  }
}
