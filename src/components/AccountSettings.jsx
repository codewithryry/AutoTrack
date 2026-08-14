import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Moon, Sun, Trash2 } from 'lucide-react'
import { Modal, Spinner } from './ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
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
  { value: 'light', label: 'Light mode', icon: Sun },
  { value: 'dark', label: 'Dark mode', icon: Moon },
]

/**
 * Dark / Light segmented control.
 *
 * The choice applies immediately and is stored in localStorage, so it survives
 * refreshes and PWA launches. A legacy "System" value (from before the control
 * was simplified) is shown as whichever mode the device prefers until the person
 * picks one of the two options outright.
 */
export function AppearanceControl({ className }) {
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

  return (
    <div
      role="radiogroup"
      aria-label="Interface theme"
      className={cx('grid grid-cols-2 gap-1 rounded-xl border p-1', className)}
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
              'flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all',
              active ? 'shadow-sm' : 'hover:bg-black/[0.03] dark:hover:bg-white/5',
            )}
            style={
              active
                ? { background: 'rgb(var(--surface))', color: 'rgb(var(--accent))' }
                : { color: 'rgb(var(--text-subtle))' }
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Self-service account deletion.
 *
 * Permanently removes the sign-in account and the profile row with it — there is
 * no undo, so the confirmation demands the account's email typed out first, and
 * the action stays visually separate from every ordinary setting.
 */
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
      <div
        className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3.5
                   dark:border-red-500/30 dark:bg-red-500/10"
      >
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