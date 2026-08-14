import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ClipboardCheck,
  Eye,
  EyeOff,
  GraduationCap,
  Lock,
  Mail,
  QrCode,
  ShieldCheck,
  UserPlus,
  Wrench,
} from 'lucide-react'
import { AuthBrandLockup } from '../components/AuthBranding'
import { SelectField, Spinner, TextField } from '../components/ui'
import { useToast } from '../context/ToastContext'
import * as userService from '../services/users'
import { ValidationError } from '../services/tools'
import { ROLE, USER_STATUS } from '../utils/constants'
import { cx } from '../utils/helpers'

/**
 * Public registration.
 *
 * Deliberately the same two-panel layout as the login screen — same brand panel,
 * same form column, same field components — so the pair reads as one flow rather
 * than two designs.
 *
 * The role choice offers Student and Instructor only. That is a convenience, not
 * the safeguard: `users.signUp()` forces the role and derives the status, and the
 * The service layer pins what a self-created profile may contain, so a request
 * edited in the browser to ask for `Admin` is refused by the database.
 */

const HIGHLIGHTS = [
  { icon: QrCode, title: 'QR-tagged equipment', text: 'Every wrench, gauge and scan tool carries its own code.' },
  { icon: ClipboardCheck, title: 'Accountable borrowing', text: 'Know who holds each tool and when it is due back.' },
  { icon: Wrench, title: 'Service tracking', text: 'Calibration and maintenance history stays with the tool.' },
]

const ROLE_CHOICES = [
  {
    value: ROLE.STUDENT,
    icon: GraduationCap,
    title: 'Student',
    text: 'Borrow tools for laboratory activities and track your own history.',
    note: 'Active straight away.',
  },
  {
    value: ROLE.INSTRUCTOR,
    icon: ShieldCheck,
    title: 'Instructor',
    text: 'Issue and receive tools for students and oversee laboratory operations.',
    note: 'Full access to the tool crib.',
  },
]

/** The only programme this system serves. */
const PROGRAMMES = ['Automotive Technology']

const BLANK = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  confirmPassword: '',
  role: ROLE.STUDENT,
  studentId: '',
  employeeId: '',
  // Students pick from PROGRAMMES; an instructor types their own department, so
  // switching role clears it (see chooseRole).
  department: PROGRAMMES[0],
  contact: '',
}

export default function SignUpPage() {
  const toast = useToast()
  const navigate = useNavigate()

  const [form, setForm] = useState(BLANK)
  const [errors, setErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const isStudent = form.role === ROLE.STUDENT

  const setField = (field) => (event) => {
    const value = event?.target ? event.target.value : event
    setForm((f) => ({ ...f, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined, form: undefined }))
  }

  const chooseRole = (role) => {
    setForm((f) => ({
      ...f,
      role,
      // Keep the instructor's free-text department behaving as it always has:
      // it starts empty rather than pre-filled with the student programme.
      department: role === ROLE.STUDENT ? PROGRAMMES[0] : '',
    }))
    setErrors((e) => ({ ...e, role: undefined, studentId: undefined, employeeId: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setErrors({})

    try {
      const account = await userService.signUp(form)
      // Never leave credentials in component state.
      setForm((f) => ({ ...f, password: '', confirmPassword: '' }))

      const pending = account.status === USER_STATUS.PENDING
      toast.success('Account created successfully.', {
        title: pending ? 'Waiting for approval' : `Welcome, ${account.fullName.split(' ')[0]}`,
      })

      // Straight to the login screen: nothing is signed in yet, which is also
      // what keeps a pending instructor out until an administrator approves.
      navigate('/login', {
        replace: true,
        state: {
          email: account.email,
          notice: pending
            ? 'Account created successfully. Your instructor account is awaiting activation.'
            : 'Account created successfully. Sign in to continue.',
        },
      })
    } catch (err) {
      if (err instanceof ValidationError) {
        setErrors(err.errors)
        toast.error('Please correct the highlighted fields.')
      } else if (err?.field) {
        // Auth errors are mapped to plain sentences and a field upstream, so
        // "that email already has an account" lands on the email input.
        setErrors({ [err.field]: err.message })
      } else {
        // Anything else gets a plain message rather than a raw SDK error.
        setErrors({ form: err.message ?? 'Your account could not be created. Please try again.' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-[100dvh] overflow-x-hidden lg:grid-cols-[1.1fr_1fr]">
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
            Create your
            <span className="block text-amberline-400">laboratory account.</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-navy-300">
            One account for the whole tool room — scan, borrow, return, and see exactly what you are
            holding and when it is due.
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
      <section className="flex min-w-0 flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-md">

          <div className="mb-7 flex flex-col items-center text-center lg:items-start lg:text-left">
            <div className="w-full lg:hidden">
              <AuthBrandLockup />
            </div>
            <h2 className="mt-5 text-2xl font-extrabold tracking-tight lg:mt-0">Create account</h2>
            <p className="muted mt-1.5 text-sm">
              Register for access to the laboratory tool monitoring system.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-5" noValidate>
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

            {/* ----------------------- role ----------------------- */}
            <fieldset>
              <legend className="label mb-2">
                I am a <span className="text-red-500">*</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {ROLE_CHOICES.map(({ value, icon: Icon, title, text, note }) => {
                  const active = form.role === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => chooseRole(value)}
                      aria-pressed={active}
                      className={cx(
                        'flex flex-col gap-1.5 rounded-lg border-2 p-3 text-left transition-all',
                        active
                          ? 'border-amberline-500 bg-amberline-400/10'
                          : 'hover:bg-black/[0.03] dark:hover:bg-white/5',
                      )}
                      style={active ? undefined : { borderColor: 'rgb(var(--border))' }}
                    >
                      <Icon
                        className={cx(
                          'h-5 w-5',
                          active ? 'text-amberline-600 dark:text-amberline-400' : 'opacity-60',
                        )}
                      />
                      <span className="text-sm font-bold">{title}</span>
                      <span className="subtle text-xs leading-snug">{text}</span>
                      <span className="subtle text-[11px] font-bold uppercase tracking-wide">
                        {note}
                      </span>
                    </button>
                  )
                })}
              </div>
              {errors.role && (
                <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                  {errors.role}
                </p>
              )}
            </fieldset>

            {/* ----------------------- name ----------------------- */}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="First name"
                required
                value={form.firstName}
                onChange={setField('firstName')}
                error={errors.firstName}
                autoComplete="given-name"
                placeholder="Juan"
              />
              <TextField
                label="Last name"
                required
                value={form.lastName}
                onChange={setField('lastName')}
                error={errors.lastName}
                autoComplete="family-name"
                placeholder="Dela Cruz"
              />
            </div>

            {/* ----------------------- email ----------------------- */}
            <div>
              <label className="label" htmlFor="email">
                Email address <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                  style={{ color: 'rgb(var(--text-subtle))' }}
                />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck="false"
                  value={form.email}
                  onChange={setField('email')}
                  placeholder="name@autolab.edu.ph"
                  className={cx('input pl-9', errors.email && 'input-error')}
                  aria-invalid={!!errors.email}
                />
              </div>
              {errors.email ? (
                <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                  {errors.email}
                </p>
              ) : (
                <p className="subtle mt-1 text-xs">This is the address you will sign in with.</p>
              )}
            </div>

            {/* --------------------- role details --------------------- */}
            <div className="grid gap-4 sm:grid-cols-2">
              {isStudent ? (
                <TextField
                  label="Student ID"
                  required
                  value={form.studentId}
                  onChange={setField('studentId')}
                  error={errors.studentId}
                  placeholder="MCC-0000-0000"
                  className="mono"
                />
              ) : (
                <TextField
                  label="Employee ID"
                  required
                  value={form.employeeId}
                  onChange={setField('employeeId')}
                  error={errors.employeeId}
                  placeholder="INS-001"
                  className="mono"
                />
              )}
              {isStudent ? (
                // This system serves one programme, so the choice is fixed
                // rather than typed. It writes the same `department` field the
                // text input did, so nothing downstream changes.
                <SelectField
                  label="Programme"
                  required
                  value={form.department}
                  onChange={setField('department')}
                  error={errors.department}
                  options={PROGRAMMES}
                />
              ) : (
                <TextField
                  label="Department"
                  required
                  value={form.department}
                  onChange={setField('department')}
                  error={errors.department}
                  placeholder="Automotive Technology"
                />
              )}
            </div>

            <TextField
              label="Contact number"
              value={form.contact}
              onChange={setField('contact')}
              error={errors.contact}
              placeholder="0917 000 0000"
              hint="Optional — used by the tool room to reach you about a loan."
            />

            {/* --------------------- password --------------------- */}
            <div>
              <label className="label" htmlFor="password">
                Password <span className="text-red-500">*</span>
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
                  autoComplete="new-password"
                  value={form.password}
                  onChange={setField('password')}
                  placeholder="At least 8 characters"
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

            <TextField
              label="Confirm password"
              type="password"
              required
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={setField('confirmPassword')}
              error={errors.confirmPassword}
            />

            {/* Kept visible rather than buried: a pending instructor should not be
                surprised by a login they cannot use yet. */}
            {!isStudent && (
              <div
                className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
                style={{ background: 'rgb(var(--surface-2))' }}
              >
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 opacity-60" />
                <p className="subtle text-xs leading-relaxed">
                  Instructor accounts are active straight away — sign in as soon as you have
                  registered.
                </p>
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={submitting}>
              {submitting ? <Spinner /> : <UserPlus className="h-4 w-4" />}
              {submitting ? 'Creating account…' : 'Create account'}
            </button>

            <p className="subtle text-center text-xs leading-relaxed">
              Already have an account?{' '}
              <Link to="/login" className="font-bold text-amberline-700 hover:underline dark:text-amberline-400">
                Sign in
              </Link>
            </p>
          </form>
        </div>
      </section>
    </div>
  )
}
