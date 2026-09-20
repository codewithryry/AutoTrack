import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  HardHat,
  MapPin,
  RotateCcw,
  ShieldAlert,
  Trash2,
  PackageSearch,
} from 'lucide-react'
import {
  ConditionBadge,
  ConfirmDialog,
  DetailItem,
  EmptyState,
  MaintenanceStatusBadge,
  SectionCard,
  SelectField,
  Skeleton,
  Spinner,
  StatusBadge,
  TextAreaField,
} from '../components/ui'
import Walkthrough, { usePageTour } from '../components/Walkthrough'
import { QRCodePanel } from '../components/QRCodeDisplay'
import TransactionTable from '../components/TransactionTable'
import TransactionDetail from '../components/TransactionDetail'
import ToolForm from '../components/ToolForm'
import ReportProblemDialog from '../components/ReportProblemDialog'
import ToolImage from '../components/ToolImage'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useMediaQuery, useTool, useToolMaintenance, useToolTransactions } from '../hooks'
import * as maintenanceService from '../services/maintenance'
import * as toolService from '../services/tools'
import * as txnService from '../services/transactions'
import { AutoLocationNotice, LocationTrail, useAutoLocation } from '../components/LocationCapture'
import { canReturnTransaction, isStaff, isStudent, PERM } from '../utils/permissions'
import { MAINTENANCE_TYPES, TOOL_STATUS, SERIAL_CRITICAL_CATEGORIES } from '../utils/constants'
import { cx } from '../utils/helpers'
import { formatCoords, isLocation } from '../utils/geo'
import { daysBetween, dueLabel, formatDate, formatDateTime, timeAgo } from '../utils/dates'

/**
 * First-run walkthrough for one tool's page. A student sees the record and the
 * borrow or return action and nothing else, so their tour describes only that —
 * no QR label, no editing, no status controls, which are staff-only and are not
 * rendered for them at all.
 */
const toolDetailTour = (student) =>
  student
    ? [
        {
          target: 'detail-record',
          title: 'The tool record',
          text: 'Status, condition, category and the shelf it lives on — everything you need before collecting it.',
        },
        {
          target: 'detail-action',
          title: 'Request or hand back',
          text: 'When the tool is free, Request to borrow appears here — staff approve it and you collect it from Requests. While you are holding it, Return tool takes its place.',
        },
        {
          target: 'detail-location',
          title: 'Put it back where it came from',
          text: 'This is the storage position to return the tool to after use.',
        },
      ]
    : [
        {
          target: 'detail-record',
          title: 'The tool record',
          text: 'Status, condition, serial number, servicing dates and how often the tool has been borrowed.',
        },
        {
          target: 'detail-edit',
          title: 'Correct the record',
          text: 'Fix a detail, change the category or update the serial number. The full activity timeline sits beside it.',
        },
        {
          target: 'detail-status',
          title: 'Take it in or out of service',
          text: 'Send the tool for maintenance, mark it damaged or lost, or restore it to the borrowable pool.',
        },
      ]

export default function ToolDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, can } = useApp()
  const toast = useToast()
  const [searchParams] = useSearchParams()

  // Where this page was opened from decides where "back" goes. A tool reached
  // by scanning its label belongs to the scan; a tool reached from the
  // inventory belongs there. Neither is the universal parent of this page —
  // the actual source is, and it travels with the URL as `?from=`.
  //
  // `source` rather than a single `fromScan` boolean: the same question — "how
  // did we get here?" — has to be answered again by History one page deeper,
  // and a boolean only ever answers it for scan. Keeping the source as a value
  // is what lets History forward it instead of each page inventing its own
  // yes/no flag for the one case it happens to care about.
  const source = searchParams.get('from') === 'scan' ? 'scan' : null
  const fromScan = source === 'scan'
  const backTo = fromScan ? '/scan' : '/tools'
  const backLabel = fromScan ? 'Back to Scan' : 'Back to Inventory'

  // Real back for either known source, never a hardcoded destination: routing
  // to `/scan` or `/tools` by URL would build that page from nothing, losing
  // whatever was on screen there (the scan result, an inventory filter or
  // scroll position). Going back one history entry returns to the page that is
  // already there, exactly as it was left — which for scan is what restores
  // the tool that was found instead of an empty camera.
  //
  // Only when this page was actually pushed onto the stack, though. Opened
  // cold — a shared link, a notification, a restored tab — there is nothing to
  // go back to, so the link falls through to its own `backTo` href: `/scan`
  // still rebuilds the last scan from storage, and `/tools` is always a valid
  // page to land on.
  const goBack = (event) => {
    if (!source) return
    if (window.history.state?.idx > 0) {
      event.preventDefault()
      navigate(-1)
    }
  }

  // What Borrow history is opened with, so the same source survives one more
  // page. Without this, History never knows a scan led here and always offers
  // "Back to inventory" — which is the leak this fixes: the tool details page
  // it eventually returns to loses `?from=scan` and falls back to Inventory.
  const historyHref = `/tools/${id}/history${source ? `?from=${source}` : ''}`

  // `reload` refreshes the record after a problem is reported, so the service
  // information on this page reflects it without a manual refresh.
  const { tool, loading, reload } = useTool(id)
  const { transactions } = useToolTransactions(id)
  const { records: maintenanceRecords } = useToolMaintenance(id)

  // Once per account on this device, remembered separately from every other page.
  const tour = usePageTour('tool-detail', user?.id)
  const tourSteps = useMemo(() => toolDetailTour(isStudent(user)), [user])

  // The actions render twice below — once beside the record card for `lg:`
  // and up, once after it for anything narrower — so exactly one of the
  // two copies of `data-tour="detail-action"` (and "detail-edit") must exist
  // at a time. `Walkthrough` resolves a target with a plain
  // `document.querySelector`, which always returns the first match in the
  // document regardless of which one is actually visible; with two elements
  // sharing that name, the walkthrough could silently spotlight — or, worse,
  // silently drop — a step depending on which copy happened to come first in
  // the markup. Matching Tailwind's own `lg:` breakpoint here is what lets
  // exactly one instance claim the attribute, restoring the one-target-one-
  // element assumption the rest of `Walkthrough` is built on.
  //
  // `lg:`, not `sm:`: this is the breakpoint the rest of the page's layout
  // already switches on (the `lg:grid-cols-3` body below, and Scan Result's
  // own `lg:hidden` phone/desktop split). Using `sm:` here left a window
  // between 640px and 1024px where this page had already switched to its
  // desktop, centred-button actions while Scan Result — and everything below
  // this row on this very page — was still showing its phone layout. Same
  // browser width, two different action styles was the actual bug; this line
  // is the fix for it, not the row placement above it.
  const isDesktopWidth = useMediaQuery('(min-width: 1024px)')

  const [editing, setEditing] = useState(false)
  const [reporting, setReporting] = useState(false)
  // A phone opens the same form in place, inside its own bordered action
  // list, instead of the modal `reporting` opens for desktop — same reason
  // Scan Result's mobile "Report a problem" row now expands instead of
  // popping a dialog. Kept as its own flag rather than reusing `reporting`
  // so the two layouts (rendered at different widths, sometimes both mounted
  // briefly during a resize) can never fight over one boolean.
  const [reportingInline, setReportingInline] = useState(false)
  const [selectedTxn, setSelectedTxn] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  // A skeleton in the shape this page settles into — header, alert strip, then
  // the two-column body — so nothing jumps when the record arrives.
  if (loading && !tool) {
    return (
      <div className="animate-fade-in">
        <Skeleton className="mb-3 h-4 w-32 rounded" />
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="card min-w-0 flex-1 overflow-hidden">
            <div className="border-b px-4 py-3">
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-6 w-2/3 max-w-xs rounded" />
                <Skeleton className="h-3.5 w-40 rounded" />
              </div>
            </div>
          </div>
          <Skeleton className="h-9 w-full shrink-0 rounded-lg lg:w-40" />
        </div>
        <Skeleton className="mb-4 h-12 rounded-lg" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  if (!tool) {
    return (
      <div className="card">
        <EmptyState
          icon={PackageSearch}
          title="Tool not found."
          description={`No tool is registered under ${id}. It may have been deleted from the inventory.`}
          action={
            <Link to="/tools" className="btn btn-primary">
              Back to inventory
            </Link>
          }
        />
      </div>
    )
  }

  const activeLoan = transactions.find(
    (t) => t.status === 'Borrowed' || t.status === 'Overdue',
  )
  const eligibility = toolService.borrowEligibility(tool)
  const maintenanceDue =
    tool.nextMaintenanceDate && daysBetween(new Date(), tool.nextMaintenanceDate) <= 0
  const showSerial = SERIAL_CRITICAL_CATEGORIES.includes(tool.category) || !!tool.serialNumber

  const runAction = async (action, message) => {
    setBusy(true)
    try {
      await action()
      toast.success(message)
      setConfirm(null)
    } catch (err) {
      toast.error(err.message ?? 'Unable to update the tool.')
    } finally {
      setBusy(false)
    }
  }

  const requestDelete = () =>
    setConfirm({
      title: `Delete ${tool.name}?`,
      message: `${tool.id} will be removed from the inventory and its QR code will stop resolving. Borrowing history is kept for the record.`,
      confirmLabel: 'Delete tool',
      onConfirm: async () => {
        setBusy(true)
        try {
          await toolService.remove(tool.id, user)
          toast.success(`${tool.name} was deleted.`)
          navigate('/tools', { replace: true })
        } catch (err) {
          if (err.name === 'ActiveTransactionError') {
            // The tool is out on loan, so deletion is refused — forcing it
            // would corrupt the open transaction's history.
            setConfirm((c) => ({
              ...c,
              title: 'This tool is still on loan',
              message: err.message,
              confirmLabel: 'Close',
              variant: 'primary',
              onConfirm: () => setConfirm(null),
            }))
          } else {
            toast.error(err.message ?? 'Unable to delete the tool.')
            setConfirm(null)
          }
        } finally {
          setBusy(false)
        }
      },
    })

  return (
    <>
      <Link
        to={backTo}
        onClick={goBack}
        className="muted mb-3 inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-black/[0.03] dark:hover:bg-white/5"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {backLabel}
      </Link>

      {/* The tool's whole record is one merged card: identity — picture, name,
          category/brand and status badges — in the header strip, then the
          identifying fields, and the maintenance and borrowing metadata, in
          one body. The actions beside it here are the desktop shape only. On a
          phone — and on a tablet up to `lg:` — they render after the card
          instead; see the block below. */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <section className="card min-w-0 flex-1 overflow-hidden" data-tour="detail-record">
          <header
            className="flex items-start gap-3 border-b px-4 py-3.5"
            style={{ background: 'rgb(var(--surface-2))' }}
          >
            <ToolImage
              tool={tool}
              rounded="rounded-xl"
              className="h-16 w-16 sm:h-20 sm:w-20"
              alt={`Picture of ${tool.name}`}
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">
                {tool.name}
              </h1>
              <p className="muted mt-1 text-sm">
                {tool.category} · {tool.brand || 'Unbranded'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={tool.status} />
                <ConditionBadge condition={tool.condition} />
              </div>
            </div>
          </header>

          <div className="p-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              <DetailItem label="Tool ID" className="min-w-0" mono>
                <span className="block truncate">{tool.id}</span>
              </DetailItem>
              <DetailItem label="Model" className="min-w-0">
                <span className="block truncate">{tool.model || '—'}</span>
              </DetailItem>
              <DetailItem label="Location" className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{tool.location}</span>
                </span>
              </DetailItem>
            </dl>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-4 sm:grid-cols-3">
              {showSerial && (
                <DetailItem label="Serial number" className="min-w-0" mono>
                  <span className="block truncate">{tool.serialNumber || '—'}</span>
                </DetailItem>
              )}
              <DetailItem label="Purchased" mono>
                {formatDate(tool.purchaseDate)}
              </DetailItem>
              <DetailItem label="Last maintenance" mono>
                {formatDate(tool.lastMaintenanceDate)}
              </DetailItem>
              <DetailItem label="Next maintenance" mono>
                <span className={cx(maintenanceDue && 'text-orange-600 dark:text-orange-400')}>
                  {formatDate(tool.nextMaintenanceDate)}
                </span>
              </DetailItem>
              <DetailItem label="Times borrowed" mono>
                {transactions.length}
              </DetailItem>
            </dl>

            {tool.description && (
              <div className="mt-4 border-t pt-4">
                <DetailItem label="Description">
                  <span className="muted font-normal">{tool.description}</span>
                </DetailItem>
              </div>
            )}
            {tool.notes && (
              <div className="mt-4 border-t pt-4">
                <DetailItem label="Notes">
                  <span className="muted whitespace-pre-wrap font-normal">{tool.notes}</span>
                </DetailItem>
              </div>
            )}
          </div>
        </section>
        {/* Desktop only — `lg:` and up, the same width this page's own body
            grid and Scan Result's phone/desktop split both switch at. On
            anything narrower the actions render after the record card instead.

            Dropped entirely when this page was opened from a scan result:
            Request to borrow, Return tool and Report a problem already sit
            one tap back on the scan result screen, so repeating them here
            would be the same action offered twice. Arriving from a scan makes
            this page purely a detail read — what the tool is, not what to do
            about it. */}
        {!fromScan && (
          <div className="hidden lg:block">
            <ToolActions
              layout="desktop"
              isStaffUser={isStaff(user)}
              tool={tool}
              activeLoan={activeLoan}
              eligibility={eligibility}
              can={can}
              historyHref={historyHref}
              onReport={() => setReporting(true)}
              onEdit={() => setEditing(true)}
              tourEnabled={isDesktopWidth}
            />
          </div>
        )}
      </div>

      {/* Below `lg:` — phone and tablet alike — the action rows sit right
          beneath the record card, which already carries the compact identity
          (image, status, ID, location, brand/model) that used to precede them.
          Same `fromScan` rule as the desktop copy above. */}
      {!fromScan && (
        <div className="mb-4 lg:hidden">
          <ToolActions
            layout="mobile"
            isStaffUser={isStaff(user)}
            tool={tool}
            activeLoan={activeLoan}
            eligibility={eligibility}
            can={can}
            historyHref={historyHref}
            reportingInline={reportingInline}
            onToggleReportInline={() => setReportingInline((v) => !v)}
            onReportedInline={() => {
              setReportingInline(false)
              reload()
            }}
            onEdit={() => setEditing(true)}
            tourEnabled={!isDesktopWidth}
          />
        </div>
      )}

      {/* ------------------------------- alerts ------------------------------- */}
      <div className="mb-4 space-y-2">
        {!eligibility.ok && !activeLoan && (
          <Alert tone="warning" icon={AlertTriangle}>
            {eligibility.reason}
          </Alert>
        )}
        {activeLoan && (
          <Alert
            tone={activeLoan.status === 'Overdue' ? 'danger' : 'info'}
            icon={activeLoan.status === 'Overdue' ? AlertTriangle : ClipboardList}
          >
            <span>
              Currently held by <strong>{activeLoan.userName}</strong> — {dueLabel(activeLoan.dueDate)}{' '}
              (due {formatDate(activeLoan.dueDate)}).
            </span>
          </Alert>
        )}
        {maintenanceDue && tool.status !== TOOL_STATUS.MAINTENANCE && (
          <Alert tone="warning" icon={CalendarClock}>
            Scheduled maintenance was due on {formatDate(tool.nextMaintenanceDate)}.
          </Alert>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------------ main column ------------------------------ */}
        <div className="space-y-4 lg:col-span-2">
          {/* Only while the tool is actually out, and only for the borrower
              holding it. Staff may still record a point through the service, but
              the control is not shown to them: this device's position is the
              borrower's, and an administrator opening the page is not standing
              where the tool is. */}
          {activeLoan && activeLoan.userId === user?.id && canReturnTransaction(user, activeLoan) && (
            <ToolLocationCheckpoint
              loan={activeLoan}
              actor={user}
              onRecorded={(updated) => {
                setSelectedTxn((current) =>
                  current?.id === updated.id ? updated : current,
                )
              }}
            />
          )}

          {/* Staff only: a student's borrowings of this tool are the Borrow
              history page above, and showing the newest three here as well
              would be the same records twice on the one screen. */}
          {isStaff(user) && (
          <SectionCard
            title="Borrowing history"
            description={
              (transactions.length > 3
                ? `Latest 3 of ${transactions.length} transaction${
                    transactions.length === 1 ? '' : 's'
                  }`
                : `${transactions.length} transaction${transactions.length === 1 ? '' : 's'}`) +
              ' recorded'
            }
            bodyClassName="p-0"
            action={
              can(PERM.TXN_VIEW_ALL) ? (
                <Link to={historyHref} className="btn btn-ghost btn-sm">
                  Full timeline
                </Link>
              ) : null
            }
          >
            <TransactionTable
              // The three most recent only — the rest are one tap away under
              // "Full timeline".
              transactions={transactions.slice(0, 3)}
              onSelect={setSelectedTxn}
              emptyTitle="This tool has not been borrowed yet."
              emptyDescription="Issue it from the borrow desk or by scanning its QR code."
              compact={false}
            />
          </SectionCard>
          )}

          {/* Service records are staff data — the data layer refuses them to a
              student outright, so the card could only ever show them an empty
              state. It follows the same permission as the Maintenance page. */}
          {can(PERM.MAINTENANCE_VIEW) && (
            <SectionCard
              title="Maintenance history"
              description="Service, calibration and repair records"
              bodyClassName="p-0"
            >
              {maintenanceRecords.length === 0 ? (
                <EmptyState
                  icon={HardHat}
                  title="No maintenance recorded."
                  description="Service records appear here once the tool has been checked or calibrated."
                  compact
                />
              ) : (
                <ul className="divide-y">
                  {maintenanceRecords.map((record) => (
                    <li key={record.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold">{record.type}</p>
                          <p className="subtle text-xs">
                            {formatDate(record.date)} · {record.technician}
                          </p>
                        </div>
                        <MaintenanceStatusBadge status={record.status} />
                      </div>
                      {record.notes && <p className="muted mt-1.5 text-xs">{record.notes}</p>}
                      {record.nextDate && (
                        <p className="subtle mono mt-1 text-[11px]">
                          Next service {formatDate(record.nextDate)}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}
        </div>

        {/* ------------------------------ side column ------------------------------ */}
        <div className="space-y-4">
          {/* The QR panel is the label workshop — it downloads and prints the
              sticker that goes on the shelf. That is crib-desk work, so it is
              not rendered at all for a student: the panel and both of its
              actions exist only for staff. A student scans the printed code
              from the Scan page instead. */}
          {isStaff(user) && (
            <SectionCard title="QR code" description="Printed label for this tool">
              <QRCodePanel tool={tool} size={190} />
            </SectionCard>
          )}

          {can(PERM.TOOL_STATUS) && (
            <SectionCard
              title="Tool status"
              description="Take the tool in or out of service"
              data-tour="detail-status"
            >
              <div className="space-y-2">
                {tool.status !== TOOL_STATUS.MAINTENANCE && (
                  <StatusAction
                    icon={HardHat}
                    label="Mark for maintenance"
                    description="Removes the tool from circulation."
                    onClick={() =>
                      runAction(
                        () => toolService.markMaintenance(tool.id, user, 'Sent for maintenance.'),
                        `${tool.name} was sent for maintenance.`,
                      )
                    }
                    disabled={busy}
                  />
                )}
                {tool.status !== TOOL_STATUS.DAMAGED && (
                  <StatusAction
                    icon={ShieldAlert}
                    label="Mark as damaged"
                    description="Blocks borrowing until it is repaired."
                    onClick={() =>
                      runAction(
                        () => toolService.markDamaged(tool.id, user, 'Reported damaged.'),
                        `${tool.name} was marked as damaged.`,
                      )
                    }
                    disabled={busy}
                  />
                )}
                {tool.status !== TOOL_STATUS.LOST && (
                  <StatusAction
                    icon={PackageSearch}
                    label="Report lost"
                    description="Records the tool as missing from the laboratory."
                    onClick={() =>
                      runAction(
                        () => toolService.markLost(tool.id, user, 'Reported lost.'),
                        `${tool.name} was reported lost.`,
                      )
                    }
                    disabled={busy}
                  />
                )}
                {tool.status !== TOOL_STATUS.AVAILABLE && (
                  <StatusAction
                    icon={RotateCcw}
                    label="Restore to available"
                    description="Returns the tool to the borrowable pool."
                    tone="success"
                    onClick={() =>
                      runAction(
                        () => toolService.restore(tool.id, user, 'Restored to service.'),
                        `${tool.name} is available again.`,
                      )
                    }
                    disabled={busy}
                  />
                )}
              </div>

              {can(PERM.TOOL_DELETE) && (
                <button
                  type="button"
                  onClick={requestDelete}
                  className="btn btn-ghost mt-3 w-full border-t text-red-600 dark:text-red-400"
                  disabled={busy}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete this tool
                </button>
              )}
            </SectionCard>
          )}

          {isStaff(user) && (
          <SectionCard title="Where it lives" description="Laboratory storage" data-tour="detail-location">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amberline-400/15">
                <MapPin className="h-5 w-5 text-amberline-600 dark:text-amberline-400" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold">{tool.location}</p>
                <p className="subtle mt-0.5 text-xs">
                  Return the tool to this position after use.
                </p>
              </div>
            </div>
          </SectionCard>
          )}
        </div>
      </div>

      <ToolForm open={editing} tool={tool} onClose={() => setEditing(false)} />
      <ReportProblemDialog
        tool={tool}
        open={reporting}
        onClose={() => setReporting(false)}
        onReported={reload}
      />
      <TransactionDetail
        transaction={selectedTxn}
        open={!!selectedTxn}
        onClose={() => setSelectedTxn(null)}
      />
      <Walkthrough steps={tourSteps} open={tour.open} onClose={tour.close} compact={isStudent(user)} />

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm?.onConfirm?.({ force: confirm.force })}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        variant={confirm?.variant}
        loading={busy}
      />
    </>
  )
}

/**
 * Picks the one action set this person gets — staff's or a student's — and
 * the one shape it renders in — desktop's compact buttons, or a phone's
 * list rows — so neither of the two places that render actions (the desktop
 * header row and the phone's row below the record card) has to repeat either decision.
 * All four combinations stay in one place this way: change who gets what, or
 * how a layout presents it, and every call site follows.
 *
 * The desktop shape is unchanged from before this pass — outlined buttons for
 * Report/Edit, a subtle text row for History — because a row of compact
 * buttons is a good use of the horizontal space desktop has and the app's own
 * mobile action pattern is deliberately for mobile, not a universal rule. The
 * phone shape is what changed: Report, Edit and History are now the same kind
 * of row AutoTrack's Scan Result already uses for its own secondary actions
 * (text and a chevron, dividers between them, no button borders, no leading
 * icons) — one action language across the app's two entry points to the same
 * information, rather than two different-looking versions of "what else can I
 * do with this tool".
 */
function ToolActions({
  layout,
  isStaffUser,
  tool,
  activeLoan,
  eligibility,
  can,
  historyHref,
  onReport,
  onEdit,
  // Mobile only: the inline report form's own open flag and handlers, in
  // place of `onReport` opening the desktop modal — see the note on
  // `reportingInline` where this page keeps its state.
  reportingInline,
  onToggleReportInline,
  onReportedInline,
  // Whether THIS copy is the one allowed to carry `data-tour`. Exactly one of
  // the two responsive instances should ever be `true` at a time — see the
  // note beside `isDesktopWidth` above.
  tourEnabled,
}) {
  if (layout === 'mobile') {
    return isStaffUser ? (
      <MobileStaffActions
        tool={tool}
        activeLoan={activeLoan}
        eligibility={eligibility}
        can={can}
        historyHref={historyHref}
        reporting={reportingInline}
        onToggleReport={onToggleReportInline}
        onReported={onReportedInline}
        onEdit={onEdit}
        tourEnabled={tourEnabled}
      />
    ) : (
      <MobileStudentActions
        tool={tool}
        activeLoan={activeLoan}
        eligibility={eligibility}
        can={can}
        reporting={reportingInline}
        onToggleReport={onToggleReportInline}
        onReported={onReportedInline}
        tourEnabled={tourEnabled}
      />
    )
  }

  return isStaffUser ? (
    <StaffActions
      tool={tool}
      activeLoan={activeLoan}
      eligibility={eligibility}
      can={can}
      historyHref={historyHref}
      onReport={onReport}
      onEdit={onEdit}
      tourEnabled={tourEnabled}
    />
  ) : (
    <StudentActions
      tool={tool}
      activeLoan={activeLoan}
      eligibility={eligibility}
      can={can}
      onReport={onReport}
      tourEnabled={tourEnabled}
    />
  )
}

/**
 * A student's own account is the only history this page could show them —
 * their borrowings of this tool are what "Borrow history" used to link to —
 * and that record already exists in full on their own Requests/Transactions
 * pages. Repeating it here as a link would be a second way to reach
 * information they did not ask this page for, so a student's actions end
 * with the two things this page is actually for: take the tool, or say
 * something is wrong with it.
 *
 * Two tiers, not three: a primary action (Request/Return, whichever the
 * tool's state calls for — never both) and one subordinate action beside it.
 * Two outlined buttons of equal weight would read as two competing choices,
 * so Report is deliberately smaller and plainer than the primary next to it.
 */
function StudentActions({ tool, activeLoan, eligibility, can, onReport, tourEnabled }) {
  // Spread rather than a literal `data-tour="detail-action"`: with this
  // component rendered twice on the page (once per breakpoint), only the
  // instance the current viewport actually shows may carry the attribute, or
  // `Walkthrough`'s `querySelector` could resolve to the other, hidden copy.
  const tourTarget = tourEnabled ? { 'data-tour': 'detail-action' } : {}

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[220px]">
      {eligibility.ok && can(PERM.REQUEST_CREATE) && !activeLoan && (
        <Link
          to={`/requests/new?tool=${tool.id}`}
          className="btn btn-primary w-full"
          {...tourTarget}
        >
          Request to borrow
        </Link>
      )}
      {/* Once the hand-back has been asked for, the same link stays — it is
          how the record is opened — but it says what has already happened
          rather than inviting the ask a second time. */}
      {/* The other slot this row can hold — same size and alignment as
          Request to borrow above, since only one of the two ever renders and
          whichever one does is this screen's primary action. */}
      {activeLoan && can(PERM.RETURN) && (
        <Link
          to={`/return?tool=${tool.id}`}
          className={cx(
            'btn w-full justify-between text-[17px]',
            txnService.returnRequested(activeLoan) ? 'btn-outline' : 'btn-success',
          )}
          style={{ minHeight: '50px' }}
          {...tourTarget}
        >
          {txnService.returnRequested(activeLoan) ? 'Return requested' : 'Return tool'}
          <ArrowRight className="h-[18px] w-[18px] opacity-70" />
        </Link>
      )}

      {/* Full width, matching the primary above it: the two still read as
          primary/secondary from the fill (solid vs. outlined) and the smaller
          `btn-sm` height, and matching widths is what keeps the pair aligned
          and consistent rather than looking arbitrarily different sizes. */}
      <button
        type="button"
        onClick={onReport}
        className="btn btn-outline btn-sm w-full"
      >
        Report a problem
      </button>
    </div>
  )
}

/**
 * Staff keep the same primary/secondary shape a student gets, plus one more
 * thing a student never sees at all: a way into the tool's full transaction
 * timeline. That is not a third button — a row of three same-sized controls
 * is the exact "everything looks equally important" problem this replaces —
 * it is a quieter line underneath, closer in weight to a caption than to a
 * button, because reading the history is not the point of visiting this page,
 * only something this page can lead to.
 */
function StaffActions({ tool, activeLoan, eligibility, can, historyHref, onReport, onEdit, tourEnabled }) {
  // Spread rather than a literal attribute, for the same reason as
  // `StudentActions`: this component is rendered twice on the page, once per
  // breakpoint, and only the copy the current viewport actually shows may
  // claim the tour target.
  const actionTarget = tourEnabled ? { 'data-tour': 'detail-action' } : {}
  const editTarget = tourEnabled ? { 'data-tour': 'detail-edit' } : {}

  return (
    <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:min-w-[240px]">
      <div className="flex flex-col gap-2">
        {eligibility.ok && can(PERM.BORROW_FOR_OTHERS) && (
          <Link
            to={`/borrow?tool=${tool.id}`}
            className="btn btn-primary w-full"
            {...actionTarget}
          >
            Borrow tool
          </Link>
        )}
        {activeLoan && can(PERM.RETURN) && (
          <Link
            to={`/return?tool=${tool.id}`}
            className={cx(
              'btn w-full',
              txnService.returnRequested(activeLoan) ? 'btn-outline' : 'btn-success',
            )}
            {...actionTarget}
          >
            {txnService.returnRequested(activeLoan) ? 'Return requested' : 'Return tool'}
          </Link>
        )}

        {/* Report and Edit share one line at equal, smaller weight — two
            things staff might also do, neither of them the reason they opened
            this tool. `flex` rather than a fixed two-column grid: a role
            without Edit still gets a well-proportioned single button rather
            than a half-width one beside an empty gap. */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReport}
            className="btn btn-outline btn-sm min-w-0 flex-1"
          >
            <span className="truncate">Report a problem</span>
          </button>
          {can(PERM.TOOL_EDIT) && (
            <button
              type="button"
              onClick={onEdit}
              className="btn btn-outline btn-sm min-w-0 flex-1"
              {...editTarget}
            >
              <span className="truncate">Edit tool</span>
            </button>
          )}
        </div>
      </div>

      {/* A separate row below the action group, not appended to it: a top
          border and a gap of its own is what keeps this from reading as a
          fourth action in the same stack. Quiet text and a bare chevron are
          the whole of its emphasis — no icon on the left, nothing filled,
          nothing outlined — because a link to more information should look
          exactly that subordinate next to the buttons that change something. */}
      {can(PERM.TXN_VIEW_ALL) && (
        <Link
          to={historyHref}
          className="flex min-h-[40px] items-center justify-between gap-3 border-t px-0.5 pt-2.5
                     text-[13px] font-semibold text-current/80 transition-colors hover:text-current"
          style={{ color: 'rgb(var(--text-muted))' }}
        >
          <span className="truncate">View history</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Link>
      )}
    </div>
  )
}

/**
 * One secondary row for the mobile action list: a label and a chevron,
 * nothing else. The shared shape behind every "and also…" action on a phone —
 * Report a problem, Edit tool, Borrow history all render through this — so
 * the list looks like one thing with several rows rather than several things
 * that happen to be stacked. `as` renders it as whichever element the action
 * actually is: a `Link` when it goes somewhere, a `button` when it opens a
 * dialog elsewhere, matching what the row does rather than what is convenient.
 *
 * `expanded` is for the one row that does neither — Report a problem opens in
 * place now, so its arrow becomes a chevron that rotates with the row's own
 * open state, the same affordance the Settings accordion and Scan Result's
 * report row already use.
 */
function ActionRow({ as: Tag = 'button', divided = true, expanded, children, ...props }) {
  return (
    <Tag
      type={Tag === 'button' ? 'button' : undefined}
      aria-expanded={expanded}
      className={cx(
        'flex min-h-[46px] w-full items-center justify-between gap-3 px-3 text-left text-[14px]',
        'font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/5',
        divided && 'border-t',
      )}
      style={{ borderColor: 'rgb(var(--border))' }}
      {...props}
    >
      {children}
      {expanded === undefined ? (
        <ArrowRight className="h-4 w-4 shrink-0 opacity-40" />
      ) : (
        <ChevronDown
          className={cx('h-4 w-4 shrink-0 opacity-40 transition-transform', expanded && 'rotate-180')}
        />
      )}
    </Tag>
  )
}

/**
 * The report form itself, laid out beneath its row rather than in a modal —
 * the phone counterpart of `ReportProblemDialog`, sharing the same service
 * call (`maintenanceService.reportProblem`) and fields. Collapsed with the
 * same grid-rows technique the Settings accordion uses, so a variable-height
 * form (an error message, a longer description) still animates smoothly.
 */
function ReportProblemInlineRow({ tool, open, onReported, onCancel }) {
  return (
    <div
      className="grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
    >
      <div className="overflow-hidden">
        <div className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
          <ReportProblemInline tool={tool} open={open} onReported={onReported} onCancel={onCancel} />
        </div>
      </div>
    </div>
  )
}

function ReportProblemInline({ tool, open, onReported, onCancel }) {
  const toast = useToast()
  const [type, setType] = useState('Corrective')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  // A fresh form each time it opens, so a previous draft never attaches
  // itself to a different tool.
  useEffect(() => {
    if (!open) return
    setType('Corrective')
    setDescription('')
    setErrors({})
    setBusy(false)
  }, [open, tool?.id])

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setErrors({})
    try {
      await maintenanceService.reportProblem({ toolId: tool.id, type, description })
      toast.success('Thank you — the laboratory staff have been notified.', {
        title: 'Problem reported',
      })
      onReported?.()
    } catch (err) {
      if (err?.errors) setErrors(err.errors)
      else toast.error(err?.message ?? 'The report could not be sent.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 p-3.5">
      <div
        className="flex items-start gap-2.5 rounded-lg border p-3"
        style={{ background: 'rgb(var(--surface-2))' }}
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
        <p className="subtle text-xs leading-relaxed">
          This report is filed against <span className="font-semibold">{tool.name}</span> and goes
          to the laboratory staff. The tool's status is not changed by reporting it.
        </p>
      </div>

      <SelectField
        label="What kind of problem?"
        value={type}
        onChange={(e) => setType(e.target.value)}
        options={MAINTENANCE_TYPES}
        error={errors.type}
        required
      />

      <TextAreaField
        label="What is wrong?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        error={errors.description}
        hint="What you noticed, and when. Staff see this on the service log."
        rows={3}
        maxLength={500}
        required
      />

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn btn-ghost" disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy && <Spinner />}
          Send report
        </button>
      </div>
    </form>
  )
}

/**
 * The student's phone layout: the same primary action as desktop, then Report
 * a problem as a single row in a bordered list — the one-row case of the
 * pattern below, kept in its own bordered box so it still reads as a distinct
 * group rather than a stray line of text under the button.
 */
function MobileStudentActions({ tool, activeLoan, eligibility, can, reporting, onToggleReport, onReported, tourEnabled }) {
  const tourTarget = tourEnabled ? { 'data-tour': 'detail-action' } : {}

  return (
    <div className="flex w-full flex-col gap-2">
      {/* `justify-between`: `.btn` centres its contents by default, which is
          right for a button with one word but reads as the label being
          centred rather than aligned once an arrow sits after it — Scan
          Result's own primary overrides the same default the same way. */}
      {eligibility.ok && can(PERM.REQUEST_CREATE) && !activeLoan && (
        <Link
          to={`/requests/new?tool=${tool.id}`}
          className="btn btn-primary w-full justify-between text-[17px]"
          style={{ minHeight: '50px' }}
          {...tourTarget}
        >
          Request to borrow
          <ArrowRight className="h-[18px] w-[18px] opacity-70" />
        </Link>
      )}
      {/* The other slot this row can hold — same size and alignment as
          Request to borrow above, since only one of the two ever renders and
          whichever one does is this screen's primary action. */}
      {activeLoan && can(PERM.RETURN) && (
        <Link
          to={`/return?tool=${tool.id}`}
          className={cx(
            'btn w-full justify-between text-[17px]',
            txnService.returnRequested(activeLoan) ? 'btn-outline' : 'btn-success',
          )}
          style={{ minHeight: '50px' }}
          {...tourTarget}
        >
          {txnService.returnRequested(activeLoan) ? 'Return requested' : 'Return tool'}
          <ArrowRight className="h-[18px] w-[18px] opacity-70" />
        </Link>
      )}

      {/* A surface behind the border, matching `.card`: `--border` alone is
          only a few points of luminance from the page background, so without
          a fill this read as text floating under the button rather than a
          second, distinct control. */}
      <div
        className="overflow-hidden rounded-xl shadow-card"
        style={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))' }}
      >
        <ActionRow onClick={onToggleReport} divided={false} expanded={reporting}>
          Report a problem
        </ActionRow>
        <ReportProblemInlineRow
          tool={tool}
          open={reporting}
          onReported={onReported}
          onCancel={onToggleReport}
        />
      </div>
    </div>
  )
}

/**
 * The staff phone layout: the primary action, then Report, Edit and History
 * as one divided list of rows — where desktop spends horizontal space on two
 * compact buttons plus a separate subtle line, a phone spends vertical space
 * on rows instead, which is the same trade Scan Result already makes for
 * "View tool details" and "Report a problem". History sits in the same list
 * rather than set apart: on a phone there is no spare width to make it look
 * different by being smaller, so it stays a peer row in the same box and
 * lets its position — last — say that it is the one that leads elsewhere
 * rather than changing something.
 */
function MobileStaffActions({ tool, activeLoan, eligibility, can, historyHref, reporting, onToggleReport, onReported, onEdit, tourEnabled }) {
  const actionTarget = tourEnabled ? { 'data-tour': 'detail-action' } : {}
  const editTarget = tourEnabled ? { 'data-tour': 'detail-edit' } : {}
  const canEdit = can(PERM.TOOL_EDIT)
  const canViewHistory = can(PERM.TXN_VIEW_ALL)

  return (
    <div className="flex w-full flex-col gap-2">
      {/* `justify-between`, matching Scan Result's own primary and the
          student layout above. */}
      {eligibility.ok && can(PERM.BORROW_FOR_OTHERS) && (
        <Link
          to={`/borrow?tool=${tool.id}`}
          className="btn btn-primary w-full justify-between text-[17px]"
          style={{ minHeight: '50px' }}
          {...actionTarget}
        >
          Borrow tool
          <ArrowRight className="h-[18px] w-[18px] opacity-70" />
        </Link>
      )}
      {/* The other slot this row can hold — same size and alignment as
          Borrow tool above, since only one of the two ever renders and
          whichever one does is this screen's primary action. */}
      {activeLoan && can(PERM.RETURN) && (
        <Link
          to={`/return?tool=${tool.id}`}
          className={cx(
            'btn w-full justify-between text-[17px]',
            txnService.returnRequested(activeLoan) ? 'btn-outline' : 'btn-success',
          )}
          style={{ minHeight: '50px' }}
          {...actionTarget}
        >
          {txnService.returnRequested(activeLoan) ? 'Return requested' : 'Return tool'}
          <ArrowRight className="h-[18px] w-[18px] opacity-70" />
        </Link>
      )}

      {/* A surface behind the border, matching `.card` — see the same note on
          the student layout above. */}
      <div
        className="overflow-hidden rounded-xl shadow-card"
        style={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))' }}
      >
        <ActionRow onClick={onToggleReport} divided={false} expanded={reporting}>
          Report a problem
        </ActionRow>
        <ReportProblemInlineRow
          tool={tool}
          open={reporting}
          onReported={onReported}
          onCancel={onToggleReport}
        />
        {canEdit && (
          <ActionRow onClick={onEdit} {...editTarget}>
            Edit tool
          </ActionRow>
        )}
        {canViewHistory && (
          <ActionRow as={Link} to={historyHref}>
            Borrow history
          </ActionRow>
        )}
      </div>
    </div>
  )
}

const ALERT_TONES = {
  info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200',
  warning:
    'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200',
  danger:
    'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200',
}

function Alert({ tone = 'info', icon: Icon, children }) {
  return (
    <div className={cx('flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5', ALERT_TONES[tone])}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
      <p className="text-sm font-medium leading-snug">{children}</p>
    </div>
  )
}

function StatusAction({ icon: Icon, label, description, onClick, disabled, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        'hover:bg-black/[0.03] disabled:opacity-50 dark:hover:bg-white/5',
        tone === 'success' && 'border-emerald-300 dark:border-emerald-500/40',
      )}
    >
      <Icon
        className={cx(
          'mt-0.5 h-4 w-4 shrink-0',
          tone === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'opacity-60',
        )}
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="subtle block text-xs">{description}</span>
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * "Confirm current tool location"
 *
 * The only way a point is recorded between collecting a tool and handing it
 * back, and it happens exactly when the button below is pressed — one reading,
 * one append, then nothing. There is no timer here, no `watchPosition`, and no
 * state that outlives the click; closing the page stops nothing because nothing
 * was running.
 *
 * Shown only while the loan is open, and only to whoever may close it. The
 * checkpoints already recorded are listed underneath so the borrower can see
 * exactly what has been stored about them.
 * ------------------------------------------------------------------ */
/**
 * How recent a point has to be for opening the page to leave it alone.
 *
 * Without this, walking back and forth between the tool and the transaction
 * would fill the trail with near-identical entries and turn a record of where
 * the tool was into a record of what the borrower was doing.
 */
const RECHECK_MS = 10 * 60 * 1000

function ToolLocationCheckpoint({ loan, actor, onRecorded }) {
  const toast = useToast()
  const { location: reading, failure: locationFailure, ensure: ensureLocation } = useAutoLocation()
  const [saving, setSaving] = useState(false)
  // The loan as last written, so a checkpoint appears in the list immediately
  // rather than waiting for the next refresh of the tool's transactions.
  const [record, setRecord] = useState(loan)

  const checkpoints = txnService.checkpointsOf(record)

  // Where this loan says the tool actually is — the borrower's own last
  // recorded point for this tool, resolved from the loan rather than typed in
  // or defaulted. Null when the loan has none, which is a state, not a value.
  const known = txnService.lastKnownLocation(record)

  const save = async (location, noteText = '') => {
    if (!location) return
    setSaving(true)
    try {
      const updated = await txnService.addLocationCheckpoint(
        { transactionId: record.id, location, note: noteText },
        actor,
      )
      setRecord(updated)
      toast.success('Location checkpoint recorded.', {
        title: `Checkpoint ${txnService.checkpointsOf(updated).length}`,
      })
      onRecorded?.(updated)
    } catch (err) {
      toast.error(err.message ?? 'The location checkpoint could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * The checkpoint records itself.
   *
   * The borrower is the one holding the tool, so opening its page while the loan
   * is open is itself the confirmation — there is nothing they could add by
   * pressing a button that the device has not already answered.
   *
   * Three things keep this from becoming tracking:
   *
   *   - it runs once per visit, latched on a ref, never on a timer;
   *   - it uses only the reading `useAutoLocation` already had, which exists
   *     solely when the permission was granted beforehand, so opening a page
   *     never raises a prompt;
   *   - a point recorded within `RECHECK_MS` is left alone, so returning to the
   *     page repeatedly writes nothing.
   */
  const autoSaved = useRef(false)
  useEffect(() => {
    if (autoSaved.current || !isLocation(reading)) return
    const last = known?.capturedAt ? new Date(known.capturedAt).getTime() : 0
    if (Date.now() - last < RECHECK_MS) return
    autoSaved.current = true
    void save({
      lat: reading.lat,
      lng: reading.lng,
      accuracy: reading.accuracy ?? null,
      // The device's own timestamp, so the age shown is the age of the fix.
      capturedAt: reading.capturedAt,
    }, '')
    // `save` and `known` are read as they stand on the one run this can have.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading])

  return (
    <SectionCard
      title="Confirm current tool location"
      description="Record where this tool is right now, while it is still out"
    >
      <p className="muted text-xs leading-relaxed">
        One reading is recorded when you open this page while the tool is out with you, and each is
        stored on its own with the time it was taken — the app does not follow the tool or you in
        between.
      </p>

      {/* The tool's own last recorded whereabouts on this loan, resolved from
          the borrower's records so it can be confirmed as it stands instead of
          being re-typed. A loan with nothing recorded says so. */}
      <div className="mt-3 rounded-xl border p-3.5" style={{ background: 'rgb(var(--surface-2))' }}>
        <p className="subtle text-[11px] font-bold uppercase tracking-wider">
          Last recorded location
        </p>
        {known ? (
          <>
            <p className="mono mt-1.5 text-xs font-bold">{formatCoords(known)}</p>
            <p className="subtle mt-1 text-[11px] leading-relaxed">
              {known.source === 'checkpoint'
                ? `Confirmed by ${known.capturedByName ?? record.userName} while the tool was out`
                : `Where ${record.userName} collected the tool`}
              {' · '}
              {/* Both, and in this order: how long ago answers "is this still
                  current?" at a glance, the clock time is what gets written
                  down. The age is derived from the stored timestamp — nothing
                  new is recorded to show it. */}
              {timeAgo(known.capturedAt)} · {formatDateTime(known.capturedAt)}
              {known.note ? ` · “${known.note}”` : ''}
            </p>
          </>
        ) : (
          <p className="muted mt-1.5 text-xs leading-relaxed">
            Nothing has been recorded for this loan yet. A reading is only taken where the location
            permission has already been allowed, so a loan where it was refused simply has none.
          </p>
        )}
      </div>

      <AutoLocationNotice location={reading} failure={locationFailure} className="mt-3" />

      {checkpoints.length > 0 && (
        <div className="mt-4 border-t pt-4">
          <LocationTrail transaction={record} />
        </div>
      )}
    </SectionCard>
  )
}
