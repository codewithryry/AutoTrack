import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ClipboardCheck,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  Mail,
  QrCode,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import {
  AuthBrandLockup,
  BRAND_NAME,
  InstitutionLogos,
  InstitutionNames,
} from '../components/AuthBranding'
import { Spinner } from '../components/ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { requestPasswordReset } from '../services/users'
import { cx } from '../utils/helpers'

/**
 * Where to land after signing in.
 *
 * `from` is whatever path the guard interrupted, which may be a stale or mistyped
 * link — sending somebody straight to "Page not found" is a poor first screen, so
 * anything not recognisably an application route falls back to the dashboard.
 */
const APP_ROUTES = [
  '/dashboard',
  '/tools',
  '/scan',
  '/borrow',
  '/return',
  '/transactions',
  '/users',
  '/maintenance',
  '/notifications',
  '/reports',
  '/settings',
]

function safeReturnTo(from) {
  if (typeof from !== 'string' || !from.startsWith('/')) return '/dashboard'
  const path = from.split('?')[0]
  return APP_ROUTES.some((route) => path === route || path.startsWith(`${route}/`))
    ? from
    : '/dashboard'
}

const HIGHLIGHTS = [
  { icon: QrCode, title: 'QR-tagged equipment', text: 'Every wrench, gauge and scan tool carries its own code.' },
  { icon: ClipboardCheck, title: 'Accountable borrowing', text: 'Know who holds each tool and when it is due back.' },
  { icon: Wrench, title: 'Service tracking', text: 'Calibration and maintenance history stays with the tool.' },
]

/**
 * Sign-in screen.
 *
 * Credentials go straight to the local auth layer; the password is held in
 * component state only until the request completes. The role that decides where
 * the user lands comes from their stored profile, never from this form.
 */
export default function LoginPage() {
  const { login, sessionError, clearSessionError } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  // Arriving from sign-up carries a confirmation and the new email address.
  const [notice, setNotice] = useState(location.state?.notice ?? null)
  const [form, setForm] = useState({ email: location.state?.email ?? '', password: '' })
  const [errors, setErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [resetting, setResetting] = useState(false)

  // A session that was rejected after being restored (no profile, pending
  // approval, or inactive) explains itself here rather than silently bouncing.
  useEffect(() => {
    if (sessionError) {
      setErrors({ form: sessionError })
      setNotice(null)
    }
  }, [sessionError])

  const setField = (field) => (event) => {
    setForm((f) => ({ ...f, [field]: event.target.value }))
    setErrors((e) => ({ ...e, [field]: undefined, form: undefined }))
    if (sessionError) clearSessionError()
  }

  const submit = async (event) => {
    event?.preventDefault()
    setSubmitting(true)
    setErrors({})
    try {
      const user = await login(form.email, form.password)
      // The password is not kept around after a successful sign-in.
      setForm((f) => ({ ...f, password: '' }))
      toast.success(`Welcome back, ${user.fullName.split(' ')[0]}.`, {
        title: `Signed in as ${user.role}`,
      })
      navigate(safeReturnTo(location.state?.from), { replace: true })
    } catch (err) {
      if (err?.field) setErrors({ [err.field]: err.message })
      else setErrors({ form: err.message ?? 'Unable to sign in.' })
    } finally {
      setSubmitting(false)
    }
  }

  /** Password reset needs a backend; the local build explains that instead. */
  const resetPassword = async () => {
    if (!form.email.trim()) {
      setErrors({ email: 'Enter your email address first.' })
      return
    }
    setResetting(true)
    try {
      await requestPasswordReset(form.email.trim())
      toast.success(`A password reset link was sent to ${form.email.trim()}.`, {
        title: 'Check your inbox',
      })
    } catch (err) {
      setErrors({ form: err.message ?? 'The reset email could not be sent.' })
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.1fr_1fr]">
      {/* ------------------------- brand panel ------------------------- */}
      <section
        className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex"
        style={{ background: 'rgb(var(--rail))' }}
      >
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-[0.07]" />
        <div className="hazard-stripe absolute inset-x-0 top-0 h-1.5" />

        <div className="relative">
          <AuthBrandLockup onDark align="start" />
          <h1 className="mt-8 max-w-md text-4xl font-extrabold leading-[1.1] tracking-tight text-white">
            The automotive laboratory,
            <span className="block text-amberline-400">under control.</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-navy-300">
            {BRAND_NAME} keeps every tool in the workshop accounted for — from the torque wrenches on
            Shelf A to the diagnostic scanner in the bay. Scan, issue, return.
          </p>
        </div>

        <ul className="relative mt-10 space-y-4">
          {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3.5">
              <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amberline-400/10 ring-1 ring-amberline-400/25">
                <Icon className="h-5 w-5 text-amberline-400" />
              </span>
              <div>
                <p className="text-sm font-bold text-white">{title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-navy-400">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* --------------------------- form --------------------------- */}
      <section
        // On a phone the column starts at the top rather than sitting centred,
        // so the marks are the first thing on screen instead of floating in the
        // middle of it. From `sm` the centred desktop layout is unchanged.
        className="flex min-w-0 flex-col justify-start px-5 sm:justify-center sm:px-10
                   pb-[calc(env(safe-area-inset-bottom,0px)+2.5rem)]
                   pt-[calc(env(safe-area-inset-top,0px)+2.5rem)] sm:py-10"
      >
        <div className="mx-auto w-full max-w-sm">

          {/* The institutional marks sit across the top of the phone screen,
              above everything else, rather than inside the form block. The
              desktop keeps them on the brand panel to the left. */}
          <div className="mb-5 lg:hidden">
            <InstitutionNames className="mb-2" />
            <InstitutionLogos size="sm" />
          </div>

          <div className="mb-7 mt-2 flex flex-col items-center text-center">
            <h2 className="text-2xl font-extrabold tracking-tight">Sign in</h2>
            <p className="muted mt-1.5 text-sm">
              Use your laboratory account to access the tool monitoring system.
            </p>
          </div>

          <form onSubmit={submit} className="auth-form space-y-4" noValidate>
            {notice && !errors.form && (
              <div
                role="status"
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm
                           font-medium text-emerald-800 dark:border-emerald-500/30
                           dark:bg-emerald-500/10 dark:text-emerald-200"
              >
                {notice}
              </div>
            )}

            {errors.form && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm
                           font-medium text-red-700 dark:border-red-500/30 dark:bg-red-500/10
                           dark:text-red-300"
              >
                {errors.form}
              </div>
            )}

            <div>
              <label className="label" htmlFor="email">
                Email address
              </label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2"
                  style={{ color: 'rgb(var(--text-subtle))' }}
                />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck="false"
                  value={form.email}
                  onChange={setField('email')}
                  placeholder="name@autolab.edu.ph"
                  className={cx('input pl-11', errors.email && 'input-error')}
                  aria-invalid={!!errors.email}
                />
              </div>
              {errors.email && (
                <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                  {errors.email}
                </p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2"
                  style={{ color: 'rgb(var(--text-subtle))' }}
                />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={form.password}
                  onChange={setField('password')}
                  placeholder="••••••••"
                  className={cx('input px-11', errors.password && 'input-error')}
                  aria-invalid={!!errors.password}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center
                             rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                  {errors.password}
                </p>
              )}
            </div>

            <button type="submit" className="btn btn-primary btn-lg w-full rounded-xl" disabled={submitting}>
              {submitting ? <Spinner /> : <LogIn className="h-4 w-4" />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* ------------------------ account help ------------------------ */}
          <div className="mt-8">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" style={{ color: 'rgb(var(--text-subtle))' }} />
              <span className="subtle text-[12px] font-bold">Account help</span>
              <span className="h-px flex-1" style={{ background: 'rgb(var(--border))' }} />
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={resetPassword}
                disabled={resetting || submitting}
                className="card flex w-full items-center gap-3 p-3 text-left transition-all
                           hover:shadow-lift disabled:opacity-60"
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                  style={{ background: 'rgb(var(--rail))', color: 'rgb(var(--accent))' }}
                >
                  {resetting ? <Spinner className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">Forgot your password?</span>
                  <span className="subtle block truncate text-xs">
                    Email a reset link to the address above.
                  </span>
                </span>
                <span className="subtle shrink-0 text-[12px] font-bold">Send</span>
              </button>
            </div>

            <p className="subtle mt-4 text-xs leading-relaxed">
              No account yet?{' '}
              <Link
                to="/signup"
                className="font-bold text-amberline-700 hover:underline dark:text-amberline-400"
              >
                Create one
              </Link>
              . Students and instructors can sign in as soon as they register.
            </p>
          </div>

          {/* Kept with the form column so it centres under it at every width and
              stays clear of the phone's home indicator via the section's own
              safe-area padding. */}
          <p className="subtle mt-8 text-center text-[11px] font-semibold">
            Powered by Student BTVTED
          </p>
        </div>
      </section>
    </div>
  )
}
