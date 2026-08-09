import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
  LoadingBlock,
  MaintenanceStatusBadge,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '../components/ui'
import { QRCodePanel } from '../components/QRCodeDisplay'
import TransactionTable from '../components/TransactionTable'
import TransactionDetail from '../components/TransactionDetail'
import ToolForm from '../components/ToolForm'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useTool, useToolMaintenance, useToolTransactions } from '../hooks'
import * as toolService from '../services/tools'
import { PERM } from '../utils/permissions'
import { TOOL_STATUS, SERIAL_CRITICAL_CATEGORIES } from '../utils/constants'
import { cx } from '../utils/helpers'
import { daysBetween, dueLabel, formatDate } from '../utils/dates'

export default function ToolDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, can } = useApp()
  const toast = useToast()

  const { tool, loading } = useTool(id)
  const { transactions } = useToolTransactions(id)
  const { records: maintenanceRecords } = useToolMaintenance(id)

  const [editing, setEditing] = useState(false)
  const [selectedTxn, setSelectedTxn] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  if (loading && !tool) return <LoadingBlock label="Loading tool record…" />

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
      message: `${tool.id} will be removed from the inventory and its QR code will stop resolving. This cannot be undone.`,
      confirmLabel: 'Delete tool',
      onConfirm: async ({ force } = {}) => {
        setBusy(true)
        try {
          await toolService.remove(tool.id, user, { force })
          toast.success(`${tool.name} was deleted.`)
          navigate('/tools', { replace: true })
        } catch (err) {
          if (err.name === 'ActiveTransactionError') {
            setConfirm((c) => ({
              ...c,
              title: 'This tool is still on loan',
              message: err.message,
              confirmLabel: 'Delete anyway',
              force: true,
            }))
          } else {
            toast.error(err.message ?? 'Unable to delete the tool.')
          }
        } finally {
          setBusy(false)
        }
      },
    })

  return (
    <>
      <Link
        to="/tools"
        className="muted mb-3 inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to inventory
      </Link>

      <PageHeader title={tool.name} description={`${tool.category} · ${tool.brand || 'Unbranded'}`}>
        {eligibility.ok && can(PERM.BORROW) && (
          <Link to={`/borrow?tool=${tool.id}`} className="btn btn-primary">
            <ArrowRight className="h-4 w-4" />
            Borrow tool
          </Link>
        )}
        {activeLoan && can(PERM.RETURN) && (
          <Link to={`/return?tool=${tool.id}`} className="btn btn-success">
            <Undo2 className="h-4 w-4" />
            Return tool
          </Link>
        )}
        {can(PERM.TOOL_EDIT) && (
          <button type="button" onClick={() => setEditing(true)} className="btn btn-outline">
            <Pencil className="h-4 w-4" />
            Edit tool
          </button>
        )}
        <Link to={`/tools/${tool.id}/history`} className="btn btn-outline">
          <History className="h-4 w-4" />
          View history
        </Link>
      </PageHeader>

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
          <SectionCard title="Tool record">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={tool.status} />
              <ConditionBadge condition={tool.condition} />
              <span
                className="badge border-transparent"
                style={{ background: 'rgb(var(--surface-3))', color: 'rgb(var(--text-muted))' }}
              >
                {tool.category}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <DetailItem label="Tool ID" mono>
                {tool.id}
              </DetailItem>
              <DetailItem label="Brand">{tool.brand || '—'}</DetailItem>
              <DetailItem label="Model">{tool.model || '—'}</DetailItem>
              {showSerial && (
                <DetailItem label="Serial number" mono>
                  {tool.serialNumber || '—'}
                </DetailItem>
              )}
              <DetailItem label="Location" className="col-span-2 sm:col-span-1">
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  {tool.location}
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

          <SectionCard
            title="Borrowing history"
            description={`${transactions.length} transaction${transactions.length === 1 ? '' : 's'} recorded`}
            bodyClassName="p-0"
            action={
              <Link to={`/tools/${tool.id}/history`} className="btn btn-ghost btn-sm">
                Full timeline
              </Link>
            }
          >
            <TransactionTable
              transactions={transactions}
              onSelect={setSelectedTxn}
              emptyTitle="This tool has not been borrowed yet."
              emptyDescription="Issue it from the borrow desk or by scanning its QR code."
              compact={false}
            />
          </SectionCard>

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
        </div>

        {/* ------------------------------ side column ------------------------------ */}
        <div className="space-y-4">
          <SectionCard title="QR code" description="Printed label for this tool">
            <QRCodePanel tool={tool} size={190} />
          </SectionCard>

          {can(PERM.TOOL_STATUS) && (
            <SectionCard title="Tool status" description="Take the tool in or out of service">
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

          <SectionCard title="Where it lives" description="Laboratory storage">
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
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm?.onConfirm?.({ force: confirm.force })}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
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
