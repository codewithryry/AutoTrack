import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, KeyRound, Moon, Sun, Trash2 } from 'lucide-react'
import { Modal, Spinner, TextField } from './ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import * as authService from '../services/auth'
import * as settingsService from '../services/settings'
import { cx } from '../utils/helpers'

/**
 * Account-level settings — appearance and the destructive end of the account.
 *
 * Both controls are per-device, not laboratory configuration, so they are shared
 * by the administrator Settings page and the account page that the avatar menu
 * opens for a student. The theme is the exception to the shared settings
 * document by design (see `services/settings.js`), and deleting an account is
 * nobody's business but the owner's.
 */

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

/**
 * Dark / Light segmented control.
 *
 * The choice applies immediately and is stored in localStorage, so it survives
 * refreshes and PWA launches. A legacy "System" value (from before the control
 * was simplified) is shown as whichever mode the device prefers until the person
 * picks one of the two options outright.
 */
function useThemeChoice() {
  const { settings, saveSettings } = useApp()
  const toast = useToast()

  const stored = settings.theme ?? 'dark'
  const current =
    stored === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : stored

  const select = async (theme) => {
    // Apply first — waiting for the write would feel broken.
    settingsService.applyTheme(theme)
    try {
      await saveSettings({ theme })
    } catch {
      toast.error('The theme could not be saved, but it is applied for this session.')
    }
  }

  return { current, select }
}

export function AppearanceControl({ className }) {
  const { current, select } = useThemeChoice()

  return (
    <div
      role="radiogroup"
      aria-label="Interface theme"
      className={cx('grid grid-cols-2 gap-1 rounded-lg border p-1', className)}
      style={{ background: 'rgb(var(--surface-2))' }}
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = current === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => select(value)}
            className={cx(
              'flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold transition-all',
              active
                ? 'shadow-sm ring-1 ring-amberline-400/40'
                : 'hover:bg-black/[0.03] dark:hover:bg-white/5',
            )}
            style={
              active
                ? { background: 'rgb(var(--surface))', color: 'rgb(var(--accent))' }
                : { color: 'rgb(var(--text-subtle))' }
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The same choice as one icon — for the header bar, where there is room for a
 * single control. It shows the mode it switches to and uses the same hook, so
 * there is no second piece of theme logic anywhere.
 */
export function AppearanceToggleButton({ className }) {
  const { current, select } = useThemeChoice()
  const next = current === 'dark' ? 'light' : 'dark'
  const Icon = next === 'dark' ? Moon : Sun

  return (
    <button
      type="button"
      onClick={() => select(next)}
      className={cx(
        'grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors',
        'hover:bg-black/5 dark:hover:bg-white/5',
        className,
      )}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <Icon className="h-5 w-5" />
    </button>
  )
}

/**
 * Self-service account deletion.
 *
 * Permanently removes the sign-in account and the profile row with it — there is
 * no undo, so the confirmation demands the account's email typed out first, and
 * the action stays visually separate from every ordinary setting.
 */
/**
 * Change your own password, without leaving the app.
 *
 * Until now the only route was the reset email, which meant signing out and
 * waiting for a message to arrive — a long way round for somebody who simply
 * wants a new password. That flow is untouched and still the way in when the
 * current password has been forgotten; this is for when it has not.
 *
 * The current password is required and verified (see
 * `services/localAuth.changePassword`), so an unattended unlocked phone is not
 * enough to take an account over. Nothing here keeps a password after submit:
 * the fields are cleared on close and on success.
 */
export function ChangePasswordControl({ className }) {
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [errors, setErrors] = useState({})

  const set = (field) => (event) => {
    const { value } = event.target
    setForm((f) => ({ ...f, [field]: value }))
    // Clearing as they type, so an error never outlives the thing it described.
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const close = () => {
    setOpen(false)
    setBusy(false)
    setForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    setErrors({})
  }

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return

    // The one rule the service cannot check for us: it never sees the
    // confirmation field.
    if (form.newPassword !== form.confirmPassword) {
      setErrors({ confirmPassword: 'The two passwords do not match.' })
      return
    }

    setBusy(true)
    try {
      await authService.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      })
      toast.success('Your password has been changed.', { title: 'Password updated' })
      close()
    } catch (err) {
      // `AuthError` carries the field it belongs to, so the message lands under
      // the input that caused it rather than in a toast away from the form.
      if (err?.field) setErrors({ [err.field]: err.message })
      else toast.error(err?.message ?? 'Your password could not be changed.')
      setBusy(false)
    }
  }

  return (
    <div className={className}>
      {/* Straight in the card it sits in — no second box inside it. */}
      <div className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
          style={{ background: 'rgb(var(--surface-3))' }}
        >
          <KeyRound className="h-4 w-4" style={{ color: 'rgb(var(--text-subtle))' }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Password</p>
          <p className="subtle mt-0.5 text-xs leading-snug">
            Change the password you sign in with. You will need your current one.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn btn-outline btn-sm shrink-0"
        >
          Change
        </button>
      </div>

      <Modal
        open={open}
        onClose={close}
        title="Change password"
        description="Enter your current password, then the new one twice."
      >
        <form onSubmit={submit} className="space-y-3">
          <TextField
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={set('currentPassword')}
            error={errors.currentPassword}
            required
          />
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            value={form.newPassword}
            onChange={set('newPassword')}
            error={errors.newPassword}
            hint={`At least ${authService.MIN_PASSWORD_LENGTH} characters.`}
            required
          />
          <TextField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={set('confirmPassword')}
            error={errors.confirmPassword}
            required
          />

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={close} className="btn btn-ghost" disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy && <Spinner />}
              Change password
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

export function DeleteAccountControl({ className }) {
  const { user, deleteOwnAccount } = useApp()
  const toast = useToast()
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [typed, setTyped] = useState('')

  const required = String(user?.email ?? '').trim().toLowerCase()
  const confirmed = required !== '' && typed.trim().toLowerCase() === required

  const close = () => {
    setOpen(false)
    setTyped('')
  }

  const handleDelete = async () => {
    if (!confirmed || busy) return
    setBusy(true)
    try {
      await deleteOwnAccount()
      toast.success('Your account and profile have been permanently removed.', {
        title: 'Account deleted',
      })
      navigate('/login', { replace: true })
    } catch (err) {
      setBusy(false)
      toast.error(err.message ?? 'Your account could not be deleted.')
    }
  }

  return (
    <div className={className}>
      {/* Straight in the card it sits in — the red icon and title carry the
          warning without a second, tinted box inside it. */}
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-500/10">
          <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-red-700 dark:text-red-300">Delete account</p>
          <p className="mt-0.5 text-xs leading-snug text-red-700/80 dark:text-red-300/80">
            Permanently removes your profile and sign-in credentials. Your past borrowing
            records stay in the laboratory history.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn btn-outline btn-sm shrink-0 border-red-300 text-red-700 hover:bg-red-100
                     dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>

      <Modal
        open={open}
        onClose={busy ? undefined : close}
        title="Delete your account?"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={close} disabled={busy}>
              Keep account
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={!confirmed || busy}
            >
              {busy ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
              Permanently delete
            </button>
          </>
        }
      >
        <div className="flex gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-500/10">
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold">This cannot be undone.</p>
            <p className="muted mt-1 text-sm leading-relaxed">
              Your profile and sign-in credentials are removed permanently. You will no longer
              be able to sign in, and the email address can be registered again.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <label className="label" htmlFor="delete-account-confirm">
            Type <span className="mono font-bold normal-case">{user?.email}</span> to confirm
          </label>
          <input
            id="delete-account-confirm"
            className="input"
            type="text"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={user?.email}
            disabled={busy}
          />
        </div>
      </Modal>
    </div>
  )
}