import { Link } from 'react-router-dom'
import { cx } from '../utils/helpers'

/**
 * Dashboard metric tile. `tone` drives the accent so an overdue count reads as
 * a warning at a glance without adding decoration.
 */

const TONES = {
  default: {
    ring: 'border-l-navy-950 dark:border-l-navy-200',
    icon: 'bg-navy-950/8 text-navy-950 dark:bg-white/10 dark:text-white',
  },
  accent: {
    ring: 'border-l-amberline-500',
    icon: 'bg-amberline-400/15 text-amberline-700 dark:text-amberline-400',
  },
  success: {
    ring: 'border-l-emerald-500',
    icon: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  },
  info: {
    ring: 'border-l-blue-500',
    icon: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
  },
  warning: {
    ring: 'border-l-orange-500',
    icon: 'bg-orange-500/12 text-orange-600 dark:text-orange-400',
  },
  danger: {
    ring: 'border-l-red-500',
    icon: 'bg-red-500/12 text-red-600 dark:text-red-400',
  },
}

export default function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'default',
  hint,
  to,
  loading = false,
}) {
  const style = TONES[tone] ?? TONES.default
  const Wrapper = to ? Link : 'div'

  return (
    <Wrapper
      {...(to ? { to } : {})}
      className={cx(
        'card border-l-4 p-3.5 sm:p-4',
        style.ring,
        to && 'transition-all hover:-translate-y-0.5 hover:shadow-lift',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="subtle text-[11px] font-bold uppercase leading-tight tracking-wider">
          {label}
        </p>
        {Icon && (
          <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', style.icon)}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>

      {loading ? (
        <div className="skeleton mt-2 h-8 w-16" />
      ) : (
        <p className="mono mt-1.5 text-[28px] font-extrabold leading-none tracking-tight">
          {value}
        </p>
      )}

      {hint && <p className="subtle mt-1.5 truncate text-xs">{hint}</p>}
    </Wrapper>
  )
}
