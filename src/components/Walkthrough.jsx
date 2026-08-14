import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * First-run guided walkthrough.
 *
 * A card over a dimmed page, driven by a list of steps. Each step names a real
 * element through `data-tour="<target>"`; the dim is punched out around that
 * element and the card is anchored beside it, so the description and the thing
 * being described are on screen together. Steps whose target is not currently
 * rendered are skipped rather than pointing at nothing, so a tour stays correct
 * as a page's optional sections come and go.
 *
 * Nothing here touches the page it explains: the highlight and the card are
 * drawn in a portal from the target's bounding box, so no host element is
 * mutated, moved or restyled, and dismissing the tour leaves the DOM as it was.
 *
 * Fitting on a phone
 * ------------------
 * Three things make this work on small screens and in the installed PWA:
 *
 *  * **The card is placed, not centred.** It goes below the target, or above it
 *    when there is no room below, and is clamped to the viewport so it can never
 *    overflow horizontally. When neither side has room — a tall target on a
 *    short screen — it falls back to a bottom sheet, which is also what a step
 *    with no target gets.
 *
 *  * **The app's own furniture is measured, not assumed.** The sticky header,
 *    the fixed bottom bar and the desktop rail are read from the DOM, and the
 *    target is scrolled into the band between them. Hard-coding those heights
 *    would break the moment the shell changed.
 *
 *  * **The page still scrolls.** Locking `body` while calling `scrollIntoView`
 *    stops the scroll from happening at all, which strands any target below the
 *    fold. Interaction is blocked by the overlay instead, so the tour can move
 *    the page and the user can too.
 */

/** Rounded cutout padding around a highlighted element. */
const SPOTLIGHT_PAD = 8
/** Gap between the spotlight and the card. */
const GAP = 12
/** Smallest margin between the card and the edge of the viewport. */
const EDGE = 12

/** Remembers a finished or skipped tour. Cleared only by clearing site data. */
export function tourSeen(key) {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    // Private-mode Safari throws on storage access; a repeated tour beats a crash.
    return false
  }
}

export function markTourSeen(key) {
  try {
    localStorage.setItem(key, '1')
  } catch {
    /* nothing to do — the tour simply shows again next visit */
  }
}

/**
 * Every page that runs a tour. Each one is remembered separately, per account
 * and per device, so finishing the Scan tour says nothing about the Borrow one
 * and a second account on the same phone still gets its own first run.
 */
export const TOUR_PAGES = [
  'dashboard',
  'tools',
  'tool-detail',
  'scan',
  'borrow',
  'transactions',
  'notifications',
  'account',
]

/** The storage key for one page's tour. Null while the session is still loading. */
export const tourKeyFor = (page, userId) => (userId ? `stms.tour.${page}.${userId}` : null)

/** Forgets every tour for one account, so they run again from the start. */
export function resetTours(userId) {
  for (const page of TOUR_PAGES) {
    const key = tourKeyFor(page, userId)
    if (!key) continue
    try {
      localStorage.removeItem(key)
    } catch {
      /* nothing to do — the flag stays and the tour simply does not return */
    }
  }
}

/**
 * Runs one page's tour on its first visit and remembers that it has been seen.
 *
 * Held one frame so the page has painted and the walkthrough can measure the
 * elements it highlights.
 */
export function usePageTour(page, userId) {
  const key = tourKeyFor(page, userId)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!key || tourSeen(key)) return
    const timer = setTimeout(() => setOpen(true), 400)
    return () => clearTimeout(timer)
  }, [key])

  const close = useCallback(() => {
    setOpen(false)
    if (key) markTourSeen(key)
  }, [key])

  return { open, close }
}

const findTarget = (target) =>
  target ? document.querySelector(`[data-tour="${CSS.escape(target)}"]`) : null

/**
 * How much of each edge the application shell occupies right now.
 *
 * Measured from the live DOM so the tour follows the shell rather than a copy
 * of its dimensions: the header is sticky, the bottom bar is phone-only, and the
 * rail appears at `lg`. Anything not on screen contributes nothing.
 */
function shellInsets() {
  const inset = { top: 0, bottom: 0, left: 0, right: 0 }
  // `offsetParent` is null for every `position: fixed` element, which is exactly
  // what the bottom bar and the desktop rail are — testing it would silently
  // report both as absent and let the card sit underneath them.
  const visible = (el) => {
    if (!el) return false
    const box = el.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  }

  const header = document.querySelector('header')
  if (visible(header)) inset.top = header.getBoundingClientRect().height

  const bottomBar = document.querySelector('nav[aria-label="Primary"]')
  if (visible(bottomBar)) {
    const box = bottomBar.getBoundingClientRect()
    // Only counts while it is actually pinned to the bottom of the viewport.
    if (box.bottom >= window.innerHeight - 1) inset.bottom = box.height
  }

  const rail = document.querySelector('aside.fixed')
  if (visible(rail)) {
    const box = rail.getBoundingClientRect()
    if (box.left <= 0) inset.left = box.right
  }

  return inset
}

/**
 * The element that actually scrolls this target.
 *
 * `body { overflow-x: hidden }` in `index.css` makes the body its own scroll
 * container, so `window.scrollBy()` silently does nothing and the page never
 * moves — which strands every target below the fold. Walking up to the nearest
 * ancestor that genuinely scrolls works whichever element that turns out to be.
 */
function scrollParent(element) {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    const scrolls = /(auto|scroll|overlay)/.test(style.overflowY)
    if (scrolls && node.scrollHeight > node.clientHeight + 1) return node
  }
  const doc = document.scrollingElement ?? document.documentElement
  if (doc.scrollHeight > doc.clientHeight + 1) return doc
  return document.body.scrollHeight > document.body.clientHeight + 1 ? document.body : doc
}


export default function Walkthrough({ steps, open, onClose, labelledBy = 'walkthrough-title' }) {
  // Only steps whose element is on the page right now, resolved once per opening
  // so the sequence cannot change length underneath the index.
  const [live, setLive] = useState([])
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState(null)
  const [placement, setPlacement] = useState(null)
  const cardRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setLive(steps.filter((step) => !step.target || findTarget(step.target)))
    setIndex(0)
  }, [open, steps])

  const step = live[index]
  const total = live.length
  const isLast = index === total - 1

  /* ------------------------- geometry: spotlight + card ------------------------- */

  const measure = useCallback(() => {
    const element = findTarget(step?.target)
    const card = cardRef.current
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight
    const inset = shellInsets()

    if (!element) {
      const noTargetInset = shellInsets()
      setRect(null)
      setPlacement({
        mode: 'sheet',
        bottom: noTargetInset.bottom + EDGE,
        left: Math.max(EDGE, noTargetInset.left + EDGE),
        right: EDGE,
        maxHeight: Math.max(160, viewportH - noTargetInset.top - noTargetInset.bottom - EDGE * 2),
      })
      return
    }

    const box = element.getBoundingClientRect()
    const spot = {
      top: box.top - SPOTLIGHT_PAD,
      left: box.left - SPOTLIGHT_PAD,
      width: box.width + SPOTLIGHT_PAD * 2,
      height: box.height + SPOTLIGHT_PAD * 2,
    }
    setRect(spot)

    // The card has to be on screen before it can be measured, so the first pass
    // runs with a sensible guess and the second corrects it.
    const cardW = card?.offsetWidth ?? Math.min(384, viewportW - EDGE * 2)

    // A card sharing a short screen with a large target may take at most part of
    // the free band; beyond that it scrolls inside itself. Without this the
    // camera viewfinder — a full-width square — and the card cannot both be
    // seen on a phone, and the card wins by covering the thing it describes.
    const bandHeight = viewportH - inset.top - inset.bottom - EDGE * 2
    // Yield further to a large target: the card gives up as much height as the
    // target needs, down to a floor where it is still readable (below which it
    // would be a scrollbar with a button in it).
    const cardMax = Math.max(
      190,
      Math.min(Math.round(bandHeight * 0.45), bandHeight - (box.height + SPOTLIGHT_PAD * 2) - GAP),
    )
    const cardH = Math.min(card?.offsetHeight ?? 260, cardMax)

    const spotBottom = spot.top + spot.height
    const spotRight = spot.left + spot.width
    const minLeft = Math.max(EDGE, inset.left + EDGE)
    const bandTop = inset.top + EDGE
    const bandBottom = viewportH - inset.bottom - EDGE

    const clampX = (x) => Math.min(Math.max(x, minLeft), Math.max(minLeft, viewportW - cardW - EDGE))
    const clampY = (y) => Math.min(Math.max(y, bandTop), Math.max(bandTop, bandBottom - cardH))

    // Below, then above, then beside. A large target — the camera viewfinder is
    // a full-width square — leaves no room vertically but often plenty to the
    // side, and pushing the card into a sheet there would cover the very thing
    // the step is pointing at.
    let top = null
    let left = null

    if (viewportH - inset.bottom - spotBottom - GAP >= cardH) {
      top = spotBottom + GAP
      left = clampX(spot.left + spot.width / 2 - cardW / 2)
    } else if (spot.top - inset.top - GAP >= cardH) {
      top = spot.top - GAP - cardH
      left = clampX(spot.left + spot.width / 2 - cardW / 2)
    } else if (viewportW - spotRight - GAP >= cardW + EDGE) {
      left = spotRight + GAP
      top = clampY(spot.top + spot.height / 2 - cardH / 2)
    } else if (spot.left - minLeft - GAP >= cardW) {
      left = spot.left - GAP - cardW
      top = clampY(spot.top + spot.height / 2 - cardH / 2)
    }

    if (top === null) {
      // Nowhere beside it fits: fall back to a sheet. Its offsets are computed
      // rather than left to CSS, so it clears the bottom bar and the rail
      // instead of sitting on top of them.
      setPlacement({
        mode: 'sheet',
        bottom: inset.bottom + EDGE,
        left: minLeft,
        right: EDGE,
        maxHeight: cardMax,
      })
      return
    }

    setPlacement({
      mode: 'anchored',
      top: clampY(top),
      left: clampX(left),
      width: cardW,
      maxHeight: cardMax,
    })
  }, [step?.target])

  /**
   * Scroll the target into the space the card actually leaves free.
   *
   * `scrollIntoView({ block: 'center' })` centres on the *viewport*, which puts
   * a target behind the bottom bar on a phone as often as not — and centring on
   * the shell's band is not enough either, because the card itself covers part
   * of that band. This aims for the region left over once the card is placed.
   *
   * When the target is taller than that region — a full-width square viewfinder
   * on a small phone, where the two genuinely cannot both fit — its top edge is
   * aligned to the top of the free region. That keeps the most useful part of
   * the element on screen and above the card, rather than centring it and
   * hiding both ends.
   */
  const revealTarget = useCallback(
    (place) => {
      const element = findTarget(step?.target)
      if (!element) return
      const inset = shellInsets()
      const card = cardRef.current
      const cardBox = card?.getBoundingClientRect()

      let freeTop = inset.top + EDGE
      let freeBottom = window.innerHeight - inset.bottom - EDGE

      if (cardBox && place) {
        if (place.mode === 'sheet') freeBottom = Math.min(freeBottom, cardBox.top - GAP)
        else if (place.mode === 'anchored') {
          const spot = element.getBoundingClientRect()
          // Only the vertical placements eat into the free region; a card beside
          // the target leaves the whole band usable.
          if (cardBox.top >= spot.bottom) freeBottom = Math.min(freeBottom, cardBox.top - GAP)
          else if (cardBox.bottom <= spot.top) freeTop = Math.max(freeTop, cardBox.bottom + GAP)
        }
      }

      const box = element.getBoundingClientRect()
      const free = freeBottom - freeTop
      if (free <= 0) return

      let delta
      if (box.height + SPOTLIGHT_PAD * 2 > free) {
        // Cannot fit: show it from the top of the free region.
        delta = box.top - SPOTLIGHT_PAD - freeTop
      } else if (box.top - SPOTLIGHT_PAD >= freeTop && box.bottom + SPOTLIGHT_PAD <= freeBottom) {
        // Already fully clear — leave the page alone so stepping back and
        // forward does not jitter the view.
        return
      } else {
        delta = box.top + box.height / 2 - (freeTop + free / 2)
      }

      if (Math.abs(delta) < 2) return
      const scroller = scrollParent(element)
      scroller.scrollBy({ top: delta, behavior: 'smooth' })
    },
    [step?.target],
  )

  useEffect(() => {
    if (!open || !step) return

    // Place first, then scroll: the card's position decides which region is
    // free, and the region decides where the target should sit. Re-measured
    // once the smooth scroll settles. Keyed to the step so it runs once per
    // step — `measure` on scroll must never feed back into another scroll.
    measure()
    const settle = setTimeout(measure, 420)

    const onViewportChange = () => measure()
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('orientationchange', onViewportChange)
    // The visual viewport moves independently when a phone keyboard opens or the
    // URL bar collapses; without this the card drifts away from its target.
    window.visualViewport?.addEventListener('resize', onViewportChange)
    window.visualViewport?.addEventListener('scroll', onViewportChange)

    // The card's own height changes with its text, which changes the placement.
    const observer = new ResizeObserver(() => measure())
    if (cardRef.current) observer.observe(cardRef.current)

    return () => {
      clearTimeout(settle)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('orientationchange', onViewportChange)
      window.visualViewport?.removeEventListener('resize', onViewportChange)
      window.visualViewport?.removeEventListener('scroll', onViewportChange)
      observer.disconnect()
    }
  }, [open, step, measure, revealTarget])

  // Place before paint, so the card never appears in the wrong spot first.
  useLayoutEffect(() => {
    if (open && step) measure()
  }, [open, step, measure])

  /**
   * Scroll the target into view once the card has been placed.
   *
   * Keyed to the step *and* the placement mode: which region is free depends on
   * where the card ended up, and the first pass often lands on a different mode
   * than the second (the card has to be rendered before it can be measured).
   * The ref stops it firing again on every re-measure, which would fight the
   * user's own scrolling.
   */
  const revealedRef = useRef(null)
  useEffect(() => {
    if (!open || !step || !placement) return
    const key = `${index}:${placement.mode}`
    if (revealedRef.current === key) return
    revealedRef.current = key
    // Called straight away rather than on a timer: `placement` is a fresh object
    // on every re-measure, so a pending timeout would be cleared by the next
    // run's cleanup before it ever fired, and the page would never move.
    revealTarget(placement)
  }, [open, step, index, placement, revealTarget])

  useEffect(() => {
    if (!open) revealedRef.current = null
  }, [open])

  /* ------------------------------- navigation ------------------------------- */
  const finish = useCallback(() => {
    setIndex(0)
    onClose?.()
  }, [onClose])

  const next = useCallback(() => {
    if (isLast) finish()
    else setIndex((i) => i + 1)
  }, [isLast, finish])

  const back = () => setIndex((i) => Math.max(0, i - 1))

  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape') finish()
      if (event.key === 'ArrowRight') next()
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, finish, next])

  if (!open || !step) return null

  const Icon = step.icon
  const anchored = placement?.mode === 'anchored'

  // A step with no target, or one whose card cannot fit beside it, is presented
  // as a bottom sheet — the same card, just parked where it always fits.
  const cardStyle = anchored
    ? {
        top: placement.top,
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
      }
    : placement?.mode === 'sheet'
      ? {
          bottom: placement.bottom,
          left: placement.left,
          right: placement.right,
          maxHeight: placement.maxHeight,
          marginInline: 'auto',
          maxWidth: '28rem',
        }
      : undefined

  return createPortal(
    <div
      className="fixed inset-0 z-[60]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      {/* Dim. With a target it is the spotlight's own outward shadow, so the
          highlighted element stays lit; without one it is a plain scrim. */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-emerald-400 animate-fade-in"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 9999px rgb(8 14 26 / 0.72)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-navy-950/70 animate-fade-in" aria-hidden="true" />
      )}

      {/* Click-catcher so the page underneath cannot be operated mid-tour. It
          does not block scrolling, so a long page can still be moved. */}
      <div className="absolute inset-0" aria-hidden="true" />

      <div
        ref={cardRef}
        style={cardStyle}
        className={
          anchored
            ? 'card absolute flex flex-col overflow-y-auto overscroll-contain p-5 shadow-panel animate-fade-in sm:p-6'
            : // Bottom sheet: inside its margins and above the bottom bar. The
              // offsets are inline, from `placement`, so the shell is respected.
              'card absolute flex flex-col overflow-y-auto overscroll-contain p-5 ' +
              'shadow-panel animate-slide-up sm:p-6'
        }
      >
        {Icon && (
          <span className="mb-3 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-500/12">
            <Icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </span>
        )}

        <p className="subtle text-[11px] font-bold uppercase tracking-wider">
          Step {index + 1} of {total}
        </p>
        <h2 id={labelledBy} className="mt-1 text-lg font-extrabold leading-tight">
          {step.title}
        </h2>
        <p className="muted mt-2 text-sm leading-relaxed">{step.text}</p>

        {/* step indicators */}
        <div className="mt-5 flex flex-wrap items-center gap-1.5" role="presentation">
          {live.map((s, i) => (
            <span
              key={s.title}
              className={
                i === index
                  ? 'h-1.5 w-6 rounded-full bg-emerald-500 transition-all'
                  : 'h-1.5 w-1.5 rounded-full transition-all'
              }
              style={i === index ? undefined : { background: 'rgb(var(--surface-3))' }}
            />
          ))}
        </div>

        <div className="mt-5 flex shrink-0 items-center justify-between gap-2">
          <button type="button" onClick={finish} className="btn btn-ghost btn-sm">
            Skip
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button type="button" onClick={back} className="btn btn-outline btn-sm">
                Back
              </button>
            )}
            <button type="button" onClick={next} className="btn btn-success">
              {isLast ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
