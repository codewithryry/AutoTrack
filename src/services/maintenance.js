import * as db from './db'
import { COLLECTIONS } from './db'
import * as activity from './activity'
import * as notifications from './notifications'
import { ValidationError } from './tools'
import {
  ACTIVITY,
  CONDITION,
  MAINTENANCE_STATUS,
  MAINTENANCE_STATUSES,
  MAINTENANCE_TYPES,
  TOOL_STATUS,
} from '../utils/constants'
import { PERM, assertCan } from '../utils/permissions'
import { matchesQuery, sortBy, uid } from '../utils/helpers'
import { addDaysISO, daysBetween, nowISO, toDate } from '../utils/dates'
import { isReport, parseReport } from '../utils/problemReports'

/**
 * Maintenance tracking.
 *
 * Scheduling a job takes the tool out of circulation; completing it puts the
 * tool back and rolls the next service date forward by the interval configured
 * in settings. Both write to the same activity log the tool timeline renders.
 */

export async function listAll() {
  return sortBy(await db.list(COLLECTIONS.maintenance), 'date', 'desc')
}

// Whether a record is a problem report, and its reporter and description. The
// rule lives in `utils/problemReports` so TOBI's server functions read reports
// exactly the way the Report Problems page does.
export { isReport, parseReport }

/** Every maintenance record filed as a problem report, newest first. */
export async function listReports() {
  return (await listAll()).filter(isReport)
}

export async function getById(id) {
  return db.get(COLLECTIONS.maintenance, id)
}

export async function listForTool(toolId) {
  const rows = await db.query(COLLECTIONS.maintenance, (m) => m.toolId === toolId)
  return sortBy(rows, 'date', 'desc')
}

const SEARCH_FIELDS = ['id', 'toolId', 'toolName', 'technician', 'type', 'notes']

export function filterRecords(rows, { search, status, type, toolId } = {}) {
  return rows.filter((record) => {
    if (status && status !== 'all' && record.status !== status) return false
    if (type && type !== 'all' && record.type !== type) return false
    if (toolId && toolId !== 'all' && record.toolId !== toolId) return false
    return matchesQuery(record, search, SEARCH_FIELDS)
  })
}

export function validate(input) {
  const errors = {}
  if (!input.toolId) errors.toolId = 'Select a tool.'
  if (!input.type) errors.type = 'Select a maintenance type.'
  else if (!MAINTENANCE_TYPES.includes(input.type)) errors.type = 'Unknown maintenance type.'
  if (!input.technician?.trim()) errors.technician = 'Technician name is required.'
  if (!input.date) errors.date = 'Maintenance date is required.'
  else if (!toDate(input.date)) errors.date = 'Enter a valid date.'

  if (input.nextDate) {
    const next = toDate(input.nextDate)
    if (!next) errors.nextDate = 'Enter a valid date.'
    else if (toDate(input.date) && next < toDate(input.date)) {
      errors.nextDate = 'The next service must come after this one.'
    }
  }

  if (input.cost !== '' && input.cost != null) {
    const cost = Number(input.cost)
    if (!Number.isFinite(cost) || cost < 0) errors.cost = 'Enter a valid amount.'
  }

  if (input.status && !MAINTENANCE_STATUSES.includes(input.status)) {
    errors.status = 'Unknown status.'
  }
  return errors
}

/**
 * Schedule (or record) a maintenance job. Anything not already Completed pulls
 * the tool out of circulation so nobody borrows a spanner that is on the bench.
 */
export async function schedule(input, actor) {
  assertCan(actor, PERM.MAINTENANCE_MANAGE, 'You are not allowed to schedule maintenance.')

  const errors = validate(input)
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const tool = await db.get(COLLECTIONS.tools, input.toolId)
  if (!tool) throw new Error('Tool not found.')

  const openLoan = await db.query(
    COLLECTIONS.transactions,
    (t) => t.toolId === tool.id && (t.status === 'Borrowed' || t.status === 'Overdue'),
  )
  if (openLoan.length) {
    throw new Error(
      `${tool.name} is currently on loan to ${openLoan[0].userName}. Process the return first.`,
    )
  }

  const status = input.status ?? MAINTENANCE_STATUS.SCHEDULED
  const record = {
    id: uid('MNT'),
    toolId: tool.id,
    toolName: tool.name,
    type: input.type,
    technician: input.technician.trim(),
    date: input.date,
    nextDate: input.nextDate ?? null,
    cost: input.cost === '' || input.cost == null ? 0 : Number(input.cost),
    notes: input.notes?.trim() ?? '',
    status,
    createdById: actor?.id ?? null,
    createdByName: actor?.fullName ?? null,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }

  await db.insert(COLLECTIONS.maintenance, record)

  const toolPatch = { lastMaintenanceDate: record.date, updatedAt: nowISO() }
  if (record.nextDate) toolPatch.nextMaintenanceDate = record.nextDate

  if (status === MAINTENANCE_STATUS.COMPLETED) {
    toolPatch.status = TOOL_STATUS.AVAILABLE
    if (input.conditionAfter) toolPatch.condition = input.conditionAfter
  } else {
    toolPatch.status = TOOL_STATUS.MAINTENANCE
  }
  await db.update(COLLECTIONS.tools, tool.id, toolPatch)

  await activity.log({
    action:
      status === MAINTENANCE_STATUS.COMPLETED
        ? ACTIVITY.MAINTENANCE_COMPLETED
        : ACTIVITY.MAINTENANCE_SCHEDULED,
    toolId: tool.id,
    toolName: tool.name,
    userId: actor?.id,
    userName: actor?.fullName,
    message:
      status === MAINTENANCE_STATUS.COMPLETED
        ? `${record.type} maintenance completed by ${record.technician}.`
        : `Tool sent for ${record.type.toLowerCase()} maintenance (${record.technician}).`,
    meta: { maintenanceId: record.id, type: record.type, cost: record.cost },
  })

  if (status !== MAINTENANCE_STATUS.COMPLETED) {
    await notifications.create(notifications.templates.maintenance(tool, record))
  }
  return record
}

/** Move a job to Completed and return the tool to service. */
export async function complete(id, actor, { conditionAfter, notes, intervalDays = 90 } = {}) {
  assertCan(actor, PERM.MAINTENANCE_MANAGE, 'You are not allowed to update maintenance records.')

  const record = await getById(id)
  if (!record) throw new Error('Maintenance record not found.')
  if (record.status === MAINTENANCE_STATUS.COMPLETED) return record

  const completedAt = nowISO()
  const nextDate = record.nextDate ?? addDaysISO(completedAt, intervalDays)

  const updated = await db.update(COLLECTIONS.maintenance, id, {
    status: MAINTENANCE_STATUS.COMPLETED,
    completedAt,
    nextDate,
    notes: [record.notes, notes?.trim()].filter(Boolean).join(' — '),
    updatedAt: completedAt,
  })

  const tool = await db.get(COLLECTIONS.tools, record.toolId)
  if (tool) {
    await db.update(COLLECTIONS.tools, tool.id, {
      status: TOOL_STATUS.AVAILABLE,
      condition: conditionAfter ?? (tool.condition === CONDITION.DAMAGED ? CONDITION.GOOD : tool.condition),
      lastMaintenanceDate: completedAt,
      nextMaintenanceDate: nextDate,
      updatedAt: completedAt,
    })
    await activity.log({
      action: ACTIVITY.MAINTENANCE_COMPLETED,
      toolId: tool.id,
      toolName: tool.name,
      userId: actor?.id,
      userName: actor?.fullName,
      message: `Maintenance completed — tool returned to service.`,
      meta: { maintenanceId: id },
    })
  }
  return updated
}

/**
 * Mark a job as picked up — `Scheduled` to `In Progress`. The tool was already
 * pulled from circulation when the record was filed, so nothing about it
 * changes here; only the status a report shows staff have started on it.
 */
export async function start(id, actor) {
  assertCan(actor, PERM.MAINTENANCE_MANAGE, 'You are not allowed to update maintenance records.')

  const record = await getById(id)
  if (!record) throw new Error('Maintenance record not found.')
  if (record.status !== MAINTENANCE_STATUS.SCHEDULED) return record

  return db.update(COLLECTIONS.maintenance, id, {
    status: MAINTENANCE_STATUS.IN_PROGRESS,
    updatedAt: nowISO(),
  })
}

export async function cancel(id, actor) {
  assertCan(actor, PERM.MAINTENANCE_MANAGE, 'You are not allowed to update maintenance records.')

  const record = await getById(id)
  if (!record) throw new Error('Maintenance record not found.')

  const updated = await db.update(COLLECTIONS.maintenance, id, {
    status: MAINTENANCE_STATUS.CANCELLED,
    updatedAt: nowISO(),
  })

  const tool = await db.get(COLLECTIONS.tools, record.toolId)
  if (tool && tool.status === TOOL_STATUS.MAINTENANCE) {
    await db.update(COLLECTIONS.tools, tool.id, {
      status: TOOL_STATUS.AVAILABLE,
      updatedAt: nowISO(),
    })
  }
  return updated
}

export async function remove(id, actor) {
  assertCan(actor, PERM.MAINTENANCE_MANAGE, 'You are not allowed to delete maintenance records.')
  return db.remove(COLLECTIONS.maintenance, id)
}

/**
 * Tools whose next service date has arrived or is within `withinDays`.
 * Drives the dashboard's upcoming-maintenance panel.
 */
export async function upcoming(withinDays = 30) {
  const tools = await db.list(COLLECTIONS.tools)
  return tools
    .filter((t) => t.nextMaintenanceDate && t.status !== TOOL_STATUS.RETIRED)
    .map((t) => ({ tool: t, daysUntil: daysBetween(new Date(), t.nextMaintenanceDate) }))
    .filter((row) => row.daysUntil <= withinDays)
    .sort((a, b) => a.daysUntil - b.daysUntil)
}

/**
 * Report a problem with a tool.
 *
 * A report is a corrective maintenance record in `Scheduled` — the same shape
 * `schedule()` writes and the same row the service log already lists, so a
 * reported fault and a planned service are worked from one queue. Nothing new
 * was added to the data model for this.
 *
 * It goes through the `report_tool_problem` database function rather than a
 * direct insert, because `maintenance_insert` is staff-only and must stay that
 * way: the function is the narrow exception that lets a student file one, and it
 * fixes every field except the tool, the type and the description. See migration
 * `0034` for what it will and will not write.
 *
 * Staff are not routed around it — one path means one set of rules, and the
 * notification and audit rows are written the same way whoever reports.
 *
 * @returns {Promise<string>} the id of the maintenance record
 */
export async function reportProblem({ toolId, type, description }) {
  if (!toolId) throw new ValidationError({ toolId: 'No tool was identified.' })
  if (!type) throw new ValidationError({ type: 'Choose what kind of problem this is.' })
  if (!MAINTENANCE_TYPES.includes(type)) {
    throw new ValidationError({ type: 'Unknown maintenance type.' })
  }
  const details = String(description ?? '').trim()
  if (!details) throw new ValidationError({ description: 'Describe the problem.' })
  if (details.length > 500) {
    throw new ValidationError({ description: 'Keep the description under 500 characters.' })
  }

  return db.rpc('report_tool_problem', {
    p_tool_id: toolId,
    p_type: type,
    p_description: details,
  })
}

/** Raise a notification for anything already past its service date. */
export async function notifyDue() {
  const due = (await upcoming(0)).filter((row) => row.daysUntil <= 0)
  for (const { tool } of due) {
    if (tool.status === TOOL_STATUS.MAINTENANCE) continue
    await notifications.create(notifications.templates.maintenanceDue(tool))
  }
  return due.length
}
