import * as db from './db'
import { COLLECTIONS } from './db'
import * as activity from './activity'
import * as notifications from './notifications'
import {
  ACTIVITY,
  ACTIVE_TXN_STATUSES,
  CATEGORIES,
  CONDITION,
  CONDITIONS,
  LOCATIONS,
  NON_BORROWABLE_REASON,
  TOOL_STATUS,
  TOOL_STATUSES,
} from '../utils/constants'
import { PERM, assertCan } from '../utils/permissions'
import { matchesQuery, padId, sortBy } from '../utils/helpers'
import { nowISO, toDate } from '../utils/dates'
import { buildQRPayload } from '../utils/qr'

/**
 * Tool inventory service. Owns tool identity (ids and QR codes), validation,
 * and every status transition. Components call these functions; they never
 * write to the tools collection themselves.
 */

export class ValidationError extends Error {
  constructor(errors, message = 'Please correct the highlighted fields.') {
    super(message)
    this.name = 'ValidationError'
    this.errors = errors // { field: 'message' }
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listAll() {
  return sortBy(await db.list(COLLECTIONS.tools), 'id')
}

export async function getById(id) {
  return db.get(COLLECTIONS.tools, id)
}

/** Look up by id or by QR payload — the scanner path. */
export async function findByQR(toolId) {
  return getById(String(toolId ?? '').toUpperCase())
}

export async function listAvailable() {
  return (await listAll()).filter((t) => t.status === TOOL_STATUS.AVAILABLE)
}

const SEARCH_FIELDS = [
  'id',
  'name',
  'category',
  'brand',
  'model',
  'serialNumber',
  'location',
  'description',
]

/**
 * Search + filter + sort in one place so the tools page, the borrow picker and
 * the reports module all behave identically.
 */
export function filterTools(tools, { search, status, category, condition, location, sort } = {}) {
  let rows = tools.filter((tool) => {
    if (status && status !== 'all' && tool.status !== status) return false
    if (category && category !== 'all' && tool.category !== category) return false
    if (condition && condition !== 'all' && tool.condition !== condition) return false
    if (location && location !== 'all' && tool.location !== location) return false
    return matchesQuery(tool, search, SEARCH_FIELDS)
  })

  switch (sort) {
    case 'name-desc':
      rows = sortBy(rows, 'name', 'desc')
      break
    case 'newest':
      rows = sortBy(rows, 'createdAt', 'desc')
      break
    case 'oldest':
      rows = sortBy(rows, 'createdAt', 'asc')
      break
    case 'status':
      rows = sortBy(rows, 'status', 'asc')
      break
    case 'category':
      rows = sortBy(rows, 'category', 'asc')
      break
    case 'id':
      rows = sortBy(rows, 'id', 'asc')
      break
    case 'name-asc':
    default:
      rows = sortBy(rows, 'name', 'asc')
  }
  return rows
}

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

/** Next free sequential tool id, e.g. `TOOL-00031`. */
export async function nextToolId() {
  const tools = await db.list(COLLECTIONS.tools)
  const highest = tools.reduce((max, tool) => {
    const n = Number(String(tool.id).replace(/^TOOL-/, ''))
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return padId('TOOL', highest + 1)
}

/* ------------------------------------------------------------------ *
 * Pictures
 * ------------------------------------------------------------------ */

/** Column added by `0011_tool_images.sql`. */
const IMAGE_COLUMN = 'imageUrl'

/**
 * Whether this database has had the tool-image migration applied.
 *
 * Until it has, the picture is skipped and every other part of adding or
 * editing a tool behaves exactly as it did before — an un-migrated project
 * loses the new field, never the working ones.
 */
export const toolImagesAvailable = () => db.supportsColumn(COLLECTIONS.tools, IMAGE_COLUMN)

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export async function validate(input, { isEdit = false } = {}) {
  const errors = {}

  if (!input.name?.trim()) errors.name = 'Tool name is required.'
  else if (input.name.trim().length < 2) errors.name = 'Tool name is too short.'

  if (!input.category) errors.category = 'Select a category.'
  else if (!CATEGORIES.includes(input.category)) errors.category = 'Unknown category.'

  if (!input.location?.trim()) errors.location = 'Storage location is required.'

  if (!input.condition) errors.condition = 'Select a condition.'
  else if (!CONDITIONS.includes(input.condition)) errors.condition = 'Unknown condition.'

  if (input.status && !TOOL_STATUSES.includes(input.status)) errors.status = 'Unknown status.'

  if (!isEdit) {
    if (!input.id?.trim()) {
      errors.id = 'Tool ID is required.'
    } else if (!/^TOOL-\d{5,}$/i.test(input.id.trim())) {
      errors.id = 'Tool ID must look like TOOL-00001.'
    } else if (await db.exists(COLLECTIONS.tools, input.id.trim().toUpperCase())) {
      errors.id = 'That Tool ID already exists. Every QR code must be unique.'
    }
  }

  // Serial numbers must stay unique across the inventory — diagnostic and
  // electrical equipment is tracked by serial for warranty and calibration.
  const serial = input.serialNumber?.trim()
  if (serial) {
    const clash = (await db.list(COLLECTIONS.tools)).find(
      (t) => t.serialNumber?.trim().toLowerCase() === serial.toLowerCase() && t.id !== input.id,
    )
    if (clash) errors.serialNumber = `Serial number already used by ${clash.id}.`
  }

  const purchase = toDate(input.purchaseDate)
  const lastMaint = toDate(input.lastMaintenanceDate)
  const nextMaint = toDate(input.nextMaintenanceDate)

  if (input.purchaseDate && !purchase) errors.purchaseDate = 'Enter a valid date.'
  if (purchase && purchase > new Date()) errors.purchaseDate = 'Purchase date cannot be in the future.'
  if (lastMaint && purchase && lastMaint < purchase) {
    errors.lastMaintenanceDate = 'Maintenance cannot predate the purchase date.'
  }
  if (nextMaint && lastMaint && nextMaint < lastMaint) {
    errors.nextMaintenanceDate = 'Next maintenance must come after the last one.'
  }

  if (input.notes && input.notes.length > 1000) errors.notes = 'Notes are too long (max 1000).'

  // The picture is optional; when there is one it must be the storage URL the
  // upload returned, matching the column's own constraint.
  if (input.imageUrl != null && input.imageUrl !== '') {
    if (typeof input.imageUrl !== 'string' || !/^https?:\/\//i.test(input.imageUrl)) {
      errors.imageUrl = 'The tool image could not be read. Upload it again.'
    } else if (input.imageUrl.length > 2048) {
      errors.imageUrl = 'That image address is too long.'
    }
  }

  return errors
}

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */

export async function create(input, actor) {
  assertCan(actor, PERM.TOOL_CREATE, 'You are not allowed to add tools to the inventory.')

  const id = (input.id?.trim() || (await nextToolId())).toUpperCase()
  const draft = { ...input, id }
  const errors = await validate(draft)
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const timestamp = nowISO()
  const tool = {
    id,
    name: input.name.trim(),
    category: input.category,
    description: input.description?.trim() ?? '',
    brand: input.brand?.trim() ?? '',
    model: input.model?.trim() ?? '',
    serialNumber: input.serialNumber?.trim() ?? '',
    qrCode: buildQRPayload(id),
    location: input.location.trim(),
    condition: input.condition,
    status: input.status ?? TOOL_STATUS.AVAILABLE,
    // Set while the tool is out on loan; the security rules use it to let the
    // borrower return it themselves.
    currentBorrowerId: null,
    currentTransactionId: null,
    purchaseDate: input.purchaseDate ?? null,
    lastMaintenanceDate: input.lastMaintenanceDate ?? null,
    nextMaintenanceDate: input.nextMaintenanceDate ?? null,
    notes: input.notes?.trim() ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
    // Omitted entirely when the migration is not applied, so the insert never
    // names a column this database does not have.
    ...((await toolImagesAvailable()) ? { imageUrl: input.imageUrl ?? null } : {}),
  }

  await db.insert(COLLECTIONS.tools, tool)
  await activity.log({
    action: ACTIVITY.TOOL_CREATED,
    toolId: tool.id,
    toolName: tool.name,
    userId: actor?.id,
    userName: actor?.fullName,
    message: `${tool.name} was added to the inventory (${tool.location}).`,
  })
  return tool
}

export async function updateTool(id, input, actor) {
  assertCan(actor, PERM.TOOL_EDIT, 'You are not allowed to edit tool records.')

  const current = await getById(id)
  if (!current) throw new Error('Tool not found.')

  const errors = await validate({ ...current, ...input, id }, { isEdit: true })
  if (Object.keys(errors).length) throw new ValidationError(errors)

  // A tool that is out on loan cannot have its status edited by hand — that
  // would desynchronise the open transaction.
  const patch = { ...input }
  delete patch.id
  delete patch.createdAt
  delete patch.qrCode
  // Same rule as the insert: an un-migrated database keeps saving every other
  // field rather than failing on a column it does not have.
  if ('imageUrl' in patch && !(await toolImagesAvailable())) delete patch.imageUrl

  if (patch.status && patch.status !== current.status) {
    const active = await hasActiveTransaction(id)
    if (active && patch.status !== TOOL_STATUS.BORROWED && patch.status !== TOOL_STATUS.OVERDUE) {
      throw new Error(
        'This tool is currently on loan. Process the return before changing its status.',
      )
    }
  }

  const next = await db.update(COLLECTIONS.tools, id, { ...patch, updatedAt: nowISO() })

  const changes = describeChanges(current, next)
  await activity.log({
    action: ACTIVITY.TOOL_UPDATED,
    toolId: id,
    toolName: next.name,
    userId: actor?.id,
    userName: actor?.fullName,
    message: changes.length
      ? `Tool record updated — ${changes.join(', ')}.`
      : 'Tool record updated.',
    meta: { changes },
  })

  if (current.condition !== next.condition) {
    await activity.log({
      action: ACTIVITY.CONDITION_CHANGED,
      toolId: id,
      toolName: next.name,
      userId: actor?.id,
      userName: actor?.fullName,
      message: `Condition changed from ${current.condition} to ${next.condition}.`,
      meta: { from: current.condition, to: next.condition },
    })
  }
  if (current.status !== next.status) {
    await activity.log({
      action: ACTIVITY.STATUS_CHANGED,
      toolId: id,
      toolName: next.name,
      userId: actor?.id,
      userName: actor?.fullName,
      message: `Status changed from ${current.status} to ${next.status}.`,
      meta: { from: current.status, to: next.status },
    })
  }
  return next
}

const TRACKED_FIELDS = [
  ['name', 'name'],
  ['category', 'category'],
  ['brand', 'brand'],
  ['model', 'model'],
  ['serialNumber', 'serial number'],
  ['location', 'location'],
  ['condition', 'condition'],
  ['status', 'status'],
  ['description', 'description'],
  ['notes', 'notes'],
]

function describeChanges(before, after) {
  return TRACKED_FIELDS.filter(([key]) => (before[key] ?? '') !== (after[key] ?? '')).map(
    ([, label]) => label,
  )
}

export async function hasActiveTransaction(toolId) {
  const rows = await db.query(
    COLLECTIONS.transactions,
    (t) => t.toolId === toolId && ACTIVE_TXN_STATUSES.includes(t.status),
  )
  return rows.length > 0
}

/**
 * Delete a tool.
 *
 * A tool that is actively out on loan cannot be deleted: detaching an open
 * transaction would corrupt its history, so the caller is told to process the
 * return first. Historical records are never removed — the database detaches
 * their `toolId` reference on delete (`ON DELETE SET NULL`, migration 0009),
 * keeping the rows and their denormalised tool name, and the append-only
 * activity log keeps the audit trail. The QR code stops resolving because the
 * inventory row itself is gone.
 */
export async function remove(id, actor) {
  assertCan(actor, PERM.TOOL_DELETE, 'You are not allowed to delete tools.')

  const tool = await getById(id)
  if (!tool) throw new Error('Tool not found.')

  const active = await db.query(
    COLLECTIONS.transactions,
    (t) => t.toolId === id && ACTIVE_TXN_STATUSES.includes(t.status),
  )
  if (active.length) {
    const err = new Error(
      `${tool.name} is still on loan (${active.length} open transaction${
        active.length > 1 ? 's' : ''
      }) and cannot be deleted. Process the return first — deleting an actively borrowed tool would corrupt its history.`,
    )
    err.name = 'ActiveTransactionError'
    err.activeCount = active.length
    throw err
  }

  await notifications.removeForTool(id)
  await db.remove(COLLECTIONS.tools, id)
  await activity.log({
    action: ACTIVITY.TOOL_DELETED,
    toolId: id,
    toolName: tool.name,
    userId: actor?.id,
    userName: actor?.fullName,
    message: `${tool.name} (${id}) was removed from the inventory.`,
  })
  return true
}

/**
 * Explicit status transition used by "Mark for maintenance", "Mark damaged",
 * "Mark lost" and "Restore".
 */
export async function setStatus(id, status, actor, { note, condition } = {}) {
  assertCan(actor, PERM.TOOL_STATUS, 'You are not allowed to change tool status.')
  if (!TOOL_STATUSES.includes(status)) throw new Error(`Unknown status "${status}".`)

  const tool = await getById(id)
  if (!tool) throw new Error('Tool not found.')
  if (tool.status === status) return tool

  if (await hasActiveTransaction(id)) {
    throw new Error(
      `${tool.name} is currently on loan. Process the return before changing its status.`,
    )
  }

  const patch = { status, updatedAt: nowISO() }
  if (condition) patch.condition = condition
  if (note) patch.notes = [tool.notes, note].filter(Boolean).join('\n')

  const next = await db.update(COLLECTIONS.tools, id, patch)

  await activity.log({
    action: ACTIVITY.STATUS_CHANGED,
    toolId: id,
    toolName: tool.name,
    userId: actor?.id,
    userName: actor?.fullName,
    message: `Status changed from ${tool.status} to ${status}${note ? ` — ${note}` : ''}.`,
    meta: { from: tool.status, to: status },
  })

  if (status === TOOL_STATUS.MAINTENANCE) {
    await notifications.create(notifications.templates.maintenance(tool, { type: 'Preventive' }))
  } else if (status === TOOL_STATUS.DAMAGED || status === TOOL_STATUS.LOST) {
    await notifications.create(notifications.templates.statusChanged(tool, tool.status, status))
  }
  return next
}

/** Convenience wrappers used by the tool action menu. */
export const markMaintenance = (id, actor, note) =>
  setStatus(id, TOOL_STATUS.MAINTENANCE, actor, { note })

export const markDamaged = (id, actor, note) =>
  setStatus(id, TOOL_STATUS.DAMAGED, actor, { note, condition: CONDITION.DAMAGED })

export const markLost = (id, actor, note) => setStatus(id, TOOL_STATUS.LOST, actor, { note })

export const markRetired = (id, actor, note) => setStatus(id, TOOL_STATUS.RETIRED, actor, { note })

export const restore = (id, actor, note) =>
  setStatus(id, TOOL_STATUS.AVAILABLE, actor, { note, condition: CONDITION.GOOD })

/* ------------------------------------------------------------------ *
 * Borrow eligibility
 * ------------------------------------------------------------------ */

/** @returns {{ ok: boolean, reason?: string }} */
export function borrowEligibility(tool) {
  if (!tool) return { ok: false, reason: 'Tool not found. Please check the QR code.' }
  if (tool.status === TOOL_STATUS.AVAILABLE) return { ok: true }
  return { ok: false, reason: NON_BORROWABLE_REASON[tool.status] ?? 'This tool is unavailable.' }
}

export const LOCATION_OPTIONS = LOCATIONS
