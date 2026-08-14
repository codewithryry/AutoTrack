import { Children, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Loader2, Search, X } from 'lucide-react'
import { cx } from '../utils/helpers'
import {
  CONDITION_STYLES,
  MAINTENANCE_STATUS_STYLES,
  ROLE_STYLES,
  STATUS_STYLES,
  TXN_STATUS_STYLES,
  USER_STATUS_STYLES,
} from '../utils/constants'

/* ------------------------------------------------------------------ *
 * Badges
 * ------------------------------------------------------------------ */

const NEUTRAL_BADGE =
  'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/25'

export function Badge({ children, className, dot = false }) {
  return (
    <span className={cx('badge', className ?? NEUTRAL_BADGE)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export const StatusBadge = ({ status, dot = true }) => (
  <Badge className={STATUS_STYLES[status]} dot={dot}>
    {status}
  </Badge>
)

export const TxnStatusBadge = ({ status, dot = true }) => (
  <Badge className={TXN_STATUS_STYLES[status]} dot={dot}>
    {status}
  </Badge>
)

export const ConditionBadge = ({ condition }) => (
  <Badge className={CONDITION_STYLES[condition]}>{condition}</Badge>
)

export const RoleBadge = ({ role }) => <Badge className={ROLE_STYLES[role]}>{role}</Badge>

export const UserStatusBadge = ({ status }) => (
  <Badge className={USER_STATUS_STYLES[status]} dot>
    {status}
  </Badge>
)

export const MaintenanceStatusBadge = ({ status }) => (
  <Badge className={MAINTENANCE_STATUS_STYLES[status]} dot>
    {status}
  </Badge>
)

/* ------------------------------------------------------------------ *
 * Page furniture
 * ------------------------------------------------------------------ */

export function PageHeader({
  title,
  description,
  children,
  icon: Icon,
  hideTitleMobile = false,
  hideTitle = false,
}) {
  // `false`/`null` children are what a permission check leaves behind, so the
  // actions are counted after they are dropped — a header with nothing left in
  // it must not reserve any space.
  const actions = Children.toArray(children)
  const hasActions = actions.length > 0
  // The sticky header already names the page on a phone, so a page may drop its
  // own H1 there and keep only the action buttons. With no actions nothing is
  // left to show, so the whole block is hidden until `sm`, where it returns.
  //
  // `hideTitle` goes further: the sidebar and the sticky header both name the
  // page on every width, so the page drops its H1 outright and keeps only its
  // actions — and nothing at all when it has none, leaving no empty gap.
  if (hideTitle && !hasActions) return null
  return (
    <div
      className={cx(
        'mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        hideTitleMobile && !hasActions && 'hidden sm:block',
        // Nothing sits on the left any more, so the actions keep their place.
        hideTitle && 'sm:justify-end',
      )}
    >
      {!hideTitle && (
        <div className={cx('min-w-0', hideTitleMobile && 'hidden sm:block')}>
          <div className="flex items-center gap-2.5">
            {Icon && (
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg
                           bg-amberline-400/15 text-amberline-600 dark:text-amberline-400"
              >
                <Icon className="h-5 w-5" />
              </span>
            )}
            <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h1>
          </div>
          {description && <p className="muted mt-1.5 text-sm">{description}</p>}
        </div>
      )}
      {hasActions && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

/**
 * A titled panel.
 *
 * `flat` is opt-in and changes nothing for the pages that do not ask for it: the
 * header keeps the card's own surface and loses the filled strip and the rule
 * under it, so several panels stacked on one screen read as modules of a single
 * page rather than as a column of separate boxes.
 */
/**
 * `variant` picks the surface, and with it the section's rank on the page:
 * `card` is the original and stays the default, so every existing caller is
 * untouched. `panel` and `quiet` are the dashboard's primary/secondary pair —
 * see the `.panel` block in `index.css`.
 */
const SECTION_SURFACE = { card: 'card', panel: 'panel', quiet: 'panel-quiet' }

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  flat = false,
  variant = 'card',
  ...rest // `data-tour` and friends, so a card can be a walkthrough target
}) {
  // A quiet panel is already recessed; a heavy filled header on top of it would
  // put the ranking back the wrong way round, so it is always flat.
  const bare = flat || variant === 'quiet'
  return (
    <section
      className={cx(SECTION_SURFACE[variant] ?? 'card', 'overflow-hidden', className)}
      {...rest}
    >
      {(title || action) && (
        <header
          // `px-4` for every variant, deliberately: the list rows inside these
          // sections are `px-4` too, and a roomier header would leave the title
          // hanging four pixels off the column of text beneath it.
          className={cx(
            'flex items-center justify-between gap-3 px-4',
            bare ? 'pb-2 pt-3.5 sm:pt-4' : 'border-b py-3',
          )}
          style={bare ? undefined : { background: 'rgb(var(--surface-2))' }}
        >
          <div className="min-w-0">
            {title && (
              <h2
                className={cx(
                  'truncate font-bold tracking-tight',
                  variant === 'card' ? (flat ? 'text-[15px]' : 'text-sm') : 'text-[15px] sm:text-base',
                )}
              >
                {title}
              </h2>
            )}
            {description && <p className="subtle mt-0.5 text-xs">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cx(bodyClassName ?? 'p-4')}>{children}</div>
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * States
 * ------------------------------------------------------------------ */

export function EmptyState({ icon: Icon, title, description, action, compact = false }) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
      )}
    >
      {Icon && (
        <span
          className="mb-3 grid h-12 w-12 place-items-center rounded-xl"
          style={{ background: 'rgb(var(--surface-3))' }}
        >
          <Icon className="h-6 w-6" style={{ color: 'rgb(var(--text-subtle))' }} />
        </span>
      )}
      <p className="text-sm font-bold">{title}</p>
      {description && <p className="muted mt-1 max-w-sm text-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', description, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-red-500/10">
        <AlertTriangle className="h-6 w-6 text-red-500" />
      </span>
      <p className="text-sm font-bold">{title}</p>
      {description && <p className="muted mt-1 max-w-sm text-sm">{description}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-outline mt-4">
          Try again
        </button>
      )}
    </div>
  )
}

export const Spinner = ({ className, ...props }) => (
  <Loader2 className={cx('h-4 w-4 animate-spin', className)} {...props} />
)

export function LoadingBlock({ label = 'Loading…', className }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 py-12', className)}>
      <Spinner className="h-5 w-5" style={{ color: 'rgb(var(--accent))' }} />
      <span className="muted text-sm">{label}</span>
    </div>
  )
}

export const Skeleton = ({ className }) => <div className={cx('skeleton', className)} />

export function SkeletonRows({ rows = 5, columns = 4 }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} className={cx('h-9', c === 0 ? 'w-2/5' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 4, className }) {
  return (
    <div className={cx('grid gap-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

export function SearchInput({ value, onChange, placeholder = 'Search…', className }) {
  return (
    <div className={cx('relative', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
        style={{ color: 'rgb(var(--text-subtle))' }}
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input pl-9 pr-9"
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center
                     rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export function Field({ label, error, hint, required, children, className, htmlFor }) {
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="subtle mt-1 text-xs">{hint}</p>
      ) : null}
    </div>
  )
}

export function TextField({ label, error, hint, required, className, ...props }) {
  const id = useId()
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className} htmlFor={id}>
      <input
        id={id}
        className={cx('input', error && 'input-error')}
        aria-invalid={!!error}
        {...props}
      />
    </Field>
  )
}

export function SelectField({ label, error, hint, required, options, className, placeholder, ...props }) {
  const id = useId()
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className} htmlFor={id}>
      <select
        id={id}
        className={cx('input', error && 'input-error')}
        aria-invalid={!!error}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => {
          const value = typeof option === 'string' ? option : option.value
          const label2 = typeof option === 'string' ? option : option.label
          return (
            <option key={value} value={value}>
              {label2}
            </option>
          )
        })}
      </select>
    </Field>
  )
}

export function TextAreaField({ label, error, hint, required, className, rows = 3, ...props }) {
  const id = useId()
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className} htmlFor={id}>
      <textarea
        id={id}
        rows={rows}
        className={cx('input resize-y', error && 'input-error')}
        aria-invalid={!!error}
        {...props}
      />
    </Field>
  )
}

/** Compact labelled dropdown used in filter bars. */
export function FilterSelect({ label, value, onChange, options, className }) {
  const id = useId()
  return (
    <div className={cx('flex items-center gap-2', className)}>
      {label && (
        <label htmlFor={id} className="subtle hidden text-xs font-semibold uppercase sm:block">
          {label}
        </label>
      )}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input btn-sm min-h-[36px] w-full py-0 text-xs sm:w-auto"
        aria-label={label}
      >
        {options.map((option) => {
          const val = typeof option === 'string' ? option : option.value
          const text = typeof option === 'string' ? option : option.label
          return (
            <option key={val} value={val}>
              {text}
            </option>
          )
        })}
      </select>
    </div>
  )
}

export function Toggle({ checked, onChange, label, description, disabled }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-sm font-semibold">
          {label}
        </label>
        {description && <p className="muted mt-0.5 text-xs">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

const SIZES = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-xl',
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-5xl',
}

/**
 * Accessible modal. On phones it rises from the bottom as a sheet with its own
 * scroll container, so a long form never pushes the page sideways or traps the
 * submit button off-screen.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    // Move focus into the dialog so keyboard and screen-reader users land inside it.
    const timer = setTimeout(() => {
      const target = panelRef.current?.querySelector(
        'input:not([type="hidden"]), select, textarea, button',
      )
      target?.focus?.()
    }, 60)
    return () => clearTimeout(timer)
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'card relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-b-none',
          'rounded-t-2xl shadow-panel animate-slide-up sm:rounded-2xl',
          SIZES[size],
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold">{title}</h2>
            {description && <p className="muted mt-0.5 text-xs">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon -mr-1 shrink-0"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {children}
        </div>

        {footer && (
          <footer
            className="safe-bottom flex shrink-0 flex-col-reverse gap-2 border-t px-4 py-3
                       sm:flex-row sm:justify-end sm:px-5"
            style={{ background: 'rgb(var(--surface-2))' }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Destructive-action confirmation. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
}) {
  return (
    <Modal
      open={open}
      onClose={loading ? undefined : onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={cx('btn', variant === 'danger' ? 'btn-danger' : 'btn-primary')}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <Spinner />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        <span
          className={cx(
            'grid h-10 w-10 shrink-0 place-items-center rounded-full',
            variant === 'danger' ? 'bg-red-500/10' : 'bg-amberline-400/15',
          )}
        >
          <AlertTriangle
            className={cx(
              'h-5 w-5',
              variant === 'danger' ? 'text-red-500' : 'text-amberline-600 dark:text-amberline-400',
            )}
          />
        </span>
        <p className="muted pt-1.5 text-sm leading-relaxed">{message}</p>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

/** Label/value pair used across the detail panels. */
export function DetailItem({ label, children, className, mono = false }) {
  return (
    <div className={className}>
      <dt className="subtle text-[11px] font-bold uppercase tracking-wider">{label}</dt>
      <dd className={cx('mt-1 text-sm font-medium', mono && 'mono')}>{children ?? '—'}</dd>
    </div>
  )
}

export function ProgressBar({ value, max = 100, className, barClassName, label }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className={className}>
      {label && (
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="muted">{label}</span>
          <span className="mono font-semibold">{Math.round(pct)}%</span>
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'rgb(var(--surface-3))' }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cx('h-full rounded-full transition-all duration-500', barClassName ?? 'bg-amberline-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/** Table container that scrolls horizontally on its own, never the page. */
export function TableWrap({ children, className }) {
  return <div className={cx('table-wrap', className)}>{children}</div>
}
