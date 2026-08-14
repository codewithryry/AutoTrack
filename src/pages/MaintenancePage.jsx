import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarClock,
  CheckCircle2,
  HardHat,
  Plus,
  Wrench,
  XCircle,
} from 'lucide-react'
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterSelect,
  MaintenanceStatusBadge,
  Modal,
  PageHeader,
  SearchInput,
  SectionCard,
  SelectField,
  SkeletonRows,
  Spinner,
  TableWrap,
  TextAreaField,
  TextField,
} from '../components/ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useDebounced, useMaintenance, useTools, useUpcomingMaintenance } from '../hooks'
import * as maintenanceService from '../services/maintenance'
import { ValidationError } from '../services/tools'
import { PERM } from '../utils/permissions'
import {
  CONDITIONS,
  MAINTENANCE_STATUS,
  MAINTENANCE_STATUSES,
  MAINTENANCE_TYPES,
  TOOL_STATUS,
} from '../utils/constants'
import { cx, formatCurrency } from '../utils/helpers'
import { addDaysISO, fromDateInput, toDateInput, todayInput } from '../utils/dates'
import { formatDate } from '../utils/dates'

export default function MaintenancePage() {
  const { user, can, settings } = useApp()
  const toast = useToast()
  const { records, loading, error, reload } = useMaintenance()
  const { tools } = useTools()
  const { upcoming } = useUpcomingMaintenance(45)

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 200)
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')

  const [formOpen, setFormOpen] = useState(false)
  const [presetTool, setPresetTool] = useState('')
  const [completing, setCompleting] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  const canManage = can(PERM.MAINTENANCE_MANAGE)

  const filtered = useMemo(
    () => maintenanceService.filterRecords(records, { search: debouncedSearch, status, type }),
    [records, debouncedSearch, status, type],
  )

  const stats = useMemo(
    () => ({
      open: records.filter(
        (r) =>
          r.status === MAINTENANCE_STATUS.SCHEDULED ||
          r.status === MAINTENANCE_STATUS.IN_PROGRESS,
      ).length,
      completed: records.filter((r) => r.status === MAINTENANCE_STATUS.COMPLETED).length,
      cost: records.reduce((sum, r) => sum + (Number(r.cost) || 0), 0),
      due: upcoming.filter((row) => row.daysUntil <= 0).length,
    }),
    [records, upcoming],
  )

  const openScheduler = (toolId = '') => {
    setPresetTool(toolId)
    setFormOpen(true)
  }

  const requestCancel = (record) =>
    setConfirm({
      title: `Cancel ${record.type.toLowerCase()} maintenance?`,
      message: `${record.toolName} will be returned to the available pool without the work being recorded as complete.`,
      confirmLabel: 'Cancel job',
      onConfirm: async () => {
        setBusy(true)
        try {
          await maintenanceService.cancel(record.id, user)
          toast.success('Maintenance job cancelled.')
          setConfirm(null)
        } catch (err) {
          toast.error(err.message ?? 'Unable to cancel the job.')
        } finally {
          setBusy(false)
        }
      },
    })

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Service, calibration and repair records for laboratory equipment."
        icon={HardHat}
      >
        {canManage && (
          <button type="button" onClick={() => openScheduler()} className="btn btn-primary">
            <Plus className="h-4 w-4" />
            Schedule maintenance
          </button>
        )}
      </PageHeader>

      {/* -------------------------------- summary -------------------------------- */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Open jobs" value={stats.open} tone="text-orange-600 dark:text-orange-400" />
        <Tile label="Completed" value={stats.completed} tone="text-emerald-600 dark:text-emerald-400" />
        <Tile label="Service due" value={stats.due} tone="text-red-600 dark:text-red-400" />
        <Tile label="Total cost" value={formatCurrency(stats.cost)} small />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ------------------------------ records ------------------------------ */}
        <div className="space-y-4 xl:col-span-2">
          <div className="card p-3">
            <div className="space-y-3">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search by tool, technician or notes…"
              />
              <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
                <FilterSelect
                  label="Status"
                  value={status}
                  onChange={setStatus}
                  options={[{ value: 'all', label: 'All statuses' }, ...MAINTENANCE_STATUSES]}
                />
                <FilterSelect
                  label="Type"
                  value={type}
                  onChange={setType}
                  options={[{ value: 'all', label: 'All types' }, ...MAINTENANCE_TYPES]}
                />
              </div>
            </div>
          </div>

          <SectionCard
            title={`${filtered.length} maintenance record${filtered.length === 1 ? '' : 's'}`}
            bodyClassName="p-0"
          >
            {error ? (
              <ErrorState
                title="Maintenance records could not be loaded"
                description={error.message}
                onRetry={reload}
              />
            ) : loading && !records.length ? (
              <SkeletonRows rows={5} columns={4} />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={HardHat}
                title="No maintenance records."
                description="Schedule a service job to start tracking calibration and repairs."
                action={
                  canManage ? (
                    <button
                      type="button"
                      onClick={() => openScheduler()}
                      className="btn btn-primary"
                    >
                      <Plus className="h-4 w-4" />
                      Schedule maintenance
                    </button>
                  ) : null
                }
              />
            ) : (
              <>
                {/* mobile */}
                <ul className="divide-y sm:hidden">
                  {filtered.map((record) => (
                    <li key={record.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            to={`/tools/${record.toolId}`}
                            className="block truncate text-sm font-bold hover:underline"
                          >
                            {record.toolName}
                          </Link>
                          <p className="subtle text-xs">
                            {record.type} · {record.technician}
                          </p>
                        </div>
                        <MaintenanceStatusBadge status={record.status} />
                      </div>
                      <p className="subtle mono mt-1 text-xs">
                        {formatDate(record.date)}
                        {record.cost > 0 && ` · ${formatCurrency(record.cost)}`}
                      </p>
                      {record.notes && <p className="muted mt-1 text-xs">{record.notes}</p>}
                      {canManage && record.status !== MAINTENANCE_STATUS.COMPLETED && (
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setCompleting(record)}
                            className="btn btn-success btn-sm flex-1"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Complete
                          </button>
                          <button
                            type="button"
                            onClick={() => requestCancel(record)}
                            className="btn btn-outline btn-sm"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                {/* desktop */}
                <TableWrap className="hidden sm:block">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Tool</th>
                        <th>Type</th>
                        <th>Date</th>
                        <th>Technician</th>
                        <th>Cost</th>
                        <th>Status</th>
                        {canManage && <th className="w-32" />}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((record) => (
                        <tr key={record.id}>
                          <td>
                            <Link
                              to={`/tools/${record.toolId}`}
                              className="block min-w-0 hover:underline"
                            >
                              <span className="block truncate font-semibold">
                                {record.toolName}
                              </span>
                              <span className="subtle mono block text-xs">{record.toolId}</span>
                            </Link>
                          </td>
                          <td className="whitespace-nowrap text-xs">{record.type}</td>
                          <td className="mono whitespace-nowrap text-xs">
                            {formatDate(record.date)}
                            {record.nextDate && (
                              <span className="subtle block">
                                next {formatDate(record.nextDate)}
                              </span>
                            )}
                          </td>
                          <td className="truncate text-xs">{record.technician}</td>
                          <td className="mono whitespace-nowrap text-xs">
                            {formatCurrency(record.cost)}
                          </td>
                          <td>
                            <MaintenanceStatusBadge status={record.status} />
                          </td>
                          {canManage && (
                            <td>
                              {record.status !== MAINTENANCE_STATUS.COMPLETED &&
                                record.status !== MAINTENANCE_STATUS.CANCELLED && (
                                  <div className="flex justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setCompleting(record)}
                                      className="btn btn-ghost btn-sm"
                                    >
                                      Complete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => requestCancel(record)}
                                      className="btn btn-ghost btn-icon text-red-600 dark:text-red-400"
                                      aria-label="Cancel job"
                                    >
                                      <XCircle className="h-4 w-4" />
                                    </button>
                                  </div>
                                )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </>
            )}
          </SectionCard>
        </div>

        {/* ------------------------------ upcoming ------------------------------ */}
        <SectionCard
          title="Service schedule"
          description="Tools approaching their next maintenance date"
          bodyClassName="p-0"
        >
          {upcoming.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nothing due soon."
              description="No tool reaches its service date in the next 45 days."
              compact
            />
          ) : (
            <ul className="divide-y">
              {upcoming.map(({ tool, daysUntil }) => (
                <li key={tool.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={cx(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                      daysUntil <= 0 ? 'bg-red-500/12' : 'bg-orange-500/12',
                    )}
                  >
                    <Wrench
                      className={cx(
                        'h-4 w-4',
                        daysUntil <= 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-orange-600 dark:text-orange-400',
                      )}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/tools/${tool.id}`}
                      className="block truncate text-sm font-semibold hover:underline"
                    >
                      {tool.name}
                    </Link>
                    <p className="subtle mono truncate text-xs">
                      {formatDate(tool.nextMaintenanceDate)}
                    </p>
                  </div>
                  {canManage && tool.status !== TOOL_STATUS.MAINTENANCE ? (
                    <button
                      type="button"
                      onClick={() => openScheduler(tool.id)}
                      className="btn btn-outline btn-sm shrink-0"
                    >
                      Schedule
                    </button>
                  ) : (
                    <span className="badge shrink-0 border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300">
                      In service
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <MaintenanceForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        tools={tools}
        presetTool={presetTool}
        user={user}
        intervalDays={settings.maintenanceIntervalDays}
      />

      <CompleteDialog
        record={completing}
        onClose={() => setCompleting(null)}
        user={user}
        intervalDays={settings.maintenanceIntervalDays}
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

function Tile({ label, value, tone, small }) {
  return (
    <div className="card p-3">
      <p className="subtle text-[11px] font-bold uppercase tracking-wider">{label}</p>
      <p
        className={cx(
          'mono mt-1 font-extrabold leading-none',
          small ? 'text-lg' : 'text-2xl',
          tone,
        )}
      >
        {value}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Scheduling form
 * ------------------------------------------------------------------ */

function MaintenanceForm({ open, onClose, tools, presetTool, user, intervalDays }) {
  const toast = useToast()
  const [form, setForm] = useState(null)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setForm({
      toolId: presetTool ?? '',
      type: 'Preventive',
      technician: '',
      date: todayInput(),
      nextDate: toDateInput(addDaysISO(new Date(), intervalDays)),
      cost: '',
      notes: '',
      status: MAINTENANCE_STATUS.SCHEDULED,
    })
  }, [open, presetTool, intervalDays])

  if (!form) return null

  const setField = (field) => (event) => {
    const value = event?.target ? event.target.value : event
    setForm((f) => ({ ...f, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const record = await maintenanceService.schedule(
        {
          ...form,
          date: fromDateInput(form.date),
          nextDate: fromDateInput(form.nextDate),
        },
        user,
      )
      toast.success(`${record.toolName} scheduled for ${record.type.toLowerCase()} maintenance.`)
      onClose()
    } catch (err) {
      if (err instanceof ValidationError) {
        setErrors(err.errors)
        toast.error('Please correct the highlighted fields.')
      } else {
        toast.error(err.message ?? 'Unable to schedule the maintenance.')
      }
    } finally {
      setSaving(false)
    }
  }

  const eligible = tools.filter(
    (t) => t.status !== TOOL_STATUS.BORROWED && t.status !== TOOL_STATUS.OVERDUE,
  )

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="Schedule maintenance"
      description="The tool is taken out of circulation until the job is completed."
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form="maintenance-form"
            className="btn btn-primary"
            disabled={saving}
          >
            {saving && <Spinner />}
            Schedule job
          </button>
        </>
      }
    >
      <form id="maintenance-form" onSubmit={submit} className="space-y-4" noValidate>
        <SelectField
          label="Tool"
          required
          value={form.toolId}
          onChange={setField('toolId')}
          options={eligible.map((t) => ({ value: t.id, label: `${t.name} — ${t.id}` }))}
          placeholder="Select a tool"
          error={errors.toolId}
          hint="Tools currently on loan cannot be scheduled until they are returned."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Maintenance type"
            required
            value={form.type}
            onChange={setField('type')}
            options={MAINTENANCE_TYPES}
            error={errors.type}
          />
          <SelectField
            label="Status"
            value={form.status}
            onChange={setField('status')}
            options={[
              MAINTENANCE_STATUS.SCHEDULED,
              MAINTENANCE_STATUS.IN_PROGRESS,
              MAINTENANCE_STATUS.COMPLETED,
            ]}
            error={errors.status}
          />
        </div>

        <TextField
          label="Technician"
          required
          value={form.technician}
          onChange={setField('technician')}
          error={errors.technician}
          placeholder="Who is carrying out the work"
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Maintenance date"
            type="date"
            required
            value={form.date}
            onChange={setField('date')}
            error={errors.date}
          />
          <TextField
            label="Next service"
            type="date"
            value={form.nextDate}
            onChange={setField('nextDate')}
            error={errors.nextDate}
          />
          <TextField
            label="Cost"
            type="number"
            min="0"
            step="0.01"
            value={form.cost}
            onChange={setField('cost')}
            error={errors.cost}
            placeholder="0.00"
          />
        </div>

        <TextAreaField
          label="Notes"
          value={form.notes}
          onChange={setField('notes')}
          placeholder="Work to be carried out, parts required, calibration reference…"
          rows={3}
        />
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 * Completion dialog
 * ------------------------------------------------------------------ */

function CompleteDialog({ record, onClose, user, intervalDays }) {
  const toast = useToast()
  const [condition, setCondition] = useState('Good')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (record) {
      setCondition('Good')
      setNotes('')
    }
  }, [record])

  if (!record) return null

  const submit = async () => {
    setSaving(true)
    try {
      await maintenanceService.complete(record.id, user, {
        conditionAfter: condition,
        notes,
        intervalDays,
      })
      toast.success(`${record.toolName} returned to service.`, { title: 'Maintenance completed' })
      onClose()
    } catch (err) {
      toast.error(err.message ?? 'Unable to complete the maintenance.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={!!record}
      onClose={saving ? undefined : onClose}
      title="Complete maintenance"
      description={`${record.toolName} · ${record.type}`}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-success" onClick={submit} disabled={saving}>
            {saving ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
            Complete and release
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="muted text-sm leading-relaxed">
          The tool returns to the available pool and its next service date rolls forward by{' '}
          {intervalDays} days.
        </p>
        <SelectField
          label="Condition after service"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          options={CONDITIONS}
        />
        <TextAreaField
          label="Completion notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Work carried out, parts replaced, calibration result…"
          rows={3}
        />
      </div>
    </Modal>
  )
}
