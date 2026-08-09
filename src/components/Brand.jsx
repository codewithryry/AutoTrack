import { cx } from '../utils/helpers'

/** The wrench-inside-a-QR mark used in the sidebar, login and install prompts. */
export function BrandMark({ className, size = 40 }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cx('shrink-0', className)}
      role="img"
      aria-label="Smart Tool Monitoring System"
    >
      <rect width="64" height="64" rx="14" fill="#0B1220" />
      <g fill="#F7C948">
        <path d="M14 12h11v11H14zM39 12h11v11H39zM14 41h11v11H14z" opacity=".25" />
        <path d="M14 12h11v3H14zM14 12h3v11h-3zM22 12h3v11h-3zM14 20h11v3H14z" />
        <path d="M39 12h11v3H39zM39 12h3v11h-3zM47 12h3v11h-3zM39 20h11v3H39z" />
        <path d="M14 41h11v3H14zM14 41h3v11h-3zM22 41h3v11h-3zM14 49h11v3H14z" />
        <rect x="17.5" y="15.5" width="4" height="4" />
        <rect x="42.5" y="15.5" width="4" height="4" />
        <rect x="17.5" y="44.5" width="4" height="4" />
      </g>
      <path
        d="M50.6 31.4a7.4 7.4 0 0 0-9.6 9.3l-8.9 8.9a2.6 2.6 0 0 0 0 3.7l.7.7a2.6 2.6 0 0 0 3.7 0l8.9-8.9a7.4 7.4 0 0 0 9.3-9.6l-3.9 3.9-3.6-1-1-3.6z"
        fill="#F0B429"
      />
    </svg>
  )
}

export function BrandLockup({ className, compact = false, inverted = true }) {
  return (
    <div className={cx('flex items-center gap-2.5', className)}>
      <BrandMark size={compact ? 32 : 38} />
      {!compact && (
        <div className="min-w-0 leading-tight">
          <p
            className={cx(
              'truncate text-[13px] font-extrabold uppercase tracking-wide',
              inverted ? 'text-white' : '',
            )}
          >
            Smart Tool
          </p>
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-amberline-400">
            Monitoring System
          </p>
        </div>
      )}
    </div>
  )
}
