import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { assistantLine } from '../services/assistant'
import { cx } from '../utils/helpers'

/* ------------------------------------------------------------------ *
 * Volt — the laboratory assistant
 *
 * ONE mascot, drawn once. Every state reuses the same helmet, visor,
 * headphones, overalls and boots; only the eyes, the mouth, the small prop in
 * its hand and the idle motion change. That is deliberate: the figure has to
 * stay recognisably the same character while it reports what the system is
 * doing (scanning, borrowing, overdue, offline, …).
 *
 * Nothing here talks to a service, a route or the database — it renders what it
 * is given. Animation is plain Tailwind keyframes (see tailwind.config.js), so
 * no animation dependency is added, and everything stops under
 * `prefers-reduced-motion` via the `motion-reduce:animate-none` utility.
 * ------------------------------------------------------------------ */

const CYAN = '#38E1F0'
const AMBER = '#F7C948'
const GREEN = '#34D399'
const RED = '#F87171'
const ORANGE = '#FB923C'
const VIOLET = '#A78BFA'
const STEEL = '#94A3B8'

/**
 * The state table. `eyes` / `mouth` pick a face, `prop` picks what the right
 * hand is holding, `body` is the whole-figure idle motion. Adding a state means
 * adding a row here — never a second character.
 */
export const MASCOT_STATES = {
  idle: {
    label: 'Standing by',
    message: 'Ready when you are.',
    eyes: 'open',
    mouth: 'smile',
    glow: CYAN,
    prop: null,
    body: 'bob',
    leftArm: 'rest',
  },
  happy: {
    label: 'All clear',
    message: 'Everything is on schedule.',
    eyes: 'happy',
    mouth: 'grin',
    glow: CYAN,
    prop: null,
    body: 'bob',
    leftArm: 'wave',
  },
  scanning: {
    label: 'Scanning',
    message: 'Hold the QR code steady in the frame.',
    eyes: 'wide',
    mouth: 'small',
    glow: CYAN,
    prop: 'qr',
    body: 'bob-fast',
    leftArm: 'rest',
  },
  inspecting: {
    label: 'Looking over the tools',
    message: 'Every tool on the shelf, with its record.',
    eyes: 'open',
    mouth: 'smile',
    glow: CYAN,
    prop: 'wrench',
    body: 'bob',
    leftArm: 'point',
  },
  checking: {
    label: 'Reading the log',
    message: 'Going back through the records.',
    eyes: 'open',
    mouth: 'small',
    glow: CYAN,
    prop: 'clipboard',
    body: 'bob',
    leftArm: 'rest',
  },
  tuning: {
    label: 'Adjusting',
    message: 'Setting how the laboratory runs.',
    eyes: 'wink',
    mouth: 'smile',
    glow: CYAN,
    prop: 'gear',
    body: 'bob',
    leftArm: 'rest',
  },
  curious: {
    label: 'Nothing here yet',
    message: 'There is nothing on this list so far.',
    eyes: 'confused',
    mouth: 'small',
    glow: CYAN,
    prop: 'question',
    body: 'tilt',
    leftArm: 'rest',
  },
  borrowing: {
    label: 'Checking out',
    message: 'Taking the tool off the shelf.',
    eyes: 'open',
    mouth: 'smile',
    glow: CYAN,
    prop: 'toolbox',
    body: 'bob-fast',
    leftArm: 'point',
  },
  returning: {
    label: 'Checking in',
    message: 'Bringing the tool back to the rack.',
    eyes: 'open',
    mouth: 'smile',
    glow: CYAN,
    prop: 'toolbox',
    body: 'bob-fast',
    leftArm: 'rest',
  },
  success: {
    label: 'Done',
    message: 'Recorded successfully.',
    eyes: 'star',
    mouth: 'grin',
    glow: GREEN,
    prop: 'check',
    body: 'bob-fast',
    leftArm: 'wave',
  },
  overdue: {
    label: 'Overdue',
    message: 'Some tools are past their return date.',
    eyes: 'worried',
    mouth: 'frown',
    glow: RED,
    prop: 'warning',
    body: 'shake',
    leftArm: 'rest',
  },
  maintenance: {
    label: 'Maintenance',
    message: 'Equipment is booked in for servicing.',
    eyes: 'wink',
    mouth: 'smile',
    glow: ORANGE,
    prop: 'wrench',
    body: 'bob',
    leftArm: 'rest',
    hardHat: true,
  },
  notification: {
    label: 'New alerts',
    message: 'There is something in your notifications.',
    eyes: 'open',
    mouth: 'small',
    glow: AMBER,
    prop: 'bell',
    body: 'bob-fast',
    leftArm: 'point',
  },
  offline: {
    label: 'Offline',
    message: 'Working from the copy stored on this device.',
    eyes: 'flat',
    mouth: 'flat',
    glow: STEEL,
    prop: 'offline',
    body: 'none',
    leftArm: 'rest',
  },
  error: {
    label: 'Something broke',
    message: 'That request did not go through.',
    eyes: 'cross',
    mouth: 'open-frown',
    glow: RED,
    prop: null,
    body: 'shake',
    leftArm: 'rest',
  },
  confused: {
    label: 'Not found',
    message: "I could not match that — try another code.",
    eyes: 'confused',
    mouth: 'wobble',
    glow: VIOLET,
    prop: 'question',
    body: 'tilt',
    leftArm: 'rest',
  },
  sleeping: {
    label: 'Loading',
    message: 'Fetching the latest from the tool room…',
    eyes: 'closed',
    mouth: 'sleep',
    glow: CYAN,
    prop: 'zzz',
    body: 'breathe',
    leftArm: 'rest',
  },
}

export const MASCOT_STATE_KEYS = Object.keys(MASCOT_STATES)

const BODY_ANIMATION = {
  bob: 'animate-mascot-bob',
  'bob-fast': 'animate-mascot-bob-fast',
  breathe: 'animate-mascot-breathe',
  shake: 'animate-mascot-shake',
  tilt: 'animate-mascot-tilt',
  none: '',
}

const ORIGIN = { transformBox: 'fill-box', transformOrigin: 'center' }

/**
 * The mascot itself.
 *
 * @param {object} props
 * @param {keyof typeof MASCOT_STATES} props.state
 * @param {number} props.size  rendered height in px
 * @param {boolean} props.animated  set false to freeze the figure
 */
export default function Mascot({ state = 'idle', size = 120, animated = true, className }) {
  const cfg = MASCOT_STATES[state] ?? MASCOT_STATES.idle
  const motion = animated ? (BODY_ANIMATION[cfg.body] ?? '') : ''

  return (
    <svg
      viewBox="0 0 120 140"
      width={size * (120 / 140)}
      height={size}
      className={cx('shrink-0 overflow-visible', className)}
      role="img"
      aria-label={`Assistant: ${cfg.label}`}
    >
      {/* floor shadow — stays put while the figure bobs above it */}
      <ellipse cx="60" cy="131" rx="27" ry="5" fill="#0B1220" opacity=".18" />

      <g className={cx(motion, 'motion-reduce:animate-none')} style={ORIGIN}>
        <Legs />
        <Torso />
        <LeftArm pose={cfg.leftArm} animated={animated} />
        <RightArm prop={cfg.prop} />
        <Head cfg={cfg} animated={animated} />
        <Prop kind={cfg.prop} animated={animated} />
      </g>
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * Body — identical in every state
 * ------------------------------------------------------------------ */

function Legs() {
  return (
    <g>
      <rect x="45" y="103" width="11" height="16" rx="5" fill="#2A3A63" />
      <rect x="64" y="103" width="11" height="16" rx="5" fill="#2A3A63" />
      {/* two separate boots, toes pointing outwards */}
      <path d="M43 117h13v6a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4v-2a4 4 0 0 1 4-4Z" fill="#F1F5F9" />
      <path d="M64 117h13a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4z" fill="#F1F5F9" />
      <g fill="#CBD5E1">
        <path d="M39 123h17v2H39zM64 123h17v2H64z" />
      </g>
    </g>
  )
}

function Torso() {
  return (
    <g>
      {/* overalls */}
      <rect x="36" y="74" width="48" height="34" rx="13" fill="#34497B" />
      {/* bib + straps */}
      <path d="M46 70h28v14H46z" fill="#2A3A63" />
      <rect x="43" y="62" width="6" height="14" rx="3" fill="#2A3A63" />
      <rect x="71" y="62" width="6" height="14" rx="3" fill="#2A3A63" />
      {/* wrench emblem on the bib — the same mark the app uses */}
      <g fill={AMBER} opacity=".95">
        <path d="M64.4 79.2a4.3 4.3 0 0 0-5.6 5.4l-4.9 4.9a1.5 1.5 0 0 0 0 2.1l.4.4a1.5 1.5 0 0 0 2.1 0l4.9-4.9a4.3 4.3 0 0 0 5.4-5.6l-2.3 2.3-2.1-.6-.6-2.1z" />
      </g>
      {/* tool pouch */}
      <path d="M33 84h9v13h-9z" fill="#5A4326" />
      <path d="M33 84h9v3h-9z" fill="#7C5C33" />
      <path d="M36 80h1.5v5H36zM39 80h1.5v5H39z" fill={STEEL} />
    </g>
  )
}

/**
 * The gesturing arm. Rotation happens around the shoulder joint (32, 80) via the
 * SVG transform attribute — no `transformBox`, which would re-centre the pivot on
 * the group's own box and swing the limb off the body.
 */
function LeftArm({ pose, animated }) {
  const rotate = pose === 'point' ? 138 : pose === 'wave' ? 170 : 6
  return (
    <g transform={`rotate(${rotate} 32 80)`}>
      <g
        className={cx(pose === 'wave' && animated && 'animate-mascot-wave', 'motion-reduce:animate-none')}
        style={{ transformOrigin: '32px 80px' }}
      >
        <rect x="26" y="76" width="12" height="24" rx="6" fill="#F1F5F9" />
        <circle cx="32" cy="100" r="7" fill="#1B2537" />
      </g>
    </g>
  )
}

function RightArm({ prop }) {
  // Lifted towards the chest whenever the mascot is holding something, pivoting
  // on its own shoulder at (88, 80).
  const holding = prop && prop !== 'zzz'
  return (
    <g transform={holding ? 'rotate(-30 88 80)' : ''}>
      <rect x="82" y="76" width="12" height="24" rx="6" fill="#F1F5F9" />
      <circle cx="88" cy="100" r="7" fill="#1B2537" />
    </g>
  )
}

function Head({ cfg, animated }) {
  return (
    <g>
      {/* headphone cups — both sides, always */}
      <rect x="20" y="38" width="11" height="20" rx="5.5" fill="#34497B" />
      <rect x="22.5" y="42" width="6" height="12" rx="3" fill={CYAN} opacity=".55" />
      <rect x="89" y="38" width="11" height="20" rx="5.5" fill="#34497B" />
      <rect x="91.5" y="42" width="6" height="12" rx="3" fill={CYAN} opacity=".55" />

      {/* helmet */}
      <rect x="27" y="16" width="66" height="54" rx="26" fill="#F8FAFC" />
      <rect x="27" y="16" width="66" height="54" rx="26" fill="none" stroke="#CBD5E1" strokeWidth="1.5" />
      <path d="M40 22a30 30 0 0 1 24-4c-11 1-19 6-24 4Z" fill="#fff" opacity=".9" />

      {/* forehead gear — the only spinning part, and only while busy */}
      <g
        className={cx(
          animated && (cfg.body === 'bob-fast' || cfg.body === 'breathe') && 'animate-mascot-spin-slow',
          'motion-reduce:animate-none',
        )}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      >
        <circle cx="60" cy="23.5" r="6" fill="#1B2537" />
        <circle cx="60" cy="23.5" r="2.2" fill="#F8FAFC" />
        <g fill="#1B2537">
          <rect x="58.8" y="15.5" width="2.4" height="3" rx="1" />
          <rect x="58.8" y="28.5" width="2.4" height="3" rx="1" />
          <rect x="52" y="22.3" width="3" height="2.4" rx="1" />
          <rect x="65" y="22.3" width="3" height="2.4" rx="1" />
        </g>
      </g>

      {/* visor — the face lives here */}
      <rect x="34" y="30" width="52" height="34" rx="16" fill="#111C2E" />
      <rect x="34" y="30" width="52" height="34" rx="16" fill="none" stroke="#0B1220" strokeWidth="1" />
      <path d="M40 35h16a10 10 0 0 1-16 6Z" fill="#fff" opacity=".07" />

      <Face cfg={cfg} animated={animated} />

      {cfg.hardHat && <HardHat />}
    </g>
  )
}

function HardHat() {
  // The one accessory: a hat over the existing helmet for the maintenance
  // state. The mascot underneath is unchanged.
  return (
    <g>
      <path d="M30 20a30 30 0 0 1 60 0v3H30z" fill={AMBER} />
      <path d="M26 20h68a3 3 0 0 1 0 6H26a3 3 0 0 1 0-6Z" fill="#DE911D" />
      <circle cx="60" cy="12" r="3.4" fill="#B44D12" opacity=".65" />
    </g>
  )
}

/* ------------------------------------------------------------------ *
 * Face — the part that actually carries the state
 * ------------------------------------------------------------------ */

function Face({ cfg, animated }) {
  const c = cfg.glow
  const blink =
    animated && (cfg.eyes === 'open' || cfg.eyes === 'wide')
      ? 'animate-mascot-blink motion-reduce:animate-none'
      : ''

  return (
    <g>
      <g className={blink} style={ORIGIN}>
        <Eyes kind={cfg.eyes} color={c} />
      </g>
      <Mouth kind={cfg.mouth} color={c} />
    </g>
  )
}

function Eyes({ kind, color }) {
  const glow = { filter: 'drop-shadow(0 0 4px currentColor)', color }

  switch (kind) {
    case 'happy': // closed, curved up
      return (
        <g stroke={color} strokeWidth="3.4" strokeLinecap="round" fill="none" style={glow}>
          <path d="M45 47q4.5-6 9 0" />
          <path d="M66 47q4.5-6 9 0" />
        </g>
      )
    case 'wink':
      return (
        <g style={glow}>
          <rect x="45" y="40" width="9" height="12" rx="4.5" fill={color} />
          <path d="M66 47q4.5-6 9 0" stroke={color} strokeWidth="3.4" strokeLinecap="round" fill="none" />
        </g>
      )
    case 'wide': // scanning — narrow and tall
      return (
        <g style={glow}>
          <rect x="46" y="38" width="7" height="15" rx="3.5" fill={color} />
          <rect x="67" y="38" width="7" height="15" rx="3.5" fill={color} />
        </g>
      )
    case 'star': // success
      return (
        <g fill={color} style={glow}>
          <Star cx={49.5} cy={45} r={8} />
          <Star cx={70.5} cy={45} r={8} />
        </g>
      )
    case 'worried': // overdue — squashed with tilted brows
      return (
        <g style={glow}>
          <rect x="45" y="42" width="9" height="9" rx="4.5" fill={color} />
          <rect x="66" y="42" width="9" height="9" rx="4.5" fill={color} />
          <g stroke={color} strokeWidth="2.6" strokeLinecap="round">
            <path d="M44 37l10 3" />
            <path d="M76 37l-10 3" />
          </g>
        </g>
      )
    case 'cross': // error
      return (
        <g stroke={color} strokeWidth="3.4" strokeLinecap="round" style={glow}>
          <path d="M45 41l9 9M54 41l-9 9" />
          <path d="M66 41l9 9M75 41l-9 9" />
        </g>
      )
    case 'confused': // one wide, one narrow
      return (
        <g style={glow}>
          <rect x="44" y="39" width="11" height="13" rx="5.5" fill={color} />
          <rect x="67" y="43" width="7" height="7" rx="3.5" fill={color} />
        </g>
      )
    case 'flat': // offline — dim, no glow
      return (
        <g stroke={color} strokeWidth="3.4" strokeLinecap="round" opacity=".75">
          <path d="M45 46h9M66 46h9" />
        </g>
      )
    case 'closed': // sleeping
      return (
        <g stroke={color} strokeWidth="3.2" strokeLinecap="round" fill="none" opacity=".85">
          <path d="M45 46q4.5 5 9 0" />
          <path d="M66 46q4.5 5 9 0" />
        </g>
      )
    case 'open':
    default:
      return (
        <g style={glow}>
          <rect x="44" y="39" width="10" height="14" rx="5" fill={color} />
          <rect x="66" y="39" width="10" height="14" rx="5" fill={color} />
          <circle cx="47" cy="43" r="1.8" fill="#fff" opacity=".85" />
          <circle cx="69" cy="43" r="1.8" fill="#fff" opacity=".85" />
        </g>
      )
  }
}

function Star({ cx: x, cy: y, r }) {
  const pts = []
  for (let i = 0; i < 10; i += 1) {
    const rad = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 === 0 ? r : r * 0.44
    pts.push(`${(x + Math.cos(rad) * rr).toFixed(2)},${(y + Math.sin(rad) * rr).toFixed(2)}`)
  }
  return <polygon points={pts.join(' ')} />
}

function Mouth({ kind, color }) {
  switch (kind) {
    case 'grin':
      return (
        <g>
          <path d="M53 55q7 8 14 0z" fill={color} opacity=".9" />
          <path d="M57 59q3 3 6 0z" fill="#FDA4AF" />
        </g>
      )
    case 'small':
      return <circle cx="60" cy="57" r="3" fill={color} opacity=".9" />
    case 'frown':
      return (
        <path
          d="M54 59q6-6 12 0"
          stroke={color}
          strokeWidth="2.8"
          strokeLinecap="round"
          fill="none"
          opacity=".9"
        />
      )
    case 'open-frown':
      return <ellipse cx="60" cy="57.5" rx="5" ry="4" fill={color} opacity=".85" />
    case 'wobble':
      return (
        <path
          d="M53 57q3-3 4.5 0T62 57t4.5 0"
          stroke={color}
          strokeWidth="2.6"
          strokeLinecap="round"
          fill="none"
          opacity=".9"
        />
      )
    case 'flat':
      return <path d="M54 57h12" stroke={color} strokeWidth="2.6" strokeLinecap="round" opacity=".7" />
    case 'sleep':
      return <ellipse cx="60" cy="57" rx="3.2" ry="2.4" fill={color} opacity=".5" />
    case 'smile':
    default:
      return (
        <path
          d="M54 55q6 6 12 0"
          stroke={color}
          strokeWidth="2.8"
          strokeLinecap="round"
          fill="none"
          opacity=".9"
        />
      )
  }
}

/* ------------------------------------------------------------------ *
 * Props — the small held object that names the state at a glance
 * ------------------------------------------------------------------ */

/** Props actually gripped by the right hand, which sits at ≈(98, 97) when raised. */
const HELD = new Set(['qr', 'toolbox', 'wrench', 'bell', 'offline', 'clipboard', 'gear'])

function Prop({ kind, animated }) {
  if (!kind) return null
  // Held objects are drawn around the chest and then moved into the raised hand;
  // badges (a tick, a warning triangle, a question mark, the zzz) float free.
  return HELD.has(kind) ? (
    <g transform="translate(9 18)">
      <PropArt kind={kind} animated={animated} />
    </g>
  ) : (
    <PropArt kind={kind} animated={animated} />
  )
}

function PropArt({ kind, animated }) {
  const pulse = animated ? 'animate-mascot-spark motion-reduce:animate-none' : ''

  switch (kind) {
    case 'qr':
      return (
        <g>
          {/* scanner in hand */}
          <rect x="86" y="66" width="8" height="12" rx="2.5" fill="#1B2537" />
          {/* beam + code */}
          <g className={cx(animated && 'animate-mascot-beam', 'motion-reduce:animate-none')} style={ORIGIN}>
            <path d="M94 68l18-6v22l-18-6z" fill={CYAN} opacity=".28" />
            <rect x="100" y="62" width="16" height="16" rx="2" fill="#0B1220" />
            <g fill={CYAN}>
              <path d="M102 64h5v5h-5zM109 64h5v5h-5zM102 71h5v5h-5zM109.5 71.5h1.6v1.6h-1.6zM112 74h1.6v1.6H112z" />
            </g>
          </g>
        </g>
      )
    case 'toolbox':
      return (
        <g>
          <rect x="82" y="66" width="20" height="14" rx="2.5" fill="#1B2537" />
          <rect x="82" y="70" width="20" height="2" fill="#34497B" />
          <path d="M88 66v-2a4 4 0 0 1 8 0v2" stroke="#1B2537" strokeWidth="2" fill="none" />
          <rect x="90" y="72" width="4" height="4" rx="1" fill={AMBER} />
        </g>
      )
    case 'wrench':
      return (
        <g className={cx(animated && 'animate-mascot-tilt', 'motion-reduce:animate-none')} style={ORIGIN}>
          <path
            d="M96 58a7 7 0 0 0-9 9l-1 1 3 3 1-1a7 7 0 0 0 9-9l-3.6 3.6-3.4-1-1-3.4z"
            fill={STEEL}
            stroke="#64748B"
            strokeWidth="1"
          />
        </g>
      )
    case 'clipboard':
      return (
        <g>
          <rect
            x="83"
            y="58"
            width="19"
            height="24"
            rx="2.5"
            fill="#F1F5F9"
            stroke="#CBD5E1"
            strokeWidth="1"
          />
          <rect x="88" y="55" width="9" height="5" rx="2.5" fill="#64748B" />
          <g stroke="#94A3B8" strokeWidth="1.6" strokeLinecap="round">
            <path d="M87 66h11M87 70h11" />
          </g>
          {/* the one tick that says this is a checked record, not a notepad */}
          <path
            d="M87.5 75.5l2.5 2.5 5-5"
            stroke={GREEN}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </g>
      )
    case 'gear':
      // The same cog as the one on the helmet, in the hand and turning at the
      // same slow rate, so the figure reads as adjusting something.
      return (
        <g
          className={cx(animated && 'animate-mascot-spin-slow', 'motion-reduce:animate-none')}
          style={ORIGIN}
        >
          <g fill={STEEL}>
            {[0, 45, 90, 135].map((angle) => (
              <rect
                key={angle}
                x="92.4"
                y="57"
                width="3.2"
                height="22"
                rx="1.4"
                transform={`rotate(${angle} 94 68)`}
              />
            ))}
          </g>
          <circle cx="94" cy="68" r="8" fill={STEEL} stroke="#64748B" strokeWidth="1" />
          <circle cx="94" cy="68" r="3.4" fill="#1B2537" />
        </g>
      )
    case 'check':
      return (
        <g className={pulse} style={ORIGIN}>
          <circle cx="96" cy="66" r="11" fill={GREEN} />
          <path
            d="M91 66.5l3.5 3.5 6.5-7"
            stroke="#fff"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </g>
      )
    case 'warning':
      return (
        <g className={pulse} style={ORIGIN}>
          <path d="M96 55l11 19H85z" fill={AMBER} stroke="#B44D12" strokeWidth="1.4" />
          <path d="M96 61v7" stroke="#7C2D12" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="96" cy="71" r="1.4" fill="#7C2D12" />
        </g>
      )
    case 'bell':
      return (
        <g className={cx(animated && 'animate-mascot-tilt', 'motion-reduce:animate-none')} style={ORIGIN}>
          <path d="M96 56a7 7 0 0 1 7 7v6h-14v-6a7 7 0 0 1 7-7Z" fill={AMBER} />
          <rect x="87" y="69" width="18" height="3" rx="1.5" fill="#DE911D" />
          <circle cx="96" cy="75" r="2.6" fill="#DE911D" />
          <circle cx="103" cy="54" r="3" fill={RED} />
        </g>
      )
    case 'offline':
      return (
        <g>
          <rect x="82" y="60" width="26" height="18" rx="3" fill="#1B2537" stroke="#475569" strokeWidth="1.2" />
          <path
            d="M89 71a8 8 0 0 1 12 0"
            stroke={STEEL}
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
            opacity=".7"
          />
          <circle cx="95" cy="74" r="1.6" fill={STEEL} opacity=".7" />
          <path d="M86 64l18 12" stroke={RED} strokeWidth="2.4" strokeLinecap="round" />
        </g>
      )
    case 'question':
      return (
        <g className={pulse} style={ORIGIN}>
          <path
            d="M92 46a5 5 0 1 1 6 5v3"
            stroke={VIOLET}
            strokeWidth="3.2"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="98" cy="59" r="2" fill={VIOLET} />
        </g>
      )
    case 'zzz':
      return (
        <g fill={CYAN} fontFamily="Inter, system-ui, sans-serif" fontWeight="800">
          {[0, 1, 2].map((i) => (
            <text
              key={i}
              x={90 + i * 6}
              y={40 - i * 8}
              fontSize={9 + i * 2}
              className={cx(animated && 'animate-mascot-zzz', 'motion-reduce:animate-none')}
              style={{ ...ORIGIN, animationDelay: `${i * 0.55}s`, opacity: animated ? 0 : 0.8 }}
            >
              z
            </text>
          ))}
        </g>
      )
    default:
      return null
  }
}

/* ------------------------------------------------------------------ *
 * Dashboard greeter
 *
 * Reads state the dashboard already has — it fetches nothing of its own.
 * ------------------------------------------------------------------ */

/**
 * Picks the single most important thing the mascot should be reporting.
 * Order matters: a hard failure or a lost connection outranks any counter.
 */
export function deriveMascotState({
  online = true,
  error = false,
  loading = false,
  overdue = 0,
  dueSoon = 0,
  maintenance = 0,
  activeLoans = 0,
  unread = 0,
} = {}) {
  if (error) return 'error'
  if (!online) return 'offline'
  if (loading) return 'sleeping'
  if (overdue > 0) return 'overdue'
  if (maintenance > 0) return 'maintenance'
  if (dueSoon > 0) return 'notification'
  if (unread > 0) return 'notification'
  if (activeLoans > 0) return 'borrowing'
  return 'happy'
}

/**
 * The one thing the mascot volunteers without being asked.
 *
 * It speaks up by itself for a lost connection and for nothing else: everything
 * else the app has to say is already written on the page, and a bubble that
 * appeared for all of it would be noise. A dropped connection is different —
 * nothing on screen says the figures are a stored copy, so the mascot says it.
 *
 * A constant, not a generated line, so it is right the instant the connection
 * changes and needs nothing fetched to show it.
 */
const OFFLINE_LINE =
  'You are offline — this is the copy saved on this device. Anything you record syncs when the connection returns.'

/**
 * What the assistant is doing on each screen, and the short lines it offers when
 * it is tapped there.
 *
 * One table, matched against the route, so the character is the same everywhere
 * and only its pose, its prop and what it says change with the page — which is
 * the whole point of a single mascot. The lines describe the screen the student
 * or member of staff is actually on; none of them is a greeting, and none claims
 * anything role-specific, since the same figure stands on an administrator's
 * Settings page and a student's Scan page.
 *
 * `pathname` is passed in rather than read from the router here: this file draws
 * a figure and knows nothing about routing, services or data, and it stays that
 * way.
 */
const CONTEXTS = [
  {
    test: /^\/dashboard/,
    state: 'happy',
    lines: [
      'Everything you have out, and what is due back, is on this screen.',
      'Scan to borrow is the quickest way to check a tool out.',
    ],
  },
  {
    test: /^\/tools\/[^/]/,
    state: 'inspecting',
    lines: [
      'This is the tool’s full record — condition, where it lives, and its history.',
      'If it says Available, it is on the shelf and can be borrowed.',
    ],
  },
  {
    test: /^\/tools/,
    state: 'inspecting',
    lines: [
      'Every registered tool, with its status, condition and location.',
      'Search by name, tool ID, brand or serial number to find one fast.',
    ],
  },
  {
    test: /^\/scan/,
    state: 'scanning',
    lines: [
      'Point the camera at the QR label on the tool and hold steady.',
      'No camera? Type the tool ID from the label instead.',
    ],
  },
  {
    test: /^\/borrow/,
    state: 'borrowing',
    lines: [
      'Pick the tool, check the return date, and confirm to take it out.',
      'The due date is set from the laboratory’s borrowing period.',
    ],
  },
  {
    test: /^\/return/,
    state: 'returning',
    lines: [
      'Choose the tool you are handing back and say what condition it is in.',
      'Report any damage here — it goes straight onto the tool’s record.',
    ],
  },
  {
    test: /^\/transactions/,
    state: 'checking',
    lines: [
      'Every borrow and return on record, newest first.',
      'Filter by status to pull out what is still out or already late.',
    ],
  },
  {
    test: /^\/notifications/,
    state: 'notification',
    lines: [
      'Alerts addressed to you — due dates, overdue tools and account news.',
      'Anything with a link opens the record it is about.',
    ],
  },
  {
    test: /^\/maintenance/,
    state: 'maintenance',
    lines: [
      'Tools booked in for servicing, and what is due next.',
      'A tool in maintenance cannot be borrowed until it is back.',
    ],
  },
  {
    test: /^\/reports/,
    state: 'checking',
    lines: ['The laboratory’s figures over time.', 'Export any table for a report.'],
  },
  {
    test: /^\/settings/,
    state: 'tuning',
    lines: [
      'How the laboratory runs: borrowing periods, reminders and its details.',
      'A change here applies to everybody using the system.',
    ],
  },
  {
    test: /^\/users/,
    state: 'idle',
    lines: ['Every account, its role, and anything waiting for approval.'],
  },
  {
    test: /^\/profile/,
    state: 'idle',
    lines: [
      'Your own details, and how the app looks on this device.',
      'Changes to your name or course go to an administrator to approve.',
    ],
  },
]

const FALLBACK = { state: 'idle', lines: ['Tap a card to open the record behind it.'] }

/** The pose and the lines for one route. */
export function mascotContextFor(pathname = '') {
  return CONTEXTS.find((context) => context.test.test(pathname)) ?? FALLBACK
}

/**
 * The figure as an assistant: drawn alone — no card, no border, no fill — sized
 * by the caller, and answering a tap with one short line about the screen it is
 * standing on.
 *
 * Two things make it speak, and they are deliberately different:
 *
 *   • **A lost connection speaks for itself.** No tap, no timer: the notice
 *     appears the moment the connection drops and is taken down the moment it
 *     returns. The effect is keyed to that one boolean, so a re-render while
 *     offline never re-opens a notice that has already been read and dismissed,
 *     and nothing is fetched or scheduled to produce it.
 *
 *   • **Everything else waits to be asked.** A tap moves through the lines for
 *     this page, one at a time, and the bubble lets itself out after a few
 *     seconds. The lines are written in `CONTEXTS`, so they cost nothing, are
 *     right offline, and never repeat a generic greeting.
 *
 * The bubble is portalled to the body and positioned `fixed`, so it is painted
 * over every card on the page, cannot be clipped by one, and never takes part in
 * layout — nothing moves or resizes when the mascot speaks.
 */
function TalkingMascot({ state, lines, offline, size, className, label }) {
  const [turn, setTurn] = useState(-1) // -1 = nothing said yet
  const [pop, setPop] = useState(false)
  const timers = useRef([])
  const anchor = useRef(null)

  // Every timer is cleared on unmount, so a tap right before a route change
  // cannot set state on a component that is already gone.
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // Whatever was being said belongs to the screen it was said on.
  useEffect(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setTurn(-1)
    setGenerated(null)
  }, [lines])

  // What the text service made of the current line, if it answered in time.
  // The written line is what shows until then, so the bubble never waits on the
  // network and reads identically when there is none.
  const [generated, setGenerated] = useState(null)

  const say = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setGenerated(null)
    const next = turn + 1
    setTurn(next)
    setPop(true)
    timers.current.push(setTimeout(() => setPop(false), 500))
    timers.current.push(setTimeout(() => setTurn(-1), 6000)) // the bubble lets itself out

    const written = lines[next % lines.length]
    if (!written || offline) return
    assistantLine(written, { page: label, offline }).then((text) => {
      // Only if this is still the line on screen: a second tap has its own.
      if (text !== written) setGenerated({ for: written, text })
    })
  }

  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    setDismissed(false)
  }, [offline])

  const written = turn >= 0 ? lines[turn % lines.length] : null
  // The generated wording replaces the written one only while that same line is
  // the one being said; anything else falls back to what is in the source.
  const spoken = generated?.for === written ? generated.text : written
  // The connection outranks a tapped line: a stored copy is the more important
  // thing to know, and it is also the reason the rest of the screen may be stale.
  // The offline notice is never generated — it has to be right with no network.
  const line = offline && !dismissed ? OFFLINE_LINE : spoken

  // A reporting face keeps its own expression while it talks — a cheerful wave
  // over an overdue tool would misreport the situation.
  const calm = state === 'happy' || state === 'idle' || state === 'inspecting'
  const shown = offline ? 'offline' : turn >= 0 && calm ? 'happy' : state

  return (
    // `items-end` is what keeps the figure standing on the bottom of whatever box
    // the caller gives it: text beside it grows and shrinks by a line as it wraps,
    // and a centred mascot would drift up and down with it. The height comes
    // entirely from `className`, and the SVG takes only the width that height
    // needs (`h-full w-auto`) — so a caller sizes the mascot per breakpoint
    // without the figure ever stretching or being clipped.
    <div
      className={cx('flex shrink-0 items-end justify-end leading-none', className)}
      data-mascot-state={shown}
    >
      <button
        ref={anchor}
        type="button"
        onClick={say}
        aria-label={label}
        className="block h-full rounded-full border-0 bg-transparent p-0 outline-offset-4
                   transition-transform active:scale-95 motion-reduce:transition-none"
      >
        <span className={cx('block h-full', pop && 'animate-mascot-pop motion-reduce:animate-none')}>
          <Mascot state={shown} size={size} className="h-full w-auto" />
        </span>
      </button>
      {line && (
        <SpeechBubble
          anchor={anchor}
          text={line}
          onDismiss={() => {
            if (offline && !dismissed) setDismissed(true)
            setTurn(-1)
          }}
        />
      )}
    </div>
  )
}

/**
 * The dashboard's assistant: the same figure, standing large beside the greeting.
 *
 * `signals` is passed straight to `deriveMascotState`, so its expression reports
 * whichever dashboard figure needs attention first — overdue tools, a lost
 * connection, a page still loading — rather than a fixed pose.
 */
export function MascotGreeter({ signals, className, size = 132 }) {
  const state = useMemo(() => deriveMascotState(signals), [signals])
  const lines = useMemo(() => mascotContextFor('/dashboard').lines, [])

  return (
    <TalkingMascot
      state={state}
      lines={lines}
      // `online` defaults to true here exactly as it does in `deriveMascotState`,
      // so an omitted signal never reads as "offline".
      offline={signals?.online === false}
      size={size}
      className={className}
      label="What can I help with?"
    />
  )
}

/**
 * The assistant in the application bar: the same character, small, on every page.
 *
 * This is the one that makes the mascot a system rather than a dashboard
 * ornament — it stands in the shell, so it is present at the same size and in the
 * same place on every route, on a desktop and in the installed app alike, and its
 * pose and its lines come from the route it is standing on. The dashboard already
 * has the large one beside its greeting, so the bar leaves that page to it rather
 * than showing the character twice.
 */
export function PageMascot({ pathname, online = true, className, size = 40 }) {
  const context = useMemo(() => mascotContextFor(pathname), [pathname])

  return (
    <TalkingMascot
      state={context.state}
      lines={context.lines}
      offline={!online}
      size={size}
      className={className}
      label="What is this page for?"
    />
  )
}

/**
 * The reply, rendered into `document.body` through a portal and positioned
 * `fixed` against the mascot's own box.
 *
 * The portal is the point: the greeting sits inside a scroll container whose
 * cards clip their contents and create their own stacking contexts, so an
 * absolutely positioned bubble could be cut off or painted under a card. Out in
 * the body it can only be covered by something with a higher z-index, and
 * because it is `fixed` it never occupies layout — no card moves, resizes or
 * reflows when the mascot speaks.
 */
function SpeechBubble({ anchor, text, onDismiss }) {
  const [box, setBox] = useState(null)
  // The rectangle of an open menu — the account dropdown that carries the
  // offline notice, and any other menu the shell opens. The bubble steps out of
  // its way rather than being painted over it or under it.
  const [menu, setMenu] = useState(null)

  useEffect(() => {
    // Rectangles are stored as plain numbers and only when they have actually
    // moved. The bubble is portalled into the body, so re-rendering it is itself
    // a DOM mutation — writing state on every observation would feed the
    // observer back into itself and the bubble would never settle.
    const rect = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width }
    }
    const same = (a, b) =>
      a === b ||
      (!!a &&
        !!b &&
        a.top === b.top &&
        a.left === b.left &&
        a.right === b.right &&
        a.bottom === b.bottom &&
        a.width === b.width)

    const place = () => {
      const next = rect(anchor.current)
      if (next) setBox((prev) => (same(prev, next) ? prev : next))
      // The shell's dropdowns are mounted and unmounted, so the rectangle is
      // read from whatever menu is in the document right now.
      const openMenu = rect(document.querySelector('[role="menu"]'))
      setMenu((prev) => (same(prev, openMenu) ? prev : openMenu))
    }
    place()
    // Following the anchor keeps the caret on the mascot while the dashboard
    // scrolls underneath; `capture` catches the scrolling ancestor too.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    // A menu appears a render *after* the click that opened it, so the DOM
    // itself is what is watched rather than the click. The bubble's own subtree
    // is excluded from the reaction by the equality check above.
    const observer = new MutationObserver(place)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      observer.disconnect()
    }
  }, [anchor])

  if (!box) return null

  const GAP = 10
  // Deliberately narrow, and narrower again on a small phone: the bubble is one
  // short line of help over a page of real content, so it takes the smallest
  // footprint that stays readable.
  const width = Math.min(window.innerWidth < 380 ? 196 : 224, window.innerWidth - 24)
  // Right-aligned to the mascot, then clamped so it can never leave the screen.
  let right = Math.max(12, Math.min(window.innerWidth - box.right, window.innerWidth - width - 12))
  // Above the mascot by default; below it if there is no room up there.
  let below = box.top < 96
  let top = below ? box.bottom + GAP : undefined
  let bottom = below ? undefined : window.innerHeight - box.top + GAP
  let caretHidden = false

  // An open menu owns its space outright. Rather than guess whether the two
  // rectangles meet, the bubble simply moves out from under the menu: alongside
  // it when the screen is wide enough, otherwise directly beneath it, clear of
  // the options and of the cards the menu is covering.
  if (menu) {
    caretHidden = true
    if (menu.left - width - GAP >= 12) {
      right = window.innerWidth - menu.left + GAP
      below = true
      top = menu.top
      bottom = undefined
    } else {
      right = Math.max(12, window.innerWidth - menu.right)
      below = true
      top = menu.bottom + GAP
      bottom = undefined
    }
  }

  const caret = Math.max(16, Math.min(width - 28, window.innerWidth - right - box.left - box.width / 2))

  return createPortal(
    <div
      role="status"
      onClick={onDismiss}
      style={{ position: 'fixed', top, bottom, right, width, zIndex: 90 }}
      className="animate-slide-up cursor-pointer select-none"
    >
      <div
        className="rounded-xl border px-3 py-2 text-left text-[12px] font-semibold leading-[1.35] shadow-lift"
        style={{ background: 'rgb(var(--surface))' }}
      >
        {text}
      </div>
      {/* The caret points back at the mascot — dropped when the bubble has been
          moved clear of an open menu and no longer sits over it. */}
      {!caretHidden && (
        <div
          aria-hidden
          className="absolute h-2.5 w-2.5 border-b border-r"
          style={{
            background: 'rgb(var(--surface))',
            right: caret,
            [below ? 'top' : 'bottom']: -5,
            transform: below ? 'rotate(225deg)' : 'rotate(45deg)',
          }}
        />
      )}
    </div>,
    document.body,
  )
}
