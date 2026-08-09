import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cx } from '../utils/helpers'

/** Toast notifications — the app's feedback channel for every action. */

const ToastContext = createContext(null)

const VARIANTS = {
  success: {
    icon: CheckCircle2,
    bar: 'bg-emerald-500',
    iconClass: 'text-emerald-500',
  },
  error: {
    icon: XCircle,
    bar: 'bg-red-500',
    iconClass: 'text-red-500',
  },
  warning: {
    icon: AlertTriangle,
    bar: 'bg-orange-500',
    iconClass: 'text-orange-500',
  },
  info: {
    icon: Info,
    bar: 'bg-blue-500',
    iconClass: 'text-blue-500',
  },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (variant, message, options = {}) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const toast = {
        id,
        variant,
        message,
        title: options.title,
        duration: options.duration ?? (variant === 'error' ? 6000 : 4000),
      }
      setToasts((list) => [...list.slice(-3), toast])
      if (toast.duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), toast.duration),
        )
      }
      return id
    },
    [dismiss],
  )

  const api = useMemo(
    () => ({
      success: (message, options) => push('success', message, options),
      error: (message, options) => push('error', message, options),
      warning: (message, options) => push('warning', message, options),
      info: (message, options) => push('info', message, options),
      dismiss,
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed z-[100] flex flex-col gap-2 pointer-events-none
                   left-1/2 -translate-x-1/2 bottom-24 w-[min(24rem,calc(100vw-2rem))]
                   sm:left-auto sm:translate-x-0 sm:right-4 sm:bottom-4 sm:w-96"
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map((toast) => {
          const variant = VARIANTS[toast.variant] ?? VARIANTS.info
          const Icon = variant.icon
          return (
            <div
              key={toast.id}
              className="card relative pointer-events-auto flex items-start gap-3 overflow-hidden
                         p-3 pl-4 shadow-panel animate-slide-up"
              role={toast.variant === 'error' ? 'alert' : 'status'}
            >
              <span className={cx('absolute left-0 top-0 h-full w-1', variant.bar)} />
              <Icon className={cx('mt-0.5 h-5 w-5 shrink-0', variant.iconClass)} />
              <div className="min-w-0 flex-1">
                {toast.title && <p className="text-sm font-bold leading-tight">{toast.title}</p>}
                <p className={cx('text-sm leading-snug', toast.title && 'muted mt-0.5')}>
                  {toast.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="btn btn-ghost btn-icon -mr-1 -mt-1 shrink-0"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
