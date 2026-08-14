import {
  createContext,
  useCallback,
  useContext,

  useMemo,
  useRef,
  useState,
} from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'

/** Toast notifications — the app's feedback channel for every action. */

const ToastContext = createContext(null)
const ToastFeedContext = createContext([])

/**
 * What each kind of notice looks like.
 *
 * The icon is the point: a submission accepted, a warning and a failure all
 * carry the same two lines of text, and the glyph is what tells them apart
 * before the sentence is read. Icons come from lucide, the project's own set,
 * and the tint is the same status palette the badges use.
 */
export const TOAST_VARIANTS = {
  success: {
    icon: CheckCircle2,
    chip: 'bg-emerald-500/12 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
    edge: 'ring-emerald-500/25',
  },
  error: {
    icon: XCircle,
    chip: 'bg-red-500/12 text-red-600 dark:bg-red-500/15 dark:text-red-400',
    edge: 'ring-red-500/25',
  },
  warning: {
    icon: AlertTriangle,
    chip: 'bg-orange-500/12 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400',
    edge: 'ring-orange-500/25',
  },
  info: {
    icon: Info,
    chip: 'bg-blue-500/12 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
    edge: 'ring-blue-500/25',
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
        // A CSS selector for the control or section this notice is about. When
        // it matches something on screen the card is placed against it; when it
        // does not — or none was given — the card falls to the foot of the
        // screen. Optional, so every existing caller is unchanged.
        anchor: options.anchor,
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

  // The provider no longer paints anything itself: the shell's account control
  // is the one place a notice appears, and it reads the queue through
  // `useToastFeed`. Every message, variant, duration and timer above is
  // untouched — only where they are shown has moved.
  return (
    <ToastContext.Provider value={api}>
      <ToastFeedContext.Provider value={toasts}>{children}</ToastFeedContext.Provider>
    </ToastContext.Provider>
  )
}

/**
 * The live queue, newest last. The shell subscribes to this to show the current
 * notice in place of the account control; nothing else should need it.
 */
export function useToastFeed() {
  return useContext(ToastFeedContext)
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
