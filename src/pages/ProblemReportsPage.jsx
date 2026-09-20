import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Flag, PlayCircle, XCircle } from 'lucide-react'
import {
  ConfirmDialog,
  DetailItem,
  EmptyState,
  ErrorState,
  FilterSelect,
  MaintenanceStatusBadge,
  MobileFilterBar,
  Modal,
  RoleBadge,
  SearchInput,
  SectionCard,
  SkeletonRows,
  Spinner,
  TableWrap,
} from '../components/ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useDebounced, useProblemReports } from '../hooks'
import * as maintenanceService from '../services/maintenance'
import { PERM } from '../utils/permissions'
import { MAINTENANCE_STATUS, MAINTENANCE_STATUSES, ROLE } from '../utils/constants'
import { matchesQuery } from '../utils/helpers'
import { formatDate, formatDateTime } from '../utils/dates'

/**
 * Staff's view of the problems users have filed through "Report a problem".
 *
 * A report is a corrective maintenance record — see `maintenanceService.isReport()`
 * — so this page is a filtered, report-shaped read of the same `maintenance`
 * collection `MaintenancePage` already lists and manages. Nothing is
 * duplicated: status changes go through the same `complete()` / `cancel()`
 * (and the new `start()`) functions, gated by the same `MAINTENANCE_MANAGE`
 * permission, so a report and an ordinary service job are one queue worked
 * from two screens.
 */

const SORTS = {
  newest: (a, b) => new Date(b.date) - new Date(a.date),
  oldest: (a, b) => new Date(a.date) - new Date(b.date),
  status: (a, b) => a.status.localeCompare(b.status),
}

const ROLE_OPTIONS = [
  { value: 'all', label: 'All roles' },
  { value: ROLE.STUDENT, label: 'Student' },
  { value: ROLE.INSTRUCTOR, label: 'Instructor' },
  { value: ROLE.ADMIN, label: 'Admin' },
]

/** The reporter name, role and description, read back out of `notes`. */
function reportOf(record) {
  return (
    maintenanceService.parseReport(record) ?? {
      reporterName: record.createdByName || 'Unknown',
      reporterRole: 'Unknown',
      description: record.notes ?? '',
    }
  )
}

export default function ProblemReportsPage() {
  const { user, can } = useApp()
  const toast = useToast()
  const { reports, loading, error, reload } = useProblemReports()

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 200)
  const [status, setStatus] = useState('all')
  const [role, setRole] = useState('all')
  const [sort, setSort] = useState('newest')
  const [selected, setSelected] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  const canManage = can(PERM.MAINTENANCE_MANAGE)

  const rows = useMemo(
    () =>
      reports.map((record) => ({ record, ...reportOf(record) })),
    [reports],
  )

  const filtered = useMemo(() => {
    const next = rows.filter(({ record, reporterName, description }) => {
      if (status !== 'all' && record.status !== status) return false
      if (role !== 'all' && record.reporterRole !== role) return false
      if (
        debouncedSearch &&
        !matchesQuery({ title: record.toolName, description, reporterName }, debouncedSearch, [
          'title',
          'description',
          'reporterName',
        ])
      ) {
        return false
      }
      return true
    })
    return [...next].sort((a, b) => SORTS[sort](a.record, b.record))
  }, [rows, status, role, debouncedSearch, sort])

  const hasFilters = !!search || status !== 'all' || role !== 'all'
  const clearFilters = () => {
    setSearch('')
    setStatus('all')
    setRole('all')
  }

  const requestCancel = (record) =>
    setConfirm({
      title: 'Close this report without action?',
      message: `${record.toolName} is returned to the available pool without the problem being recorded as fixed.`,
      confirmLabel: 'Close report',
      onConfirm: async () => {
        setBusy(true)
        try {
          await maintenanceService.cancel(record.id, user)
          toast.success('Report closed.')
          setConfirm(null)
          setSelected(null)
        } catch (err) {
          toast.error(err.message ?? 'Unable to close the report.')
        } finally {
          setBusy(false)
        }
      },
    })

  const start = async (record) => {
    setBusy(true)
    try {
      await maintenanceService.start(record.id, user)
      toast.success('Report marked in progress.')
    } catch (err) {
      toast.error(err.message ?? 'Unable to update the report.')
    } finally {
      setBusy(false)
    }
  }

  const resolve = async (record) => {
    setBusy(true)
    try {
      await maintenanceService.complete(record.id, user, {})
      toast.success('Report resolved. The tool is back in service.', { title: 'Resolved' })
      setSelected(null)
    } catch (err) {
      toast.error(err.message ?? 'Unable to resolve the report.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <div className="card p-3">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Search reports…"
                />
              </div>
              <div className="sm:hidden">
                <MobileFilterBar
                  iconOnly
                  filters={[
                    {
                      key: 'status',
                      label: 'Status',
                      value: status,
                      onChange: setStatus,
                      options: [{ value: 'all', label: 'All statuses' }, ...MAINTENANCE_STATUSES],
                    },
                    {
                      key: 'role',
                      label: 'Reporter role',
                      value: role,
                      onChange: setRole,
                      options: ROLE_OPTIONS,
                    },
                  ]}
                  hasFilters={hasFilters}
                  onClear={clearFilters}
                />
              </div>
            </div>

            <div className="no-scrollbar -mx-1 hidden gap-2 overflow-x-auto px-1 pb-0.5 sm:flex">
              <FilterSelect
                label="Status"
                value={status}
                onChange={setStatus}
                options={[{ value: 'all', label: 'All statuses' }, ...MAINTENANCE_STATUSES]}
              />
              <FilterSelect label="Reporter role" value={role} onChange={setRole} options={ROLE_OPTIONS} />
              <FilterSelect
                label="Sort"
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'newest', label: 'Newest first' },
                  { value: 'oldest', label: 'Oldest first' },
                  { value: 'status', label: 'By status' },
                ]}
              />
            </div>
          </div>
        </div>

        <SectionCard
          title={`${filtered.length} problem report${filtered.length === 1 ? '' : 's'}`}
          bodyClassName="p-0"
        >
          {error ? (
            <ErrorState
              title="Reports could not be loaded"
              description={error.message}
              onRetry={reload}
            />
          ) : loading && !reports.length ? (
            <SkeletonRows rows={5} columns={4} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Flag}
              title="No problem reports yet"
              description="Problems reported by users will appear here."
            />
          ) : (
            <>
              {/* mobile */}
              <ul className="divide-y sm:hidden">
                {filtered.map(({ record, reporterName, reporterRole, description }) => (
                  <li key={record.id} className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSelected(record)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-bold">{record.toolName}</p>
                        <MaintenanceStatusBadge status={record.status} />
                      </div>
                      <p className="muted mt-1 line-clamp-2 text-xs">{description}</p>
                      <p className="subtle mt-1.5 text-xs">
                        {reporterName} · {reporterRole} ·{' '}
                        <span className="mono">{formatDate(record.date)}</span>
                      </p>
                    </button>
                  </li>
                ))}
              </ul>

              {/* desktop */}
              <TableWrap className="hidden sm:block">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Report</th>
                      <th>Reported by</th>
                      <th>Role</th>
                      <th>Category</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th className="w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(({ record, reporterName, reporterRole, description }) => (
                      <tr key={record.id}>
                        <td className="max-w-xs">
                          <Link
                            to={`/tools/${record.toolId}`}
                            className="block truncate font-semibold hover:underline"
                          >
                            {record.toolName}
                          </Link>
                          <span className="subtle block truncate text-xs">{description}</span>
                        </td>
                        <td className="whitespace-nowrap text-xs">{reporterName}</td>
                        <td>
                          <RoleBadge role={reporterRole} />
                        </td>
                        <td className="whitespace-nowrap text-xs">{record.type}</td>
                        <td className="mono whitespace-nowrap text-xs">{formatDate(record.date)}</td>
                        <td>
                          <MaintenanceStatusBadge status={record.status} />
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => setSelected(record)}
                            className="btn btn-ghost btn-sm"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </>
          )}
        </SectionCard>
      </div>

      <ReportDetailModal
        record={selected}
        onClose={() => setSelected(null)}
        canManage={canManage}
        busy={busy}
        onStart={start}
        onResolve={resolve}
        onCancel={requestCancel}
      />

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

function ReportDetailModal({ record, onClose, canManage, busy, onStart, onResolve, onCancel }) {
  if (!record) return null
  const { reporterName, reporterRole, description } = reportOf(record)
  const open = record.status === MAINTENANCE_STATUS.SCHEDULED
  const inProgress = record.status === MAINTENANCE_STATUS.IN_PROGRESS
  const closed =
    record.status === MAINTENANCE_STATUS.COMPLETED || record.status === MAINTENANCE_STATUS.CANCELLED

  return (
    <Modal
      open={!!record}
      onClose={onClose}
      title="Problem report"
      description={record.toolName}
      size="md"
      footer={
        canManage &&
        !closed && (
          <>
            <button type="button" className="btn btn-outline" onClick={() => onCancel(record)} disabled={busy}>
              <XCircle className="h-4 w-4" />
              Close report
            </button>
            {open && (
              <button type="button" className="btn btn-outline" onClick={() => onStart(record)} disabled={busy}>
                <PlayCircle className="h-4 w-4" />
                Mark in progress
              </button>
            )}
            <button type="button" className="btn btn-success" onClick={() => onResolve(record)} disabled={busy}>
              {busy ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
              Resolve
            </button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <MaintenanceStatusBadge status={record.status} />
          <span className="subtle mono text-xs">{formatDateTime(record.date)}</span>
        </div>

        <div>
          <p className="subtle text-[11px] font-bold uppercase tracking-wider">Description</p>
          <p className="mt-1 text-sm leading-relaxed">{description || '—'}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <DetailItem label="Reported by">{reporterName}</DetailItem>
          <DetailItem label="Role">
            <RoleBadge role={reporterRole} />
          </DetailItem>
          <DetailItem label="Category">{record.type}</DetailItem>
          <DetailItem label="Related tool">
            <Link to={`/tools/${record.toolId}`} className="hover:underline">
              {record.toolName}
            </Link>
          </DetailItem>
        </div>

        {inProgress && (
          <p className="subtle text-xs leading-relaxed">
            This report is being worked on. Resolve it once the tool is fixed and back in service, or
            close it if no action is needed.
          </p>
        )}
      </div>
    </Modal>
  )
}
