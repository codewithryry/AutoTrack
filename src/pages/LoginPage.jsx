import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, LogIn, ShieldCheck, User, Wrench, QrCode, ClipboardCheck } from 'lucide-react'
import { BrandMark } from '../components/Brand'
import { Spinner } from '../components/ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { DEMO_ACCOUNTS } from '../services/auth'
import { APP_NAME, APP_TAGLINE } from '../utils/constants'
import { cx } from '../utils/helpers'

const HIGHLIGHTS = [
  { icon: QrCode, title: 'QR-tagged equipment', text: 'Every wrench, gauge and scan tool carries its own code.' },
  { icon: ClipboardCheck, title: 'Accountable borrowing', text: 'Know who holds each tool and when it is due back.' },
  { icon: Wrench, title: 'Service tracking', text: 'Calibration and maintenance history stays with the tool.' },
]

export default function LoginPage() {
  const { login, settings } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const [form, setForm] = useState({ username: '', password: '' })
  const [errors, setErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const setField = (field) => (event) => {
    setForm((f) => ({ ...f, [field]: event.target.value }))
    setErrors((e) => ({ ...e, [field]: undefined, form: undefined }))
  }

  const submit = async (event, credentials) => {
    event?.preventDefault()
    const payload = credentials ?? form
    setSubmitting(true)
    setErrors({})
    try {
      const user = await login(payload.username, payload.password)
      toast.success(`Welcome back, ${user.fullName.split(' ')[0]}.`, {
        title: `Signed in as ${user.role}`,
      })
      navigate(location.state?.from ?? '/dashboard', { replace: true })
    } catch (err) {
      if (err?.field) setErrors({ [err.field]: err.message })
      else setErrors({ form: err.message ?? 'Unable to sign in.' })
    } finally {
      setSubmitting(false)
    }
  }

  const useDemo = (account) => {
    setForm({ username: account.username, password: account.password })
    setErrors({})
    submit(null, account)
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
          <BrandMark size={52} />
          <h1 className="mt-8 max-w-md text-4xl font-extrabold leading-[1.1] tracking-tight text-white">
            The automotive laboratory,
            <span className="block text-amberline-400">under control.</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-navy-300">
            {APP_NAME} keeps every tool in the workshop accounted for — from the torque wrenches on
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

        <div className="relative border-t border-white/10 pt-5">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amberline-400">
            {APP_TAGLINE}
          </p>
          <p className="mt-1.5 text-xs text-navy-400">
            {settings.labName} · {settings.labLocation}
          </p>
        </div>
      </section>

      {/* --------------------------- form --------------------------- */}
      <section className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-7 flex flex-col items-center text-center lg:items-start lg:text-left">
            <div className="lg:hidden">
              <BrandMark size={54} />
            </div>
            <h2 className="mt-5 text-2xl font-extrabold tracking-tight lg:mt-0">Sign in</h2>
            <p className="muted mt-1.5 text-sm">
              Use your laboratory account to access the tool monitoring system.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            {errors.form && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm
                           font-medium text-red-700 dark:border-red-500/30 dark:bg-red-500/10
                           dark:text-red-300"
              >
                {errors.form}
              </div>
            )}

            <div>
              <label className="label" htmlFor="username">
                Username
              </label>
              <div className="relative">
                <User
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                  style={{ color: 'rgb(var(--text-subtle))' }}
                />
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck="false"
                  value={form.username}
                  onChange={setField('username')}
                  placeholder="e.g. instructor"
                  className={cx('input pl-9', errors.username && 'input-error')}
                  aria-invalid={!!errors.username}
                />
              </div>
              {errors.username && (
                <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                  {errors.username}
                </p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
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
                  className={cx('input px-9', errors.password && 'input-error')}
                  aria-invalid={!!errors.password}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center
                             rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/10"
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

            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={submitting}>
              {submitting ? <Spinner /> : <LogIn className="h-4 w-4" />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* ------------------------ demo accounts ------------------------ */}
          <div className="mt-8">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" style={{ color: 'rgb(var(--text-subtle))' }} />
              <span className="subtle text-[11px] font-bold uppercase tracking-wider">
                Demo accounts
              </span>
              <span className="h-px flex-1" style={{ background: 'rgb(var(--border))' }} />
            </div>

            <div className="space-y-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.username}
                  type="button"
                  onClick={() => useDemo(account)}
                  disabled={submitting}
                  className="card flex w-full items-center gap-3 p-3 text-left transition-all
                             hover:shadow-lift disabled:opacity-60"
                >
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[11px] font-extrabold"
                    style={{ background: 'rgb(var(--rail))', color: 'rgb(var(--accent))' }}
                  >
                    {account.role.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{account.label}</span>
                    <span className="subtle mono block truncate text-xs">
                      {account.username} / {account.password}
                    </span>
                  </span>
                  <span className="subtle shrink-0 text-[11px] font-bold uppercase">Use</span>
                </button>
              ))}
            </div>

            <p className="subtle mt-4 text-center text-xs leading-relaxed lg:text-left">
              All records are stored locally on this device. No internet connection is required
              after the first load.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
