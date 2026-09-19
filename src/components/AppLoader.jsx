/**
 * The full-screen loading state, shown while the stored session is read.
 *
 * Until now this moment was a blank page: `App` returned `null` while the app
 * booted, so a cold start on a phone showed the background colour and nothing
 * else for as long as the session took to restore. This fills that gap with
 * something that says the app is working.
 *
 * Entirely inline SVG and CSS — no image to fetch, no animation library, and no
 * JavaScript driving a frame loop. The whole thing is a few hundred bytes of
 * markup inside a bundle that is already loaded, which is what makes it safe to
 * render on a 2 GB device at the exact moment the app is busiest.
 *
 * The mark is ToolTrack's own: the two bracket corners of a scan target, drawn
 * around a single upright — the "T" of the name read as a tool standing in a
 * frame. It shares the QR-corner language of `BrandMark` without reusing it,
 * because at this size the full mark's detail would only turn to mud.
 *
 * Motion is one rotating arc on one element. A transform-only animation stays on
 * the compositor, so it costs no layout and no paint, and `prefers-reduced-motion`
 * replaces it with a still ring rather than leaving the arc frozen mid-spin.
 */

import { APP_NAME } from '../utils/constants'

const SIZE = 84

export default function AppLoader({ label = 'Loading' }) {
  return (
    <div
      className="app-loader"
      role="status"
      aria-live="polite"
      aria-label={`${APP_NAME} is loading`}
    >
      <div className="app-loader__mark" style={{ width: SIZE, height: SIZE }}>
        {/* The ring and the arc share one viewBox so they stay concentric at any
            size. The arc is the only thing that moves. */}
        <svg viewBox="0 0 84 84" width={SIZE} height={SIZE} aria-hidden="true">
          {/* The track the arc travels: a full ring, low contrast, so the motion
              reads against something rather than floating. */}
          <circle
            cx="42"
            cy="42"
            r="38"
            fill="none"
            stroke="rgb(var(--border))"
            strokeWidth="2.5"
          />
          {/* One quarter of the circumference (2πr ≈ 238.8), drawn as a dash and
              rotated. Stroke geometry rather than a filled wedge: it scales
              cleanly and needs no mask. */}
          <circle
            className="app-loader__arc"
            cx="42"
            cy="42"
            r="38"
            fill="none"
            stroke="rgb(var(--accent))"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="60 179"
          />

          {/* The mark. Scan-target corners, top-left and bottom-right only, so
              the eye completes the frame itself — and a single upright with its
              crossbar inside. */}
          <g
            fill="none"
            stroke="rgb(var(--text))"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* The brackets sit on a square centred on 42,42 — the same centre
                as the ring — so the frame reads as balanced around the letter
                rather than drifting off one shoulder. */}
            <path d="M31 27h-4a2 2 0 0 0-2 2v4" />
            <path d="M53 57h4a2 2 0 0 0 2-2v-4" />
            {/* The T, centred on the same point: crossbar above, stem below. */}
            <path d="M34 36h16" />
            <path d="M42 36v13" />
          </g>
        </svg>
      </div>

      <p className="app-loader__name">{APP_NAME}</p>
      <p className="app-loader__label">{label}</p>
    </div>
  )
}
