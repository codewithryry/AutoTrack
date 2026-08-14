import { Link } from 'react-router-dom'
import { cx } from '../utils/helpers'

/**
 * Dashboard metric tile.
 *
 * `tone` drives the accent so an overdue count still reads as a warning at a
 * glance — carried by the icon chip and, for the two alarming tones, the figure
 * itself, rather than by the thick coloured slab this tile used to wear. One
 * radius, one border weight and one type scale, shared with every other module
 * on the page.
 */

const TONES = {
  default: {
    icon: 'bg-navy-950/8 text-navy-950 dark:bg-white/10 dark:text-white',
    value: '',
  },
  accent: {
    icon: 'bg-amberline-400/15 text-amberline-700 dark:text-amberline-400',
    value: '',
  },
  success: {
    icon: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    value: '',
  },
  info: {
    icon: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
    value: '',
  },
  warning: {
    icon: 'bg-orange-500/12 text-orange-600 dark:text-orange-400',
    value: 'text-orange-600 dark:text-orange-400',
  },
  danger: {
    icon: 'bg-red-500/12 text-red-600 dark:text-red-400',
    value: 'text-red-600 dark:text-red-400',
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
  variant = 'card',
}) {
  const style = TONES[tone] ?? TONES.default
  const Wrapper = to ? Link : 'div'
  // `tile` is the dashboard's compact statistic: no drop shadow, no hover lift,
  // a lighter hairline and more room at desktop widths. `card` is the original
  // and remains the default, so the reports page is unaffected.
  const tile = variant === 'tile'
  // Zero is the good news on a warning tile, so it stays in the ordinary colour
  // — only a real count is worth colouring.
  const alarming = Boolean(style.value) && value !== 0 && value !== '0'

  return (
    <Wrapper
      {...(to ? { to } : {})}
      className={cx(
        tile
          ? 'tile p-3.5 lg:p-4'
          : cx('card p-3 sm:p-3.5', to && 'transition-all hover:-translate-y-0.5 hover:shadow-lift'),
      )}
    >
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span
            className={cx(
              'grid shrink-0 place-items-center rounded-[10px]',
              tile ? 'h-7 w-7' : 'h-8 w-8',
              style.icon,
            )}
          >
            <Icon className={cx(tile ? 'h-4 w-4' : 'h-[17px] w-[17px]')} />
          </span>
        )}
        {/* `break-words` because these labels are set in wide-tracked capitals:
            two tiles to a 360px row leaves about 100px beside the icon chip, and
            a single long word ("TRANSACTIONS") would otherwise run out past the
            card edge rather than wrapping. */}
        <p className="subtle min-w-0 break-words text-[10.5px] font-bold uppercase leading-tight tracking-[0.08em]">
          {label}
        </p>
      </div>

      {loading ? (
        <div className="skeleton mt-2.5 h-7 w-14" />
      ) : (
        <p
          className={cx(
            'mono font-extrabold leading-none tracking-tight',
            tile ? 'mt-3 text-[28px] lg:text-[32px]' : 'mt-2.5 text-[26px]',
            alarming && style.value,
          )}
        >
          {value}
        </p>
      )}

      {hint && <p className="subtle mt-1 truncate text-[11px] leading-snug">{hint}</p>}
    </Wrapper>
  )
}
