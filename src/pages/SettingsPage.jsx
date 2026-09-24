import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  Database,
  Download,
  ExternalLink,
  FlaskConical,
  Github,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react'
import { DeviceAccessControl } from '../components/DeviceAccess'
import { resetTours } from '../components/Walkthrough'
import {
  ConfirmDialog,
  InsetSections,
  SectionCard,
  Spinner,
  TextField,
  Toggle,
} from '../components/ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useMediaQuery } from '../hooks'
import * as db from '../services/db'
import { getLatestRelease, RELEASES_PAGE } from '../services/releases'
import * as settingsService from '../services/settings'
import { seedDatabase } from '../data/seed'
import { PERM } from '../utils/permissions'
import { cx, downloadBlob, downloadCSV, readFileAsText } from '../utils/helpers'
import { APP_NAME, APP_VERSION } from '../utils/constants'
import { externalLinkProps } from '../utils/native'
import { formatDateTime } from '../utils/dates'
import { compareVersions } from '../utils/version'
import { TOOLS_CSV_COLUMNS } from './ToolsPage'
import { TRANSACTIONS_CSV_COLUMNS } from './TransactionsPage'
import { USERS_CSV_COLUMNS } from './UsersPage'
import { UTILIZATION_CSV_COLUMNS } from './ReportsPage'
import * as reportService from '../services/reports'

export default function SettingsPage() {
  const { user, can, settings, saveSettings, offlineMode, setOfflineMode } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const fileRef = useRef(null)
  const location = useLocation()

  // Two-column desktop layout, stacked groups on smaller screens. The content
  // is the same set of sections either way; only the frame around it changes.
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  // Below 768px only: every group collapses into a single-open accordion so
  // the page is not one long scroll of every card at once. Tablet widths keep
  // the existing stacked-flat layout untouched.
  const isMobile = useMediaQuery('(max-width: 768px)')
  const [openAccordion, setOpenAccordion] = useState('device')

  const [form, setForm] = useState(settings)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [counts, setCounts] = useState(null)

  // Where the release check sits: idle until the button is pressed, then one of
  // checking, uptodate, available or error. The result is page-local so it can
  // never collide with another account's or a later version's settings.
  const [updateState, setUpdateState] = useState('idle')
  const [latestRelease, setLatestRelease] = useState(null)

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

  /**
   * Asks GitHub for the latest published release and compares it against the
   * installed version. One check at a time (the button is disabled while it
   * runs), and every press is a fresh request — there is no cache to go stale.
   * Failing is not a crash path: the outcome is just the 'error' state, which
   * the section below shows as its own message.
   */
  const checkForUpdates = async () => {
    if (updateState === 'checking') return
    setUpdateState('checking')
    try {
      const release = await getLatestRelease()
      setLatestRelease(release)
      setUpdateState(compareVersions(release.version, APP_VERSION) > 0 ? 'available' : 'uptodate')
    } catch {
      setUpdateState('error')
    }
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

/* --------------------------------- groups ---------------------------------
     One section per group, arranged by audience so each role sees only its own:
     every role gets Device & access and About app; staff adds the Laboratory
     and Notifications groups; the administrator alone gets the Data management
     group. The desktop sidebar and the mobile group list come from the same
     array, so a group can never be reachable without its permission. */

  const deviceSection = (
    <>
      <SectionCard title="Permissions" description="Camera and location access">
        <DeviceAccessControl />
      </SectionCard>

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

  /* The theme choice already lives in the header bar (the AppearanceToggleButton
     on this page), so there is no separate Appearance group here. */

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

  /* --------------------------------- app -----------------------------------
     The last group, and the only one every role sees alongside Device and
     Appearance: what this application is and the two links out. `APP_NAME` and
     `APP_VERSION` are read from `utils/constants` rather than written here, so
     the version shown can never drift from the one the verification suite
     checks against package.json. */

  const appSection = (
    <>
      {/* The app opens its own group as a plain row — its mark, its name and
          what it is — not a titled card inside the group. */}
      <SectionCard>
        <div className="flex items-center gap-3">
          <img src="/Logoapp.png" alt="" className="h-12 w-12 shrink-0 rounded-2xl object-contain" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-extrabold">{APP_NAME}</p>
            <p className="subtle mt-0.5 text-xs leading-snug">
              QR-Based Automotive Laboratory Tool Monitoring System
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Links" description="The source code and the developer">
        <div className="-mx-1 flex flex-col">
          <AboutLink
            icon={Github}
            label="View repository"
            hint="github.com/codewithryry/AutoTrack"
            href="https://github.com/codewithryry/AutoTrack"
          />
          <AboutLink
            icon={Github}
            label="GitHub"
            hint="github.com/codewithryry"
            href="https://github.com/codewithryry"
          />
        </div>
      </SectionCard>

      {/* The update check is a live question rather than a link, so it gets its
          own card: it needs a space for the outcome to speak its own sentence.
          Everything it reports — loaded version, latest version, the GitHub
          page — reads from the same helpers the rest of the app uses, and every
          failure is a message here rather than a broken page. */}
      <SectionCard
        title="App updates"
        description="Check whether a newer release is available"
      >
        <div className="space-y-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold">Current version</p>
              {/* The version reads as data rather than prose, matching the
                  record identifiers everywhere else in the app. */}
              <p className="subtle mt-0.5 font-mono text-xs">v{APP_VERSION}</p>
            </div>
            {updateState === 'available' ? (
              <a
                href={latestRelease?.htmlUrl ?? RELEASES_PAGE}
                target="_blank"
                rel="noreferrer noopener"
                {...externalLinkProps(latestRelease?.htmlUrl ?? RELEASES_PAGE)}
                className="btn btn-primary btn-sm shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                View update
              </a>
            ) : (
              <button
                type="button"
                onClick={checkForUpdates}
                disabled={updateState === 'checking'}
                className="btn btn-outline btn-sm shrink-0"
              >
                {updateState === 'checking' ? (
                  <>
                    <Spinner /> Checking…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" />
                    {updateState === 'error' ? 'Try again' : 'Check for updates'}
                  </>
                )}
              </button>
            )}
          </div>

          {/* `aria-live` lets a screen reader announce the outcome without the
              focus having to move, while the coloured frames below speak the
              same message to sighted users. */}
          <div aria-live="polite">
            {updateState === 'uptodate' && (
              <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold">You're up to date</p>
                  <p className="mt-0.5 text-xs leading-snug opacity-80">
                    You're using the latest version.
                  </p>
                </div>
              </div>
            )}
            {updateState === 'available' && (
              <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-sm text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
                <Download className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold">Update available</p>
                  <p className="mt-0.5 text-xs leading-snug opacity-80">
                    Version v{latestRelease?.version} is available.
                  </p>
                </div>
              </div>
            )}
            {updateState === 'error' && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold">Unable to check for updates</p>
                  <p className="mt-0.5 text-xs leading-snug opacity-80">
                    Please try again later.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </SectionCard>
    </>
  )

  const sections = [
    {
      slug: 'device',
      label: 'Device & access',
      content: deviceSection,
    },
    canViewLab && {
      slug: 'laboratory',
      label: 'Laboratory',
      content: laboratorySection,
    },
    canViewLab && {
      slug: 'notifications',
      label: 'Notifications',
      content: notificationsSection,
    },
    canManageData && {
      slug: 'data',
      label: 'Data management',
      content: dataSection,
    },
    // Last, and open to every role: what this app is, its version and the
    // project links.
    {
      slug: 'about',
      label: 'About app',
      content: appSection,
    },
  ].filter(Boolean)

  // On desktop the hash picks the visible section; a stale or missing hash
  // falls back to the first one for this role, and the About app group can
  // never be the resting view.
  const requested = location.hash.replace(/^#/, '')
  const activeSlug = sections.some((s) => s.slug === requested)
    ? requested
    : (sections[0]?.slug ?? null)

  return (
    <>
      <div className="w-full max-w-5xl gap-10 lg:grid lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* Desktop sidebar: a clean index of the groups this role can open,
            without icons or cards. The page takes its own labels from the same
            array, so the two can never disagree. */}
        <nav
          aria-label="Settings sections"
          className="hidden lg:sticky lg:top-[4.75rem] lg:block lg:self-start"
        >
          <ul className="space-y-1">
            {sections.map(({ slug, label }) => {
              const isActive = activeSlug === slug
              return (
                <li key={slug}>
                  <a
                    href={`#${slug}`}
                    aria-current={isActive ? 'page' : undefined}
                    className={cx(
                      'relative flex min-h-[40px] items-center rounded-lg px-3 text-sm transition-colors',
                      'hover:bg-black/[0.03] dark:hover:bg-white/5',
                      isActive ? 'font-bold' : 'muted font-semibold',
                    )}
                    style={isActive ? { background: 'rgb(var(--surface-2))' } : undefined}
                  >
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full"
                        style={{ background: 'rgb(var(--accent))' }}
                      />
                    )}
                    <span className="min-w-0">{label}</span>
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Content. On desktop one group is shown at a time; on a phone every
            group collapses into a single-open accordion; in between (tablet)
            every group is stacked flat under its small-cap label. */}
        <div className="mx-auto w-full max-w-2xl pb-2 lg:mx-0 lg:max-w-none lg:pb-0">
          {isDesktop ? (
            <div className="space-y-4">
              {sections
                .filter((s) => s.slug === activeSlug)
                .map((s) => (
                  <SettingsGroup key={s.slug} label={s.label}>
                    {s.content}
                  </SettingsGroup>
                ))}
            </div>
          ) : isMobile ? (
            <div className="space-y-3">
              {sections.map((s) => (
                <SettingsAccordion
                  key={s.slug}
                  label={s.label}
                  open={openAccordion === s.slug}
                  onToggle={() =>
                    setOpenAccordion((current) => (current === s.slug ? null : s.slug))
                  }
                >
                  {s.content}
                </SettingsAccordion>
              ))}
            </div>
          ) : (
            <div className="space-y-7">
              {sections.map((s) => (
                <SettingsGroup key={s.slug} label={s.label}>
                  {s.content}
                </SettingsGroup>
              ))}
            </div>
          )}
        </div>
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

/**
 * One headed settings group.
 *
 * On desktop the group is named by the sidebar link beside the cards, so a
 * duplicate heading in the content pane would only repeat it — the pane shows
 * the cards alone. On smaller screens there is no sidebar, so the same label
 * is rendered as the small-caps group heading above its cards instead.
 */
function SettingsGroup({ label, children }) {
  return (
    <section className="space-y-4">
      <p className="px-4 text-[11px] font-bold uppercase tracking-[0.16em] text-subtle lg:hidden">
        {label}
      </p>
      {children}
    </section>
  )
}

/**
 * One collapsible settings group, phone-only.
 *
 * Only one is ever open at a time — the page passes `open` and `onToggle`
 * rather than this component keeping its own state, so `SettingsPage` is the
 * single source of which group is expanded. The grid-rows trick animates
 * height without measuring the content: `0fr` collapses it, `1fr` reveals it,
 * and the transition is on the track size rather than `height`, which is what
 * lets a variable-height card (Data management, say) animate smoothly too.
 */
function SettingsAccordion({ label, open, onToggle, children }) {
  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        <span className="text-sm font-bold">{label}</span>
        <ChevronDown
          className={cx(
            'h-4 w-4 shrink-0 subtle transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {/* The group is the card; its sections sit straight in it, one rule
              between each, rather than as cards of their own. */}
          <div className="divide-y border-t px-4 pb-4 pt-4">
            <InsetSections>{children}</InsetSections>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * One row in the App section's list of links.
 *
 * Built to the same measurements as the outward link on the profile page — 44px
 * minimum touch target, the same recessed icon tile, the same trailing
 * external-link mark — so the two read as one pattern rather than two.
 *
 * `externalLinkProps` is what makes these work in the APK. A `target="_blank"`
 * anchor does nothing at all inside the Android WebView; that helper hands the
 * URL to an in-app browser tab instead, which the system back gesture closes
 * again. In a browser it adds nothing and the anchor behaves normally.
 */
function AboutLink({ icon: Icon, label, hint, href }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      {...externalLinkProps(href)}
      className="flex min-h-[44px] items-center gap-3 rounded-xl px-2 py-1.5 text-left
                 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
        style={{ background: 'rgb(var(--surface-3))' }}
      >
        <Icon className="h-4 w-4" style={{ color: 'rgb(var(--text-subtle))' }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="subtle block truncate text-xs">{hint}</span>
      </span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-50" />
    </a>
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