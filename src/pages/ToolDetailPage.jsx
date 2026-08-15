import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ClipboardList,
  HardHat,
  History,
  MapPin,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Undo2,
  PackageSearch,
} from 'lucide-react'
import {
  ConditionBadge,
  ConfirmDialog,
  DetailItem,
  EmptyState,
  MaintenanceStatusBadge,
  SectionCard,
  Skeleton,
  Spinner,
  StatusBadge,
  TextField,
} from '../components/ui'
import Walkthrough, { usePageTour } from '../components/Walkthrough'
import { QRCodePanel } from '../components/QRCodeDisplay'
import TransactionTable from '../components/TransactionTable'
import TransactionDetail from '../components/TransactionDetail'
import ToolForm from '../components/ToolForm'
import ToolImage from '../components/ToolImage'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useTool, useToolMaintenance, useToolTransactions } from '../hooks'
import * as toolService from '../services/tools'
import * as txnService from '../services/transactions'
import { AutoLocationNotice, LocationTrail, useAutoLocation } from '../components/LocationCapture'
import { canReturnTransaction, isStaff, isStudent, PERM } from '../utils/permissions'
import { TOOL_STATUS, SERIAL_CRITICAL_CATEGORIES } from '../utils/constants'
import { cx } from '../utils/helpers'
import { formatCoords } from '../utils/geo'
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
  // by scanning its label belongs to the scan — sending that person to the
  // inventory instead would drop them somewhere they have never been. Every
  // other entry point keeps the inventory, exactly as before.
  const fromScan = searchParams.get('from') === 'scan'
  const backTo = fromScan ? '/scan' : '/tools'
  const backLabel = fromScan ? 'Back to Scan' : 'Back to Inventory'

  const { tool, loading } = useTool(id)
  const { transactions } = useToolTransactions(id)
  const { records: maintenanceRecords } = useToolMaintenance(id)

  // Once per account on this device, remembered separately from every other page.
  const tour = usePageTour('tool-detail', user?.id)
  const tourSteps = useMemo(() => toolDetailTour(isStudent(user)), [user])

  const [editing, setEditing] = useState(false)
  const [selectedTxn, setSelectedTxn] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  // A skeleton in the shape this page settles into — header, alert strip, then
  // the two-column body — so nothing jumps when the record arrives.
  if (loading && !tool) {
    return (
      <div className="animate-fade-in">
        <Skeleton className="mb-3 h-4 w-32 rounded" />
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="card min-w-0 flex-1 overflow-hidden">
            <div className="border-b px-4 py-3">
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-6 w-2/3 max-w-xs rounded" />
                <Skeleton className="h-3.5 w-40 rounded" />
              </div>
            </div>
          </div>
          <Skeleton className="h-9 w-full shrink-0 rounded-lg sm:w-40" />
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
        className="muted mb-3 inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-black/[0.03] dark:hover:bg-white/5"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {backLabel}
      </Link>

      {/* The heading is a card matching the Tool record card below it — same
          surface, same header strip, same border and radius — so the page reads
          as one record: the tool named on its card, then the record itself. The
          name keeps the page-title size rather than the card's small section
          title, and the action buttons stay outside the card on their own row. */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <section className="card min-w-0 flex-1 overflow-hidden">
          <header className="border-b px-4 py-3" style={{ background: 'rgb(var(--surface-2))' }}>
            <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">
              {tool.name}
            </h1>
            <p className="muted mt-1 text-sm">
              {tool.category} · {tool.brand || 'Unbranded'}
            </p>
          </header>
        </section>
        <div className="flex flex-wrap items-center gap-2">
          {/* Staff issue from the counter; a student asks for the tool, which
              is one request raised on the one page that creates them. */}
          {eligibility.ok && can(PERM.BORROW_FOR_OTHERS) && (
            <Link to={`/borrow?tool=${tool.id}`} className="btn btn-primary" data-tour="detail-action">
              <ArrowRight className="h-4 w-4" />
              Borrow tool
            </Link>
          )}
          {eligibility.ok && !can(PERM.BORROW_FOR_OTHERS) && can(PERM.REQUEST_CREATE) && (
            <Link
              to={`/requests/new?tool=${tool.id}`}
              className="btn btn-primary"
              data-tour="detail-action"
            >
              <ArrowRight className="h-4 w-4" />
              Request to borrow
            </Link>
          )}
          {/* Once the hand-back has been asked for, the same link stays — it is
              how the record is opened — but it says what has already happened
              rather than inviting the ask a second time. */}
          {activeLoan && can(PERM.RETURN) && (
            <Link
              to={`/return?tool=${tool.id}`}
              className={cx('btn', txnService.returnRequested(activeLoan) ? 'btn-outline' : 'btn-success')}
              data-tour="detail-action"
            >
              <Undo2 className="h-4 w-4" />
              {txnService.returnRequested(activeLoan) ? 'Return requested' : 'Return tool'}
            </Link>
          )}
          {can(PERM.TOOL_EDIT) && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="btn btn-outline"
              data-tour="detail-edit"
            >
              <Pencil className="h-4 w-4" />
              Edit tool
            </button>
          )}
          {/* One page per audience, on the same route: staff open the tool's
              full laboratory timeline, a student their own borrowings of this
              tool. It is the only place either list is shown, so nothing is
              repeated on the record below. */}
          <Link to={`/tools/${tool.id}/history`} className="btn btn-outline">
            <History className="h-4 w-4" />
            {isStaff(user) ? 'View history' : 'Borrow history'}
          </Link>
        </div>
      </div>

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
          {/* Only while the tool is actually out, and only for whoever may close
              that loan — the borrower, or staff. `canReturnTransaction` is the
              existing rule for exactly that, so no new permission appears here. */}
          {activeLoan && canReturnTransaction(user, activeLoan) && (
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

          <SectionCard title="Tool record" data-tour="detail-record">
            {/* One layout at every width: a fixed square thumbnail with the
                badges beside it, so a phone reads the same way the desktop does
                instead of giving a picture the whole width and pushing the
                record down. `min-w-0` on the text side is what lets the badges
                wrap inside the card rather than widening it. A tool without a
                picture keeps the icon tile, at the same size. */}
            <div className="mb-4 flex items-start gap-3">
              <ToolImage
                tool={tool}
                rounded="rounded-xl"
                className="h-20 w-20 border sm:h-24 sm:w-24"
                alt={`Picture of ${tool.name}`}
              />
              {/* The space beside the thumbnail carries the badges and the
                  three fields that identify the tool, so the column is used
                  rather than left blank and the grid below starts shorter. */}
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={tool.status} />
                  <ConditionBadge condition={tool.condition} />
                  <span
                    className="badge border-transparent"
                    style={{ background: 'rgb(var(--surface-3))', color: 'rgb(var(--text-muted))' }}
                  >
                    {tool.category}
                  </span>
                </div>
                {/* Two up on a phone with Model on its own line beneath, three
                    across from `sm` where the row has the width for it. */}
                {/* `min-w-0` on each cell: a grid item sizes to its content by
                    default, so without it a long brand or model name widens the
                    row instead of ellipsing inside it. */}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                  <DetailItem label="Tool ID" className="min-w-0" mono>
                    <span className="block truncate">{tool.id}</span>
                  </DetailItem>
                  <DetailItem label="Brand" className="min-w-0">
                    <span className="block truncate">{tool.brand || '—'}</span>
                  </DetailItem>
                  <DetailItem label="Model" className="col-span-2 min-w-0 sm:col-span-1">
                    <span className="block truncate">{tool.model || '—'}</span>
                  </DetailItem>
                </dl>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {showSerial && (
                <DetailItem label="Serial number" className="min-w-0" mono>
                  <span className="block truncate">{tool.serialNumber || '—'}</span>
                </DetailItem>
              )}
              <DetailItem label="Location" className="col-span-2 min-w-0 sm:col-span-1">
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{tool.location}</span>
                </span>
              </DetailItem>
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
          </SectionCard>

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
                <Link to={`/tools/${tool.id}/history`} className="btn btn-ghost btn-sm">
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
        </div>
      </div>

      <ToolForm open={editing} tool={tool} onClose={() => setEditing(false)} />
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
function ToolLocationCheckpoint({ loan, actor, onRecorded }) {
  const toast = useToast()
  const { location: reading, failure: locationFailure, ensure: ensureLocation } = useAutoLocation()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  // The loan as last written, so a checkpoint appears in the list immediately
  // rather than waiting for the next refresh of the tool's transactions.
  const [record, setRecord] = useState(loan)

  const checkpoints = txnService.checkpointsOf(record)

  // Where this loan says the tool actually is — the borrower's own last
  // recorded point for this tool, resolved from the loan rather than typed in
  // or defaulted. Null when the loan has none, which is a state, not a value.
  const known = txnService.lastKnownLocation(record)

  /**
   * Save a checkpoint from a reading this device has just taken.
   *
   * The capture happens here rather than behind a button of its own, so the
   * point saved is the one the device could see at the moment of saving.
   */
  const saveCurrent = async () => {
    setSaving(true)
    try {
      const location = await ensureLocation()
      if (!location) {
        toast.error(
          locationFailure?.message ?? 'No location fix was available, so nothing was recorded.',
        )
        return
      }
      // The device's own timestamp for the fix is kept, not replaced with the
      // moment of saving: a checkpoint means "the tool was here, then", and the
      // age shown against it has to be the age of the reading.
      await save(
        {
          lat: location.lat,
          lng: location.lng,
          accuracy: location.accuracy ?? null,
          capturedAt: location.capturedAt,
        },
        note,
      )
    } finally {
      setSaving(false)
    }
  }

  const save = async (location, noteText = note) => {
    if (!location) return
    setSaving(true)
    try {
      const updated = await txnService.addLocationCheckpoint(
        { transactionId: record.id, location, note: noteText },
        actor,
      )
      setRecord(updated)
      setNote('')
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

  return (
    <SectionCard
      title="Confirm current tool location"
      description="Record where this tool is right now, while it is still out"
    >
      <p className="muted text-xs leading-relaxed">
        This is optional and entirely manual. Nothing is captured until you press the button, and
        each reading is stored on its own with the time it was taken — the app does not follow the
        tool or you in between.
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
            <button
              type="button"
              // Coordinates only, deliberately: confirming is an act happening
              // now, by whoever pressed it, so the new checkpoint is stamped
              // with this moment rather than inheriting the older reading's
              // time and capturer.
              onClick={() =>
                save(
                  { lat: known.lat, lng: known.lng, accuracy: known.accuracy ?? null },
                  note,
                )
              }
              className="btn btn-outline btn-sm mt-3 w-full"
              disabled={saving}
            >
              {saving ? <Spinner /> : <MapPin className="h-4 w-4" />}
              Confirm the tool is still here
            </button>
          </>
        ) : (
          <p className="muted mt-1.5 text-xs leading-relaxed">
            Nothing has been recorded for this loan yet. Capturing a location is optional, so a loan
            where none was taken — or where permission was refused — simply has none. Take a reading
            below to record the first one.
          </p>
        )}
      </div>

      <div className="mt-3 space-y-3">
        <TextField
          label="What is it being used for here? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Engine bay 3, brake bleed practical"
        />
        <button
          type="button"
          onClick={saveCurrent}
          className="btn btn-primary w-full"
          disabled={saving}
        >
          {saving ? <Spinner /> : <MapPin className="h-4 w-4" />}
          {saving ? 'Saving checkpoint…' : 'Save location checkpoint'}
        </button>
        <AutoLocationNotice location={reading} failure={locationFailure} />
      </div>

      {checkpoints.length > 0 && (
        <div className="mt-4 border-t pt-4">
          <LocationTrail transaction={record} />
        </div>
      )}
    </SectionCard>
  )
}
