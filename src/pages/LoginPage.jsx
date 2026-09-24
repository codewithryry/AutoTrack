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
} from '../components/AuthBranding'
import Mascot from '../components/Mascot'
import { Spinner } from '../components/ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { requestPasswordReset } from '../services/users'
import { APP_VERSION } from '../utils/constants'
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
    // Fetched alongside the sign-in, so the first screen is ready the moment
    // the session is — no loading state between the two.
    void import('./DashboardPage').catch(() => {})
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
      <section className="flex min-w-0 flex-col lg:justify-center lg:px-10 lg:py-10">
        {/* The phone's header: the accent band the app itself opens on, with the
            institution's marks, the assistant and a welcome — so signing in
            looks like the app it leads into. From `lg` the brand panel on the
            left does this job instead. */}
        <div
          className="relative overflow-hidden px-6 pb-14 pt-[calc(env(safe-area-inset-top,0px)+2rem)] lg:hidden"
          style={{
            background: 'linear-gradient(180deg, rgb(var(--hero-bg)) 0%, rgb(var(--hero-bg-2)) 100%)',
            color: 'rgb(var(--hero-fg))',
          }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(120% 70% at 0% 0%, rgb(255 255 255 / 0.3) 0%, transparent 55%)' }}
          />
          <div className="relative mx-auto max-w-sm">
            <InstitutionLogos size="sm" className="!justify-start" />
            <div className="mt-5 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold opacity-70">Welcome back</p>
                <h2 className="mt-0.5 text-[28px] font-extrabold leading-[1.1] tracking-tight">
                  Sign in to {BRAND_NAME}
                </h2>
              </div>
              <Mascot state="happy" size={92} className="-mb-2 shrink-0" />
            </div>
          </div>
        </div>

        {/* The form on a sheet that rises over the band on a phone; a plain,
            centred column from `lg`. */}
        <div
          className="relative z-10 -mt-8 flex-1 rounded-t-[28px] px-6 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] pt-7
                     lg:mt-0 lg:flex-none lg:rounded-none lg:p-0"
          style={{ background: 'rgb(var(--app-bg))' }}
        >
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-7 hidden flex-col items-center text-center lg:flex">
            <h2 className="text-2xl font-extrabold tracking-tight">Sign in</h2>
            <p className="muted mt-1.5 text-sm">
              Use your laboratory account to access the tool monitoring system.
            </p>
          </div>
          <p className="muted mb-5 text-[13.5px] lg:hidden">
            Use your laboratory account to continue.
          </p>

          <form onSubmit={submit} className="auth-form space-y-4" noValidate>
            {notice && !errors.form && (
              <div
                role="status"
                className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm
                           font-medium text-emerald-800 dark:border-emerald-500/30
                           dark:bg-emerald-500/10 dark:text-emerald-200"
              >
                {notice}
              </div>
            )}

            {errors.form && (
              <div
                role="alert"
                className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm
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
                  className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2"
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
                  className={cx('input h-12 rounded-2xl pl-11 shadow-sm', errors.email && 'input-error')}
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
              {/* Forgot password sits with the field it is about. It sends the
                  reset link to the email typed above, exactly as before. */}
              <div className="flex items-baseline justify-between gap-3">
                <label className="label" htmlFor="password">
                  Password
                </label>
                <button
                  type="button"
                  onClick={resetPassword}
                  disabled={resetting || submitting}
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-amberline-700
                             hover:underline disabled:opacity-60 dark:text-amberline-400"
                >
                  {resetting && <Spinner className="h-3.5 w-3.5" />}
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2"
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
                  className={cx('input h-12 rounded-2xl px-11 shadow-sm', errors.password && 'input-error')}
                  aria-invalid={!!errors.password}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center
                             rounded-xl transition-colors hover:bg-black/5 dark:hover:bg-white/10"
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

            <button
              type="submit"
              className="btn btn-lg !mt-6 h-12 w-full rounded-2xl text-[15px] font-bold shadow-lift
                         transition-transform active:scale-[0.98]"
              style={{ background: 'rgb(var(--hero-cta-bg))', color: 'rgb(var(--hero-cta-fg))' }}
              disabled={submitting}
            >
              {submitting ? <Spinner /> : <LogIn className="h-4 w-4" />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* ------------------------ new account ------------------------ */}
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1" style={{ background: 'rgb(var(--border))' }} />
            <span className="subtle text-[12px] font-semibold">New here?</span>
            <span className="h-px flex-1" style={{ background: 'rgb(var(--border))' }} />
          </div>
          <Link
            to="/signup"
            className="flex h-12 w-full items-center justify-center rounded-2xl border text-[14.5px] font-bold
                       transition-colors hover:bg-black/[0.03] dark:hover:bg-white/5"
            style={{ background: 'rgb(var(--surface))' }}
          >
            Create an account
          </Link>
          <p className="subtle mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
            Students can sign in as soon as they register. Instructor accounts are verified first.
          </p>

          {/* One quiet line: what the app is and which build this is. */}
          <p className="subtle mt-8 text-center text-[10px] leading-relaxed opacity-70">
            Smart Tool Monitoring System · Version {APP_VERSION}
          </p>
        </div>
        </div>
      </section>
    </div>
  )
}
