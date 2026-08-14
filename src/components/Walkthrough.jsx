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
 *  * **A target longer than the screen keeps the card at the top.** The tool
 *    inventory and the loans list both run past the fold, so the card is parked
 *    at the top of the free band and the highlight begins immediately below it:
 *    the assistant, its message and the first tool records read as one block
 *    instead of the message ending up a whole phone away from the top of the list
 *    it describes.
 *
 *  * **The highlight is trimmed to the screen.** The spotlight is a ring on the
 *    cutout's own edge, so an edge past the viewport is an edge the student
 *    cannot see — a full-width element padded outwards loses its left and right
 *    sides that way, and a long list its bottom. The cutout is clipped to the
 *    visible area so the ring always closes.
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
/** Width of the spotlight's ring, which has to stay inside the viewport to show. */
const RING = 3
/** How far below the card the target may start before the page is scrolled. */
const SLACK = 88

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
  'maintenance',
  'users',
  'reports',
  'notifications',
  'account',
]

/** The storage key for one page's tour. Null while the session is still loading. */
export const tourKeyFor = (page, userId) => (userId ? `stms.tour.${page}.${userId}` : null)

/**
 * A legacy flag from when one finished tour ended the whole walkthrough — which
 * meant an account only ever saw the first page it happened to open. It is no
 * longer read; it is still cleared by `resetTours` so an account carrying it is
 * not left in the old state.
 */
const walkthroughKeyFor = (userId) => (userId ? `stms.tour.done.${userId}` : null)

/** Forgets every tour for one account, so they run again from the start. */
export function resetTours(userId) {
  const keys = [...TOUR_PAGES.map((page) => tourKeyFor(page, userId)), walkthroughKeyFor(userId)]
  for (const key of keys) {
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
 * Each page is remembered on its own, per account — so an administrator, an
 * instructor and a student each work through their own role's pages once, and
 * finishing or skipping one page's tour never suppresses the rest of that
 * role's walkthrough. Once a page's tour has been closed it does not return on
 * a later sign-in, refresh or revisit; only "Show tours again" in Settings
 * brings the walkthrough back.
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
    // The bar floats: its wrapper holds it clear of the bottom edge and adds the
    // device's safe-area inset underneath, so it never reaches the very bottom of
    // the viewport. Testing for that exactly reported it as absent and let the
    // card sit under it. The whole strip from its top edge down is unusable —
    // including the gap below it, which is where the home indicator lives.
    if (box.bottom >= window.innerHeight - 64) inset.bottom = window.innerHeight - box.top
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


export default function Walkthrough({
  steps,
  open,
  onClose,
  labelledBy = 'walkthrough-title',
  compact = false,
}) {
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

    const minLeft = Math.max(EDGE, inset.left + EDGE)
    const bandTop = inset.top + EDGE
    const bandBottom = viewportH - inset.bottom - EDGE
    // The band the shell leaves free: everything below the sticky header and
    // above the bottom bar. A card sharing a short screen with a large target may
    // take at most part of it; beyond that it scrolls inside itself. Without this
    // the camera viewfinder — a full-width square — and the card cannot both be
    // seen on a phone, and the card wins by covering the thing it describes.
    const bandHeight = bandBottom - bandTop

    if (!element) {
      setRect(null)
      setPlacement({
        mode: 'sheet',
        bottom: inset.bottom + EDGE,
        left: minLeft,
        right: EDGE,
        maxHeight: Math.max(160, bandHeight),
      })
      return
    }

    const box = element.getBoundingClientRect()

    // The card has to be on screen before it can be measured, so the first pass
    // runs with a sensible guess and the second corrects it — but the guess is
    // also a ceiling. Before a placement exists the card is absolutely positioned
    // with no width of its own, so a paragraph of text stretches it to the full
    // width of the overlay; measuring that once would fix the card a whole margin
    // wider than the screen for the rest of the tour.
    const widest = Math.min(compact ? 352 : 384, viewportW - EDGE * 2)
    const cardW = Math.min(card?.offsetWidth || widest, widest)

    // Yield to a large target: the card gives up as much height as the target
    // needs, down to a floor where it is still readable — below which it would be
    // a scrollbar with a button in it. A compact card keeps a little more of the
    // band, since it carries the assistant beside its message.
    //
    // Yielding only makes sense while there is something to yield to. A target
    // longer than the whole band — the tool inventory, a full loans list — cannot
    // be fitted alongside the card however small the card is made, so squeezing
    // it there buys nothing and costs the step its last two lines to an internal
    // scrollbar. In that case the card simply takes its usual share.
    const share = Math.round(bandHeight * (compact ? 0.56 : 0.45))
    const alongside = bandHeight - (box.height + SPOTLIGHT_PAD * 2) - GAP
    const cardMax = alongside < 190 ? share : Math.max(190, Math.min(share, alongside))
    const cardH = Math.min(card?.offsetHeight ?? 260, cardMax)

    const clampX = (x) => Math.min(Math.max(x, minLeft), Math.max(minLeft, viewportW - cardW - EDGE))
    const clampY = (y) => Math.min(Math.max(y, bandTop), Math.max(bandTop, bandBottom - cardH))

    /**
     * Trim a cutout to the part of the screen that can actually show it.
     *
     * The spotlight is a ring drawn on the cutout's own edge, so it only reads as
     * a highlight where that edge is inside the viewport. Two targets on this app
     * break that without the clamp: a full-width element padded outwards puts its
     * left and right edges past the screen, and the inventory list is taller than
     * the phone, so its bottom edge is somewhere far below the fold. Trimming
     * leaves a ring that closes around what the student can see.
     */
    const clip = (spot) => {
      const left = Math.max(spot.left, inset.left + RING)
      const right = Math.min(spot.left + spot.width, viewportW - RING)
      const top = Math.max(spot.top, inset.top + RING)
      const bottom = Math.min(spot.top + spot.height, viewportH - inset.bottom - RING)
      return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
    }

    const spot = {
      top: box.top - SPOTLIGHT_PAD,
      left: box.left - SPOTLIGHT_PAD,
      width: box.width + SPOTLIGHT_PAD * 2,
      height: box.height + SPOTLIGHT_PAD * 2,
    }

    /*
     * A target that cannot share the band with the card at all — the tool
     * inventory and the loans list both run the whole length of the page — is
     * placed deliberately rather than left to fall through to a bottom sheet: the
     * card goes to the top of the band and the highlight begins directly under
     * it, so the assistant, its message and the first tool records it is
     * describing read as one block at the top of the screen. A sheet would strand
     * the message at the far end of the phone from the top of the list it
     * explains, and the student would have to scroll to connect the two.
     */
    if (spot.height > bandHeight - cardH - GAP) {
      const lit = bandTop + cardH + GAP
      const top = Math.max(spot.top, lit)
      setRect(clip({ ...spot, top, height: spot.top + spot.height - top }))
      setPlacement({
        mode: 'anchored',
        top: bandTop,
        left: clampX(spot.left + spot.width / 2 - cardW / 2),
        width: cardW,
        maxHeight: cardMax,
        topAlign: lit,
      })
      return
    }

    setRect(clip(spot))

    const spotBottom = spot.top + spot.height
    const spotRight = spot.left + spot.width

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
  }, [step?.target, compact])

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

      // A target taller than the band: the card is parked at the top of the
      // screen and the target's own top edge belongs at the top of the lit region
      // just below it. Anything else would hide the start of the list behind the
      // card. The tolerance is what keeps the page still — a list that already
      // starts within a screenful of the right place is left exactly where it is,
      // so stepping through the tour does not shunt the page about.
      if (place?.topAlign != null) {
        const delta = element.getBoundingClientRect().top - SPOTLIGHT_PAD - place.topAlign
        if (delta > -2 && delta < SLACK) return
        scrollParent(element).scrollBy({ top: delta, behavior: 'smooth' })
        return
      }

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
    // The lit region's top edge is part of the key: it is only known once the
    // card has been measured, and the corrected value is what the scroll has to
    // aim at. Its own guard keeps a page that is already in the right place still.
    const key = `${index}:${placement.mode}:${Math.round(placement.topAlign ?? -1)}`
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
      : // Not measured yet. Kept narrow, because this first render is what
        // `measure` reads the card's width from: absolutely positioned with no
        // width of its own it would otherwise stretch to the whole overlay.
        { maxWidth: compact ? '22rem' : '24rem' }

  // `compact` trades a little breathing room for height: the step counter and
  // progress dots share one line and the heading steps down, so the whole card
  // fits the band without scrolling on a short phone screen. The student tours
  // pass it; the staff tours keep the roomier layout.
  //
  // Neither layout has a decorative block at the top any more. The step counter
  // is the first thing in the card, and the height the icon tile used to take is
  // spent on the title and the description instead — a step reads as a sentence
  // about the thing being highlighted, not as an illustrated slide.
  const cardPad = compact ? 'p-4' : 'p-5 sm:p-6'
  const stepGap = compact ? 'mt-4' : 'mt-5'

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
        // A lighter touch than a hard outline on a heavy scrim: the page stays
        // readable through the dim, and the highlight is a soft edge rather than
        // a marker pen around the card — the tour is a hand pointing at the
        // screen, not a warning.
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-emerald-400/60 animate-fade-in"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 9999px rgb(8 14 26 / 0.62)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-navy-950/60 animate-fade-in" aria-hidden="true" />
      )}

      {/* Click-catcher so the page underneath cannot be operated mid-tour. It
          does not block scrolling, so a long page can still be moved. */}
      <div className="absolute inset-0" aria-hidden="true" />

      <div
        ref={cardRef}
        style={cardStyle}
        className={
          anchored
            ? `card absolute flex flex-col overflow-y-auto overscroll-contain ${cardPad} shadow-panel animate-fade-in`
            : // Bottom sheet: inside its margins and above the bottom bar. The
              // offsets are inline, from `placement`, so the shell is respected.
              `card absolute flex flex-col overflow-y-auto overscroll-contain ${cardPad} shadow-panel animate-slide-up`
        }
      >
        {compact ? (
          <div className="flex items-center justify-between gap-3">
            <p className="subtle text-[11px] font-bold uppercase tracking-wider">
              Step {index + 1} of {total}
            </p>
            <div className="flex items-center gap-1.5" role="presentation">
              {live.map((s, i) => (
                <span
                  key={s.title}
                  className={
                    i === index
                      ? 'h-1.5 w-5 rounded-full bg-emerald-500 transition-all'
                      : 'h-1.5 w-1.5 rounded-full transition-all'
                  }
                  style={i === index ? undefined : { background: 'rgb(var(--surface-3))' }}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="subtle text-[11px] font-bold uppercase tracking-wider">
            Step {index + 1} of {total}
          </p>
        )}

        <div className="mt-2.5">
          <div className="min-w-0 flex-1">
            <h2
              id={labelledBy}
              className={
                compact
                  ? 'text-[15.5px] font-extrabold leading-snug tracking-tight'
                  : 'text-[19px] font-extrabold leading-snug tracking-tight'
              }
            >
              {step.title}
            </h2>
            <p
              className={
                compact
                  ? 'muted mt-2 text-[13px] leading-[1.55]'
                  : 'muted mt-2.5 text-sm leading-relaxed'
              }
            >
              {step.text}
            </p>
          </div>
        </div>

        {/* step indicators */}
        {!compact && (
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
        )}

        <div className={`flex shrink-0 items-center justify-between gap-2 ${stepGap}`}>
          <button type="button" onClick={finish} className="btn btn-ghost btn-sm">
            Skip
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button type="button" onClick={back} className="btn btn-outline btn-sm">
                Back
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className={compact ? 'btn btn-success btn-sm px-4' : 'btn btn-success'}
            >
              {isLast ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
