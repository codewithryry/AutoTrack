import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  ChevronDown,
  Database,
  Download,
  FlaskConical,
  RotateCcw,
  Save,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react'
import { DeviceAccessControl, InstallAppCard } from '../components/DeviceAccess'
import { resetTours } from '../components/Walkthrough'
import {
  ConfirmDialog,
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
import { cx, downloadBlob, downloadCSV, readFileAsText } from '../utils/helpers'
import { formatDateTime } from '../utils/dates'
import { TOOLS_CSV_COLUMNS } from './ToolsPage'
import { TRANSACTIONS_CSV_COLUMNS } from './TransactionsPage'
import { USERS_CSV_COLUMNS } from './UsersPage'
import { UTILIZATION_CSV_COLUMNS } from './ReportsPage'
import * as reportService from '../services/reports'

export default function SettingsPage() {
  const { user, can, settings, saveSettings, offlineMode, setOfflineMode } = useApp()
  // Which category is expanded, if any. Collapsed is the resting state.
  // `undefined` is "not chosen yet", which is what lets a role with a single
  // category — a student's and an instructor's Device and app — open on it
  // instead of on a closed row with nothing beside it. Collapsing it still
  // works: that stores `null`.
  const [open, setOpen] = useState(undefined)
  const toast = useToast()
  const navigate = useNavigate()
  const fileRef = useRef(null)

  const [form, setForm] = useState(settings)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [counts, setCounts] = useState(null)

  const canEdit = can(PERM.SETTINGS_EDIT)
  const canManageData = can(PERM.DATA_MANAGE)
  // Everyone reaches this page for their own preferences; the laboratory
  // configuration below is still staff-only.
  const canViewLab = can(PERM.SETTINGS_VIEW)

  /** Clears the walkthrough state for this account and starts the tour again. */
  const restartTours = () => {
    resetTours(user?.id)
    toast.success('The walkthrough will start again from the dashboard.')
    navigate('/dashboard')
  }

  useEffect(() => setForm(settings), [settings])

  useEffect(() => {
    // Only the data group reads these counts, so only its audience fetches them.
    if (!canManageData) return
    db.stats().then(setCounts)
  }, [settings, canManageData])

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

  /**
   * The CSV downloads that used to sit in the Tools and Transactions headers.
   * Same columns and the same `downloadCSV` helper — only the whole collection
   * rather than the page's current filter.
   */
  const downloadCollectionCSV = async (collection, columns, label) => {
    setBusy(true)
    try {
      const rows = await db.list(collection)
      downloadCSV(rows, columns, `${collection}-${new Date().toISOString().slice(0, 10)}.csv`)
      toast.success(`${rows.length} ${label} exported to CSV.`)
    } catch (err) {
      toast.error(err.message ?? `Unable to export the ${label}.`)
    } finally {
      setBusy(false)
    }
  }

  /** The tool-utilisation export that used to sit in the Reports header. */
  const downloadUtilizationCSV = async () => {
    setBusy(true)
    try {
      const rows = await reportService.toolUtilization()
      downloadCSV(
        rows,
        UTILIZATION_CSV_COLUMNS,
        `tool-utilisation-${new Date().toISOString().slice(0, 10)}.csv`,
      )
      toast.success('Tool utilisation exported to CSV.')
    } catch (err) {
      toast.error(err.message ?? 'Unable to export the tool utilisation.')
    } finally {
      setBusy(false)
    }
  }

  const importDatabase = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // allow re-importing the same file
    if (!file) return

    setConfirm({
      title: 'Replace the laboratory records?',
      message:
        `Importing "${file.name}" replaces every tool, transaction, maintenance record and ` +
        `notification — for every user, not just this device. User profiles are ` +
        `skipped: accounts are managed from the Users page.`,
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
      title: 'Load the demo laboratory?',
      message:
        'The tool inventory, transactions, maintenance records and notifications are ' +
        'replaced with a fresh demo set. User accounts are left completely untouched. This cannot ' +
        'be undone.',
      confirmLabel: 'Load demo data',
      onConfirm: async () => {
        setBusy(true)
        try {
          const result = await seedDatabase(user)
          toast.success(
            `${result.tools} tools, ${result.transactions} transactions and ${result.maintenance} maintenance records loaded.`,
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
      title: 'Clear the laboratory records?',
      message:
        'Every tool, loan, request, hold, message, conversation, maintenance record, alert and ' +
        'activity entry is permanently deleted, for every user, along with the laboratory ' +
        'settings. Accounts and their profile pictures are not touched. This cannot be undone.',
      confirmLabel: 'Delete everything',
      confirmPhrase: 'DELETE',
      onConfirm: async () => {
        setBusy(true)
        try {
          await db.clearAll()
          toast.warning('The laboratory records were cleared.')
          setConfirm(null)
          setCounts(await db.stats())
        } catch (err) {
          toast.error(err.message ?? 'Unable to clear the records.')
        } finally {
          setBusy(false)
        }
      },
    })

  const resetApplication = () =>
    setConfirm({
      title: 'Reset the application?',
      message:
        'Every stored record is cleared — tools, loans, requests, holds, messages, maintenance, ' +
        'alerts and the activity log — settings return to their defaults and the demo data is ' +
        'reloaded. Accounts and their profile pictures are not affected. The page will reload ' +
        'afterwards, and this cannot be undone.',
      confirmLabel: 'Reset application',
      confirmPhrase: 'RESET',
      onConfirm: async () => {
        setBusy(true)
        try {
          await db.clearAll()
          await settingsService.reset(user)
          await seedDatabase(user)
          toast.success('Application reset. Reloading…')
          setTimeout(() => window.location.reload(), 900)
        } catch (err) {
          toast.error(err.message ?? 'Unable to reset the application.')
          setBusy(false)
        }
      },
    })

  /* ------------------------------- categories -------------------------------
     One entry per category: the card on the index and the focused view behind
     it come from the same definition, so a category can never appear in the
     list without a page or be reachable without its permission. */

  const deviceSection = (
    <>
      <SectionCard title="Permissions" description="Camera and location access">
        <DeviceAccessControl />
      </SectionCard>

      <InstallAppCard />

      <SectionCard title="Offline mode" description="Working without a connection">
        <Toggle
          label={offlineMode ? 'Offline mode is on' : 'Offline mode is off'}
          description="Work from the records already on this device. Turn it off to sync with the laboratory again."
          checked={offlineMode}
          onChange={setOfflineMode}
        />
      </SectionCard>

      <SectionCard title="Guided walkthroughs" description="The one-time tour of each page">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p className="subtle min-w-0 text-xs leading-snug">
            Each page explains itself once. Start the walkthrough again from the dashboard.
          </p>
          <button
            type="button"
            onClick={restartTours}
            className="btn btn-outline w-full shrink-0 sm:w-auto"
          >
            <RotateCcw className="h-4 w-4" />
            Show tours again
          </button>
        </div>
      </SectionCard>
    </>
  )

  const laboratorySection = (
    <form onSubmit={submit}>
      <SectionCard
        title="Organization"
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

          {settings.updatedAt && (
            <p className="subtle text-xs">
              Settings last saved {formatDateTime(settings.updatedAt)}
            </p>
          )}
        </div>
      </SectionCard>

      {/* The department's own page — a department site or a Facebook page. Two
          fields and nothing else: what to call it, and where it goes. Saved by
          the same button as the card above, through the same patch. */}
      <SectionCard
        title="Connect"
        description="Shown to students on their account page"
        className="mt-4"
      >
        <div className="space-y-4">
          <TextField
            label="Page name"
            value={form.departmentName ?? ''}
            onChange={(e) => setField('departmentName')(e.target.value)}
            error={errors.departmentName}
            disabled={!canEdit}
            hint="Optional. What the link is called. Without one the address itself is shown."
          />
          <TextField
            label="URL"
            value={form.departmentUrl ?? ''}
            onChange={(e) => setField('departmentUrl')(e.target.value)}
            error={errors.departmentUrl}
            disabled={!canEdit}
            hint="Optional. Leave it empty to hide the link entirely."
          />
        </div>
      </SectionCard>
    </form>
  )

  const notificationsSection = (
    <SectionCard title="System alerts" description="Which alerts the laboratory system raises">
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
  )

  const dataSection = (
    <>
      <SectionCard title="Exports" description="Download the laboratory records">
        <div className="grid gap-2 sm:grid-cols-2">
          <DataAction
            icon={Download}
            title="Export database"
            description="Download a JSON backup of every collection."
            onClick={exportDatabase}
            disabled={busy}
          />
          <DataAction
            icon={Download}
            title="Download tools CSV"
            description="Export every tool record as a spreadsheet."
            onClick={() => downloadCollectionCSV(db.COLLECTIONS.tools, TOOLS_CSV_COLUMNS, 'tools')}
            disabled={busy}
          />
          <DataAction
            icon={Download}
            title="Download transactions CSV"
            description="Export every borrowing record as a spreadsheet."
            onClick={() =>
              downloadCollectionCSV(
                db.COLLECTIONS.transactions,
                TRANSACTIONS_CSV_COLUMNS,
                'transactions',
              )
            }
            disabled={busy}
          />
          <DataAction
            icon={Download}
            title="Download users CSV"
            description="Export every account record as a spreadsheet."
            onClick={() => downloadCollectionCSV(db.COLLECTIONS.users, USERS_CSV_COLUMNS, 'users')}
            disabled={busy}
          />
          <DataAction
            icon={Download}
            title="Download utilisation CSV"
            description="Export how often each tool is borrowed."
            onClick={downloadUtilizationCSV}
            disabled={busy}
            className="sm:col-span-2"
          />
        </div>
      </SectionCard>

      <SectionCard title="Restore and reset" description="These actions affect all stored records">
        <div className="grid gap-2 sm:grid-cols-2">
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
            // The scope stated up front, because it is not this device: the
            // records go for the whole laboratory, which is what the
            // confirmation has always said and what `db.clearAll()` does.
            description="Permanently delete every laboratory record, for every user."
            onClick={clearDatabase}
            disabled={busy}
            danger
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

      <SectionCard title="Stored collections" description="Records in the laboratory database">
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
            : Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-5" />)}
        </dl>

        <div
          className="mt-4 flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
          style={{ background: 'rgb(var(--surface-2))' }}
        >
          <Database className="mt-0.5 h-4 w-4 shrink-0 opacity-60" />
          <p className="subtle text-xs leading-relaxed">
            These are the laboratory's records, counted as this account may read them. A local cache
            keeps them readable offline, and changes made without a connection sync as soon as one
            returns. Access is scoped by the data layer, not by this interface alone.
          </p>
        </div>
      </SectionCard>
    </>
  )

  const categories = [
    {
      slug: 'device',
      icon: Smartphone,
      title: 'Device and app',
      description: 'Camera and location access, installation, offline mode and the walkthroughs.',
      content: deviceSection,
    },
    canViewLab && {
      slug: 'laboratory',
      icon: FlaskConical,
      title: 'Laboratory',
      description: 'The laboratory record, the department link and the borrowing limits.',
      content: laboratorySection,
    },
    canViewLab && {
      slug: 'notifications',
      icon: Bell,
      title: 'Notifications',
      description: 'Which alerts the system raises, and how early it warns.',
      content: notificationsSection,
    },
    canManageData && {
      slug: 'data',
      icon: Database,
      title: 'Data management',
      description: 'Exports, backups, demo data and the stored collections.',
      content: dataSection,
    },
  ].filter(Boolean)

  // The page opens on its first category — Device and app for every role — so
  // its controls are readable straight away rather than behind a row that looks
  // inert until it is clicked. Collapsing it still works: that stores `null`.
  const openSlug = open === undefined ? (categories[0]?.slug ?? null) : open

  return (
    <>
      {/* Each category is a collapsible section rather than a page of its own:
          the list stays short, and only the one being worked on is open. */}
      <div className="mx-auto max-w-3xl space-y-2.5">
        {categories.map(({ slug, icon: Icon, title, description, content }) => (
          <CategorySection
            key={slug}
            icon={Icon}
            title={title}
            description={description}
            open={openSlug === slug}
            onToggle={() => setOpen((cur) => ((cur ?? openSlug) === slug ? null : slug))}
          >
            {content}
          </CategorySection>
        ))}

      </div>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm?.onConfirm?.()}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        confirmPhrase={confirm?.confirmPhrase}
        loading={busy}
      />
    </>
  )
}

function SectionIcon({ icon: Icon }) {
  return (
    <span
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
      style={{ background: 'rgb(var(--surface-3))' }}
    >
      <Icon className="h-4 w-4" style={{ color: 'rgb(var(--text-subtle))' }} />
    </span>
  )
}

/** One collapsible settings category. */
function CategorySection({ icon, title, description, open, onToggle, children }) {
  return (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="card flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors
                   hover:bg-black/[0.03] dark:hover:bg-white/5"
      >
        <SectionIcon icon={icon} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{title}</span>
          <span className="subtle block text-xs leading-snug">{description}</span>
        </span>
        <ChevronDown
          className={cx('mt-1.5 h-4 w-4 shrink-0 opacity-40 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && <div className="space-y-4 pb-1">{children}</div>}
    </div>
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
