import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A small, self-positioning tooltip.
 *
 * Wraps a trigger and shows `label` on hover (mouse), on focus (keyboard) and on
 * tap (touch). The bubble is rendered into the document body and positioned
 * from the trigger's bounding box — centered above it, flipped below when there
 * is no room above, and clamped to the viewport on every edge — so it stays
 * attached to the element it explains, never clips against a card's overflow,
 * and never overlaps the shell or the bottom bar. `pointer-events: none` means
 * it cannot get in the way of the thing it labels.
 *
 * A missing label renders the trigger with no bubble at all, which is how a
 * tooltip is hidden conditionally (a disabled button, a blank value, …).
 */
const GAP = 6
const EDGE = 8

/**
 * The lowest edge of the screen the bubble may reach.
 *
 * On a phone the primary navigation floats over the page, so a bubble flipped
 * below a trigger near the foot of the list would be painted underneath it — and
 * on the notification rows, where the trigger is a small icon button and the page
 * is long, that is exactly where it lands. Measured from the live DOM rather than
 * hard-coded, since the bar is phone-only and carries the device's safe-area
 * inset under it.
 */
function floorOf() {
  const bar = document.querySelector('nav[aria-label="Primary"]')
  const box = bar?.getBoundingClientRect()
  if (box?.height && box.bottom >= window.innerHeight - 64) return box.top - GAP
  return window.innerHeight
}

/** Where the shell's sticky header ends, so a bubble is never tucked behind it. */
function ceilingOf() {
  const header = document.querySelector('header')
  const box = header?.getBoundingClientRect()
  return box?.height && box.top <= 0 ? box.bottom + GAP : 0
}

export default function Tooltip({ label, children, className }) {
  const hostRef = useRef(null)
  const tipRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const enabled = Boolean(label)

  const position = useCallback(() => {
    const host = hostRef.current
    const tip = tipRef.current
    if (!host || !tip) return
    // Measure the trigger itself, not the inline wrapper, so the bubble hugs the
    // button or span the developer actually attached it to.
    const target = host.firstElementChild ?? host
    const box = target.getBoundingClientRect()
    const width = tip.offsetWidth
    const height = tip.offsetHeight
    const left = Math.min(
      Math.max(EDGE, box.left + box.width / 2 - width / 2),
      Math.max(EDGE, window.innerWidth - width - EDGE),
    )

    // Above the trigger by default, below it when the header would cut that off,
    // and clamped into the band the shell actually leaves free either way — so the
    // bubble stays beside the element it explains instead of behind the header or
    // under the floating navigation bar.
    const ceiling = Math.max(EDGE, ceilingOf())
    const floor = Math.min(window.innerHeight - EDGE, floorOf())
    const above = box.top - height - GAP
    const top =
      above >= ceiling ? above : Math.min(Math.max(ceiling, box.bottom + GAP), floor - height)
    setPos({ top: Math.max(EDGE, top), left })
  }, [])

  useLayoutEffect(() => {
    if (!open || !enabled) return
    position()
    const refresh = () => position()
    window.addEventListener('scroll', refresh, true)
    window.addEventListener('resize', refresh)
    window.visualViewport?.addEventListener('scroll', refresh)
    window.visualViewport?.addEventListener('resize', refresh)
    return () => {
      window.removeEventListener('scroll', refresh, true)
      window.removeEventListener('resize', refresh)
      window.visualViewport?.removeEventListener('scroll', refresh)
      window.visualViewport?.removeEventListener('resize', refresh)
    }
  }, [open, enabled, position])

  const hide = useCallback(() => setOpen(false), [])

  // A tap on a phone never leaves the trigger, so dismissing needs an explicit
  // "tap anywhere else" handler rather than a hover-out event.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event) => {
      if (hostRef.current?.contains(event.target)) return
      hide()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, hide])

  if (!enabled) return <>{children}</>

  return (
    <span
      ref={hostRef}
      className="inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={hide}
      onFocus={() => setOpen(true)}
      onBlur={hide}
    >
      {children}
      {open &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            className={`pointer-events-none fixed z-[80] rounded-md bg-navy-950 px-2 py-1 text-[11px] font-semibold leading-snug text-white shadow-panel animate-fade-in ${className ?? ''}`}
            style={{ top: pos.top, left: pos.left, maxWidth: 'min(240px, calc(100vw - 16px))' }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  )
}
