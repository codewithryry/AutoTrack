import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  Database,
  Download,
  FlaskConical,
  Monitor,
  Moon,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Sun,
  Trash2,
  Upload,
  UserCog,
} from 'lucide-react'
import {
  ConfirmDialog,
  DetailItem,
  PageHeader,
  RoleBadge,
  SectionCard,
  Spinner,
  TextField,
  Toggle,
} from '../components/ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import * as db from '../services/db'
import * as settingsService from '../services/settings'
import { seedDatabase } from '../data/seed'
import { PERM } from '../utils/permissions'
import { cx, downloadBlob, readFileAsText } from '../utils/helpers'
import { formatDateTime } from '../utils/dates'

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun, hint: 'Best for bright workshop lighting' },
  { value: 'dark', label: 'Dark', icon: Moon, hint: 'Easier on the eyes in the diagnostic bay' },
  { value: 'system', label: 'System', icon: Monitor, hint: 'Follow the device setting' },
]

export default function SettingsPage() {
  const { user, can, settings, saveSettings, logout } = useApp()
  const toast = useToast()
  const fileRef = useRef(null)

  const [form, setForm] = useState(settings)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [counts, setCounts] = useState(null)

  const canEdit = can(PERM.SETTINGS_EDIT)
  const canManageData = can(PERM.DATA_MANAGE)

  useEffect(() => setForm(settings), [settings])

  useEffect(() => {
    db.stats().then(setCounts)
  }, [settings])

  const setField = (field) => (value) => {
    setForm((f) => ({ ...f, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    const validation = settingsService.validate(form)
    if (Object.keys(validation).length) {
      setErrors(validation)
      toast.error('Please correct the highlighted fields.')
      return
    }
    setSaving(true)
    try {
      await saveSettings(form)
      toast.success('Settings saved.')
    } catch (err) {
      toast.error(err.message ?? 'Unable to save the settings.')
    } finally {
      setSaving(false)
    }
  }

  /** Theme applies immediately — waiting for Save would feel broken. */
  const changeTheme = async (theme) => {
    setForm((f) => ({ ...f, theme }))
    settingsService.applyTheme(theme)
    try {
      await saveSettings({ ...form, theme })
    } catch {
      toast.error('The theme could not be saved, but it is applied for this session.')
    }
  }

  /* --------------------------- data management --------------------------- */

  const exportDatabase = async () => {
    setBusy(true)
    try {
      const snapshot = await db.exportDatabase()
      downloadBlob(
        JSON.stringify(snapshot, null, 2),
        `smart-tool-monitoring-backup-${new Date().toISOString().slice(0, 10)}.json`,
        'application/json',
      )
      toast.success('Database exported.')
    } catch (err) {
      toast.error(err.message ?? 'Unable to export the database.')
    } finally {
      setBusy(false)
    }
  }

  const importDatabase = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // allow re-importing the same file
    if (!file) return

    setConfirm({
      title: 'Replace the local database?',
      message: `Importing "${file.name}" will replace every tool, user and transaction currently stored on this device.`,
      confirmLabel: 'Import and replace',
      onConfirm: async () => {
        setBusy(true)
        try {
          const text = await readFileAsText(file)
          const payload = JSON.parse(text)
          const summary = await db.importDatabase(payload)
          const total = Object.values(summary).reduce((a, b) => a + b, 0)
          toast.success(`${total} records imported.`, { title: 'Database restored' })
          setConfirm(null)
          setCounts(await db.stats())
        } catch (err) {
          toast.error(err.message ?? 'That backup file could not be read.')
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const reseed = () =>
    setConfirm({
      title: 'Reload the demo laboratory?',
      message:
        'Every existing tool, user, transaction and notification is replaced with a fresh set of demo records. This cannot be undone.',
      confirmLabel: 'Reload demo data',
      onConfirm: async () => {
        setBusy(true)
        try {
          const result = await seedDatabase()
          toast.success(
            `${result.tools} tools, ${result.users} users and ${result.transactions} transactions loaded.`,
            { title: 'Demo laboratory restored' },
          )
          setConfirm(null)
          setCounts(await db.stats())
        } catch (err) {
          toast.error(err.message ?? 'Unable to seed the demo data.')
        } finally {
          setBusy(false)
        }
      },
    })

  const clearDatabase = () =>
    setConfirm({
      title: 'Clear the entire database?',
      message:
        'All tools, users, transactions, notifications and maintenance records will be permanently deleted from this device. You will be signed out.',
      confirmLabel: 'Delete everything',
      onConfirm: async () => {
        setBusy(true)
        try {
          await db.clearAll()
          toast.warning('The local database was cleared.')
          setConfirm(null)
          logout()
        } catch (err) {
          toast.error(err.message ?? 'Unable to clear the database.')
        } finally {
          setBusy(false)
        }
      },
    })

  const resetApplication = () =>
    setConfirm({
      title: 'Reset the application?',
      message:
        'The database is cleared, settings return to their defaults and the demo laboratory is reloaded. The page will reload afterwards.',
      confirmLabel: 'Reset application',
      onConfirm: async () => {
        setBusy(true)
        try {
          await db.clearAll()
          await settingsService.reset()
          await seedDatabase()
          localStorage.removeItem('stms.session')
          toast.success('Application reset. Reloading…')
          setTimeout(() => window.location.reload(), 900)
        } catch (err) {
          toast.error(err.message ?? 'Unable to reset the application.')
          setBusy(false)
        }
      },
    })

  return (
    <>
      <PageHeader
        title="Settings"
        description="Laboratory configuration, notifications and local data management."
        icon={SettingsIcon}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* ---------------------------- laboratory ---------------------------- */}
          <form onSubmit={submit}>
            <SectionCard
              title="Laboratory"
              description="Shown across the app and on printed QR labels"
              action={
                canEdit ? (
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                    {saving ? <Spinner className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                    Save
                  </button>
                ) : null
              }
            >
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Laboratory name"
                    required
                    value={form.labName ?? ''}
                    onChange={(e) => setField('labName')(e.target.value)}
                    error={errors.labName}
                    disabled={!canEdit}
                  />
                  <TextField
                    label="Institution"
                    value={form.institution ?? ''}
                    onChange={(e) => setField('institution')(e.target.value)}
                    disabled={!canEdit}
                  />
                </div>
                <TextField
                  label="Laboratory location"
                  required
                  value={form.labLocation ?? ''}
                  onChange={(e) => setField('labLocation')(e.target.value)}
                  error={errors.labLocation}
                  disabled={!canEdit}
                />

                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField
                    label="Default borrowing days"
                    type="number"
                    min="1"
                    max="90"
                    value={form.defaultBorrowDays ?? 3}
                    onChange={(e) => setField('defaultBorrowDays')(e.target.value)}
                    error={errors.defaultBorrowDays}
                    disabled={!canEdit}
                    hint="Pre-fills the due date."
                  />
                  <TextField
                    label="Maximum borrowing days"
                    type="number"
                    min="1"
                    max="365"
                    value={form.maxBorrowDays ?? 30}
                    onChange={(e) => setField('maxBorrowDays')(e.target.value)}
                    error={errors.maxBorrowDays}
                    disabled={!canEdit}
                    hint="Hard limit on any loan."
                  />
                  <TextField
                    label="Maintenance interval (days)"
                    type="number"
                    min="7"
                    max="730"
                    value={form.maintenanceIntervalDays ?? 90}
                    onChange={(e) => setField('maintenanceIntervalDays')(e.target.value)}
                    error={errors.maintenanceIntervalDays}
                    disabled={!canEdit}
                    hint="Rolls the next service date."
                  />
                </div>
              </div>
            </SectionCard>
          </form>

          {/* --------------------------- notifications --------------------------- */}
          <SectionCard
            title="Notifications"
            description="Which alerts the laboratory system raises"
          >
            <TextField
              label="Warn when a tool is due within (days)"
              type="number"
              min="0"
              max="14"
              value={form.dueSoonThresholdDays ?? 1}
              onChange={(e) => setField('dueSoonThresholdDays')(e.target.value)}
              error={errors.dueSoonThresholdDays}
              disabled={!canEdit}
              className="mb-2 sm:w-64"
            />

            <div className="divide-y">
              <Toggle
                label="Overdue alerts"
                description="Raise a notification when a tool passes its due date."
                checked={form.notifyOverdue !== false}
                onChange={setField('notifyOverdue')}
                disabled={!canEdit}
              />
              <Toggle
                label="Due-soon reminders"
                description="Warn the borrower before the return deadline."
                checked={form.notifyDueSoon !== false}
                onChange={setField('notifyDueSoon')}
                disabled={!canEdit}
              />
              <Toggle
                label="Return confirmations"
                description="Record a notification each time a tool comes back."
                checked={form.notifyReturns !== false}
                onChange={setField('notifyReturns')}
                disabled={!canEdit}
              />
              <Toggle
                label="Maintenance alerts"
                description="Notify when equipment reaches its service date."
                checked={form.notifyMaintenance !== false}
                onChange={setField('notifyMaintenance')}
                disabled={!canEdit}
              />
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={submit}
                className="btn btn-primary mt-4 w-full sm:w-auto"
                disabled={saving}
              >
                {saving ? <Spinner /> : <Bell className="h-4 w-4" />}
                Save notification preferences
              </button>
            )}
          </SectionCard>

          {/* ------------------------------ theme ------------------------------ */}
          <SectionCard title="Appearance" description="How the interface renders on this device">
            <div className="grid gap-2 sm:grid-cols-3">
              {THEMES.map(({ value, label, icon: Icon, hint }) => {
                const active = (form.theme ?? 'light') === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => changeTheme(value)}
                    className={cx(
                      'flex flex-col items-start gap-1.5 rounded-lg border-2 p-3 text-left transition-all',
                      active
                        ? 'border-amberline-500 bg-amberline-400/10'
                        : 'hover:bg-black/[0.03] dark:hover:bg-white/5',
                    )}
                    style={active ? undefined : { borderColor: 'rgb(var(--border))' }}
                    aria-pressed={active}
                  >
                    <Icon
                      className={cx(
                        'h-5 w-5',
                        active ? 'text-amberline-600 dark:text-amberline-400' : 'opacity-60',
                      )}
                    />
                    <span className="text-sm font-bold">{label}</span>
                    <span className="subtle text-xs leading-snug">{hint}</span>
                  </button>
                )
              })}
            </div>
          </SectionCard>

          {/* --------------------------- data management --------------------------- */}
          {canManageData && (
            <SectionCard
              title="Data management"
              description="Everything is stored locally in this browser"
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <DataAction
                  icon={Download}
                  title="Export database"
                  description="Download a JSON backup of every collection."
                  onClick={exportDatabase}
                  disabled={busy}
                />
                <DataAction
                  icon={Upload}
                  title="Import database"
                  description="Restore records from a previous backup file."
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                />
                <DataAction
                  icon={FlaskConical}
                  title="Seed demo data"
                  description="Reload the sample automotive laboratory."
                  onClick={reseed}
                  disabled={busy}
                />
                <DataAction
                  icon={RotateCcw}
                  title="Reset application"
                  description="Clear everything, restore defaults and reseed."
                  onClick={resetApplication}
                  disabled={busy}
                />
                <DataAction
                  icon={Trash2}
                  title="Clear database"
                  description="Permanently delete every record on this device."
                  onClick={clearDatabase}
                  disabled={busy}
                  danger
                  className="sm:col-span-2"
                />
              </div>

              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                onChange={importDatabase}
                className="hidden"
              />
            </SectionCard>
          )}
        </div>

        {/* ------------------------------ side column ------------------------------ */}
        <div className="space-y-4">
          <SectionCard title="Your account" description="Signed in on this device">
            <div className="mb-3 flex items-center gap-3">
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-extrabold"
                style={{ background: 'rgb(var(--rail))', color: 'rgb(var(--accent))' }}
              >
                {user?.fullName?.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{user?.fullName}</p>
                <p className="subtle truncate text-xs">@{user?.username}</p>
              </div>
            </div>
            <dl className="space-y-3">
              <DetailItem label="Role">
                <RoleBadge role={user?.role} />
              </DetailItem>
              {user?.studentId && (
                <DetailItem label="Student ID" mono>
                  {user.studentId}
                </DetailItem>
              )}
              {user?.course && <DetailItem label="Course">{user.course}</DetailItem>}
              <DetailItem label="Email">{user?.email || '—'}</DetailItem>
            </dl>

            {can(PERM.USER_VIEW) && (
              <Link to="/users" className="btn btn-outline mt-4 w-full">
                <UserCog className="h-4 w-4" />
                Manage accounts
              </Link>
            )}
          </SectionCard>

          <SectionCard title="Local database" description="Records stored in this browser">
            <dl className="space-y-2.5">
              {counts
                ? Object.entries(counts).map(([name, count]) => (
                    <div key={name} className="flex items-center justify-between text-sm">
                      <span className="muted capitalize">
                        {name.replace(/([A-Z])/g, ' $1').toLowerCase()}
                      </span>
                      <span className="mono font-bold">{count}</span>
                    </div>
                  ))
                : Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="skeleton h-5" />
                  ))}
            </dl>

            <div
              className="mt-4 flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
              style={{ background: 'rgb(var(--surface-2))' }}
            >
              <Database className="mt-0.5 h-4 w-4 shrink-0 opacity-60" />
              <p className="subtle text-xs leading-relaxed">
                Records live in this browser's IndexedDB storage. They survive refreshes and
                restarts, and remain available with no internet connection. Clearing site data
                deletes them.
              </p>
            </div>

            {settings.updatedAt && (
              <p className="subtle mt-3 text-xs">
                Settings last saved {formatDateTime(settings.updatedAt)}
              </p>
            )}
          </SectionCard>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm?.onConfirm?.()}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        loading={busy}
      />
    </>
  )
}

function DataAction({ icon: Icon, title, description, onClick, disabled, danger, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors',
        'hover:bg-black/[0.03] disabled:opacity-50 dark:hover:bg-white/5',
        danger && 'border-red-300 dark:border-red-500/40',
        className,
      )}
    >
      <Icon
        className={cx(
          'mt-0.5 h-4 w-4 shrink-0',
          danger ? 'text-red-600 dark:text-red-400' : 'opacity-60',
        )}
      />
      <span className="min-w-0">
        <span
          className={cx(
            'block text-sm font-bold',
            danger && 'text-red-600 dark:text-red-400',
          )}
        >
          {title}
        </span>
        <span className="subtle block text-xs leading-snug">{description}</span>
      </span>
    </button>
  )
}
