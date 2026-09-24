/**
 * TOBI's functions — the only way the model reaches Tool Track data.
 *
 * The model never writes a query. It may call these functions by name, with
 * arguments that are validated here, and it sees only what they return. Three
 * layers decide what that is, none of them supplied by the browser:
 *
 *   1. `perm` — the same permission matrix the route guards use
 *      (`src/utils/permissions.js`). A function the caller's role lacks is not
 *      offered to the model at all, and is refused again if called anyway.
 *   2. `db` — a Supabase client carrying the caller's own session, so every read
 *      runs through the Row Level Security policies in `supabase/migrations`:
 *      a student's query physically cannot return another student's loan.
 *   3. "my" functions also filter on the caller's id explicitly, so they answer
 *      "my loans" even for staff, whose policies would let them read everyone's.
 *
 * Reads only. The state changes TOBI can help with — requesting a tool,
 * asking to return one, reporting a problem, and (staff) deciding a request —
 * are `prepare_*` functions: they check what they can and hand back a proposal.
 * The browser shows it as a confirmation card and, on "Continue", runs the
 * app's existing workflow (`requests.create()`, `requestReturn()`,
 * `reportProblem()`, `requests.approve()` / `reject()`), where the permission
 * and the database policies are checked again. Nothing here writes.
 *
 * `open_page` takes the user to a page from the role's own navigation list;
 * the route guards still decide whether the page opens.
 */

import { PERM, can } from '../../../src/utils/permissions.js'
import { lastKnownLocation } from '../../../src/utils/loanLocation.js'
import { isReport, parseReport } from '../../../src/utils/problemReports.js'
import {
  ACTIVE_TXN_STATUSES,
  MAINTENANCE_STATUSES,
  MAINTENANCE_TYPES,
  REQUEST_STATUSES,
  TOOL_STATUSES,
} from '../../../src/utils/constants.js'
import { NAV_ITEMS, navLabel, visibleNavItems } from '../../../src/components/navigation.js'
import { TIMEZONE } from './config.js'

const MAX_ROWS = 25

/* ------------------------------ formatting ------------------------------ */

const when = (iso) => {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/** "due in 2 days", "overdue by 13 hours" — relative to now, so the model never does date maths. */
function dueIn(iso, now) {
  if (!iso) return null
  const ms = new Date(iso).getTime() - now.getTime()
  const hours = Math.abs(ms) / 3_600_000
  const span =
    hours < 1
      ? 'less than an hour'
      : hours < 36
        ? `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`
        : `${Math.round(hours / 24)} days`
  return ms >= 0 ? `due in ${span}` : `overdue by ${span}`
}

const isOpen = (row) => ACTIVE_TXN_STATUSES.includes(row.status)
const isOverdue = (row, now) =>
  isOpen(row) && (row.status === 'Overdue' || new Date(row.due_date).getTime() < now.getTime())

/** The Tool Map's rule, read off a database row. */
function locationOf(row) {
  if (!isOpen(row)) return null
  const point = lastKnownLocation({
    locationCheckpoints: row.location_checkpoints,
    borrowLocation: row.borrow_location,
  })
  if (!point) return { recorded: false }
  return {
    recorded: true,
    // "Last recorded", never "is at": a reading says where the tool was at
    // that moment and nothing about now.
    source: point.source === 'checkpoint' ? 'latest checkpoint' : 'borrow point (no checkpoint yet)',
    lastRecordedAt: when(point.capturedAt),
    lat: point.lat,
    lng: point.lng,
    accuracyMeters: Number.isFinite(point.accuracy) ? Math.round(point.accuracy) : null,
    note: point.note || null,
    recordedBy: point.capturedByName || null,
  }
}

function loanView(row, now, { withBorrower = false, withLocation = false } = {}) {
  return {
    loanId: row.id,
    toolId: row.tool_id,
    toolName: row.tool_name,
    status: isOverdue(row, now) ? 'Overdue' : row.status,
    ...(withBorrower ? { borrower: row.user_name, borrowerRole: row.user_role } : {}),
    borrowed: when(row.borrow_date),
    due: when(row.due_date),
    ...(isOpen(row) ? { dueIn: dueIn(row.due_date, now) } : {}),
    returned: when(row.return_date),
    purpose: row.purpose || null,
    returnRequest: row.return_requested_at
      ? {
          requestedAt: when(row.return_requested_at),
          reportedCondition: row.return_request_condition ?? null,
          decision: row.return_decision ?? 'waiting for staff',
          rejectionReason: row.return_rejection_reason ?? null,
        }
      : null,
    ...(withLocation ? { location: locationOf(row) } : {}),
  }
}

const toolView = (row) => ({
  toolId: row.id,
  name: row.name,
  category: row.category || null,
  status: row.status,
  condition: row.condition,
  storageLocation: row.location || null,
  brand: row.brand || null,
  model: row.model || null,
})

const requestView = (row, { withRequester = false } = {}) => ({
  requestId: row.id,
  toolId: row.tool_id,
  toolName: row.tool_name,
  status: row.status,
  ...(withRequester ? { requester: row.user_name, requesterRole: row.user_role } : {}),
  neededFrom: when(row.needed_from),
  neededTo: when(row.needed_to),
  purpose: row.purpose || null,
  decisionNote: row.decision_note || null,
  decidedBy: row.decided_by_name || null,
  submitted: when(row.created_at),
})

/* ------------------------------- arguments ------------------------------ */

const enumArg = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback)
const idArg = (value) =>
  typeof value === 'string' && /^[\w-]{1,64}$/.test(value.trim()) ? value.trim() : null
/** Free text for a name search, stripped of anything PostgREST filters treat as syntax. */
const textArg = (value) =>
  typeof value === 'string'
    ? value.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    : ''
/** A calendar day, YYYY-MM-DD, or null. */
const dateArg = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && !Number.isNaN(Date.parse(value.trim()))
    ? value.trim()
    : null
/** Today where the laboratory is, as YYYY-MM-DD. */
const dayIn = (now) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
/** A tool in any of these states is out of circulation, not merely out on loan. */
const UNREQUESTABLE = ['Maintenance', 'Damaged', 'Lost', 'Retired']
const limitArg = (value) => Math.min(Math.max(Number.parseInt(value, 10) || 10, 1), MAX_ROWS)

class ToolError extends Error {}

function must({ data, error }) {
  if (error) throw new ToolError('That information could not be read right now.')
  return data ?? []
}

/**
 * One tool, by id or by name. Several matches come back as candidates so TOBI
 * can ask which one was meant rather than guess.
 */
async function resolveTool(db, { toolId, toolName }) {
  const id = idArg(toolId)
  if (id) {
    const rows = must(await db.from('tools').select('*').eq('id', id).limit(1))
    if (rows.length) return { tool: rows[0] }
  }
  const name = textArg(toolName)
  if (!name) return { error: 'Say which tool — its name or ID.' }
  const rows = must(
    await db
      .from('tools')
      .select('*')
      .or(`name.ilike.%${name}%,id.ilike.%${name}%,category.ilike.%${name}%`)
      .limit(8),
  )
  if (!rows.length) return { error: `No tool in the inventory matches "${name}".` }
  const exact = rows.find((row) => row.name.toLowerCase() === name.toLowerCase())
  if (exact || rows.length === 1) return { tool: exact ?? rows[0] }
  return {
    ambiguous: true,
    candidates: rows.map((row) => ({ toolId: row.id, name: row.name, status: row.status })),
  }
}

const TOOL_REF = {
  toolId: { type: 'string', description: 'The tool ID, when known (e.g. from the current page).' },
  toolName: { type: 'string', description: 'Part of the tool name, e.g. "drill" or "multimeter".' },
}

/* -------------------------------- functions ------------------------------ */

export const TOBI_TOOLS = [
  {
    name: 'get_my_loans',
    description:
      "The signed-in user's own borrowed tools: active loans (with due dates, return-request status and the last recorded location), overdue ones, or past loans.",
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['active', 'overdue', 'history', 'all'] },
      },
    },
    perm: null,
    async run({ db, user, now }, args) {
      const scope = enumArg(args.scope, ['active', 'overdue', 'history', 'all'], 'active')
      const rows = must(
        await db
          .from('transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('borrow_date', { ascending: false })
          .limit(60),
      )
      const picked = rows.filter((row) =>
        scope === 'active'
          ? isOpen(row)
          : scope === 'overdue'
            ? isOverdue(row, now)
            : scope === 'history'
              ? !isOpen(row)
              : true,
      )
      return {
        scope,
        count: picked.length,
        loans: picked.slice(0, MAX_ROWS).map((row) => loanView(row, now, { withLocation: true })),
      }
    },
  },
  {
    name: 'get_my_requests',
    description: "The signed-in user's own tool requests and their status (Pending, Approved, Rejected…).",
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', enum: REQUEST_STATUSES } },
    },
    perm: PERM.REQUEST_CREATE,
    async run({ db, user }, args) {
      let query = db
        .from('tool_requests')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS)
      const status = enumArg(args.status, REQUEST_STATUSES, null)
      if (status) query = query.eq('status', status)
      const rows = must(await query)
      return { count: rows.length, requests: rows.map((row) => requestView(row)) }
    },
  },
  {
    name: 'search_tools',
    description:
      'Search the tool inventory by name, ID or category, optionally by status (e.g. Available). Use for availability questions.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, ID or category text. Omit to list by status.' },
        status: { type: 'string', enum: TOOL_STATUSES },
        limit: { type: 'integer' },
      },
    },
    perm: PERM.TOOL_VIEW,
    async run({ db }, args) {
      let query = db.from('tools').select('*').order('name').limit(limitArg(args.limit))
      const text = textArg(args.query)
      if (text) query = query.or(`name.ilike.%${text}%,id.ilike.%${text}%,category.ilike.%${text}%`)
      const status = enumArg(args.status, TOOL_STATUSES, null)
      if (status) query = query.eq('status', status)
      const rows = must(await query)
      return { count: rows.length, tools: rows.map(toolView) }
    },
  },
  {
    name: 'get_inventory_summary',
    description: 'How many tools the laboratory has, by status (Available, Borrowed, Overdue, Maintenance…).',
    parameters: { type: 'object', properties: {} },
    perm: PERM.TOOL_VIEW,
    async run({ db }) {
      const rows = must(await db.from('tools').select('status').limit(5000))
      const byStatus = {}
      for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
      return { total: rows.length, byStatus }
    },
  },
  {
    name: 'get_tool_details',
    description:
      "One tool's status, condition and storage location, its current loan if the user may see it, and where it was last recorded (the Tool Map's rule). Use for 'where is the …' questions.",
    parameters: { type: 'object', properties: TOOL_REF },
    perm: PERM.TOOL_VIEW,
    async run({ db, user, now }, args) {
      const found = await resolveTool(db, args)
      if (!found.tool) return found
      const tool = found.tool
      const staffView = can(user, PERM.TXN_VIEW_ALL)
      // Row Level Security returns a student only their own loan, so a tool out
      // with somebody else comes back with no loan — and no location — here.
      const loans = must(
        await db
          .from('transactions')
          .select('*')
          .eq('tool_id', tool.id)
          .in('status', ACTIVE_TXN_STATUSES)
          .limit(1),
      )
      const loan = loans[0] ?? null
      const heldByOther = !loan && ['Borrowed', 'Overdue'].includes(tool.status)
      return {
        tool: toolView(tool),
        currentLoan: loan
          ? {
              ...loanView(loan, now, { withBorrower: staffView, withLocation: true }),
              yours: loan.user_id === user.id,
            }
          : null,
        ...(heldByOther
          ? { note: 'Borrowed by someone else; their loan and its location are not visible to this account.' }
          : {}),
        ...(!loan && !heldByOther
          ? { note: 'Not on loan, so it has no live location; storageLocation is where it is kept.' }
          : {}),
      }
    },
  },
  {
    name: 'get_tool_history',
    description:
      "A tool's past and current loans that this account may see (staff: all; students: their own), plus recent maintenance for staff.",
    parameters: { type: 'object', properties: { ...TOOL_REF, limit: { type: 'integer' } } },
    perm: PERM.TOOL_VIEW,
    async run({ db, user, now }, args) {
      const found = await resolveTool(db, args)
      if (!found.tool) return found
      const staffView = can(user, PERM.TXN_VIEW_ALL)
      let query = db
        .from('transactions')
        .select('*')
        .eq('tool_id', found.tool.id)
        .order('borrow_date', { ascending: false })
        .limit(limitArg(args.limit))
      if (!staffView) query = query.eq('user_id', user.id)
      const loans = must(await query)
      let maintenance
      if (can(user, PERM.MAINTENANCE_VIEW)) {
        const rows = must(
          await db
            .from('maintenance')
            .select('*')
            .eq('tool_id', found.tool.id)
            .order('date', { ascending: false })
            .limit(5),
        )
        maintenance = rows.map((row) => ({
          type: row.type,
          status: row.status,
          date: when(row.date),
          problemReport: isReport(row),
        }))
      }
      return {
        tool: toolView(found.tool),
        scope: staffView ? 'all loans' : 'your own loans only',
        loans: loans.map((row) => loanView(row, now, { withBorrower: staffView })),
        ...(maintenance ? { maintenance } : {}),
      }
    },
  },
  {
    name: 'get_active_loans',
    description:
      'Every tool currently out on loan in the laboratory, with borrower, due date and last recorded location. Set overdueOnly for overdue tools and who has them.',
    parameters: { type: 'object', properties: { overdueOnly: { type: 'boolean' } } },
    perm: PERM.TXN_VIEW_ALL,
    async run({ db, now }, args) {
      const rows = must(
        await db
          .from('transactions')
          .select('*')
          .in('status', ACTIVE_TXN_STATUSES)
          .order('due_date', { ascending: true })
          .limit(200),
      )
      const overdue = rows.filter((row) => isOverdue(row, now))
      const picked = args.overdueOnly === true ? overdue : rows
      return {
        totalActive: rows.length,
        totalOverdue: overdue.length,
        loans: picked
          .slice(0, MAX_ROWS)
          .map((row) => loanView(row, now, { withBorrower: true, withLocation: true })),
      }
    },
  },
  {
    name: 'get_request_queue',
    description:
      'The requests queue staff decide: tool requests (default Pending) and tools whose return is waiting to be confirmed.',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', enum: REQUEST_STATUSES } },
    },
    perm: PERM.REQUEST_VIEW_ALL,
    async run({ db, now }, args) {
      const status = enumArg(args.status, REQUEST_STATUSES, 'Pending')
      const requests = must(
        await db
          .from('tool_requests')
          .select('*')
          .eq('status', status)
          .order('created_at', { ascending: false })
          .limit(MAX_ROWS),
      )
      // Filtered here rather than in the query, so a database without the
      // return-request columns (`0019`/`0036`) still answers the requests half.
      const open = await db
        .from('transactions')
        .select('*')
        .in('status', ACTIVE_TXN_STATUSES)
        .limit(200)
      const returns = open.error
        ? null
        : (open.data ?? [])
            .filter((row) => row.return_requested_at && !row.return_decision)
            .slice(0, MAX_ROWS)
            .map((row) => loanView(row, now, { withBorrower: true }))
      return {
        status,
        requests: requests.map((row) => requestView(row, { withRequester: true })),
        returnsWaiting: returns,
      }
    },
  },
  {
    name: 'get_maintenance',
    description:
      'Maintenance records and problem reports. Set problemReportsOnly for reports filed by users; openOnly for ones not completed or cancelled.',
    parameters: {
      type: 'object',
      properties: {
        problemReportsOnly: { type: 'boolean' },
        openOnly: { type: 'boolean' },
      },
    },
    perm: PERM.MAINTENANCE_VIEW,
    async run({ db }, args) {
      let query = db.from('maintenance').select('*').order('date', { ascending: false }).limit(100)
      if (args.openOnly === true) query = query.in('status', ['Scheduled', 'In Progress'])
      let rows = must(await query)
      if (args.problemReportsOnly === true) rows = rows.filter(isReport)
      return {
        count: rows.length,
        records: rows.slice(0, MAX_ROWS).map((row) => {
          const report = parseReport(row)
          return {
            toolId: row.tool_id,
            toolName: row.tool_name,
            type: row.type,
            status: enumArg(row.status, MAINTENANCE_STATUSES, row.status),
            date: when(row.date),
            ...(report
              ? { reportedBy: report.reporterName, reporterRole: report.reporterRole, description: report.description }
              : { notes: row.notes || null }),
          }
        }),
      }
    },
  },
  {
    name: 'get_user_summary',
    description: 'Accounts by role and status, and the accounts waiting for approval.',
    parameters: { type: 'object', properties: {} },
    perm: PERM.USER_MANAGE,
    async run({ db }) {
      const rows = must(await db.from('profiles').select('full_name, role, status').limit(5000))
      const byRole = {}
      const byStatus = {}
      for (const row of rows) {
        byRole[row.role] = (byRole[row.role] ?? 0) + 1
        byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
      }
      return {
        total: rows.length,
        byRole,
        byStatus,
        pendingApproval: rows
          .filter((row) => row.status === 'Pending')
          .slice(0, MAX_ROWS)
          .map((row) => ({ name: row.full_name, role: row.role })),
      }
    },
  },
  {
    name: 'prepare_return_request',
    description:
      "Prepare a request to hand back one of the user's OWN borrowed tools. This does not submit anything: the app shows the user a confirmation first. Only call it when the user asks to return a tool.",
    parameters: {
      type: 'object',
      properties: {
        loanId: { type: 'string', description: 'The loan ID from get_my_loans, when known.' },
        toolName: { type: 'string', description: 'Part of the tool name, when the loan ID is not known.' },
      },
    },
    perm: PERM.RETURN,
    async run({ db, user, now }, args, { propose }) {
      const rows = must(
        await db
          .from('transactions')
          .select('*')
          .eq('user_id', user.id)
          .in('status', ACTIVE_TXN_STATUSES)
          .limit(30),
      )
      const loanId = idArg(args.loanId)
      const name = textArg(args.toolName).toLowerCase()
      const matches = loanId
        ? rows.filter((row) => row.id === loanId)
        : name
          ? rows.filter((row) => row.tool_name.toLowerCase().includes(name))
          : rows
      if (!matches.length) return { error: 'None of your active loans matches that tool.' }
      if (matches.length > 1) {
        return {
          ambiguous: true,
          candidates: matches.map((row) => ({ loanId: row.id, toolName: row.tool_name })),
        }
      }
      const loan = matches[0]
      if (loan.return_requested_at && !loan.return_decision) {
        return { alreadyRequested: true, loan: loanView(loan, now) }
      }
      propose({
        type: 'return_request',
        transactionId: loan.id,
        toolId: loan.tool_id,
        toolName: loan.tool_name,
      })
      return {
        proposed: true,
        loan: loanView(loan, now),
        instruction: 'The app is now showing a confirmation card. Tell the user to confirm there; it is not submitted yet.',
      }
    },
  },
  {
    name: 'prepare_tool_request',
    description:
      "Prepare a request to borrow a tool, for the signed-in user. Checks the tool and its availability; does NOT submit — the app shows the user a confirmation card with the dates and purpose to confirm or edit. Call it when the user asks to request, borrow or reserve a tool. Dates are YYYY-MM-DD; omit them when the user gave none.",
    parameters: {
      type: 'object',
      properties: {
        ...TOOL_REF,
        neededFrom: { type: 'string', description: 'First day the tool is needed, YYYY-MM-DD.' },
        neededTo: { type: 'string', description: 'Day it will be returned, YYYY-MM-DD.' },
        purpose: { type: 'string', description: 'What it is for, in the user’s words, if they said.' },
      },
    },
    perm: PERM.REQUEST_CREATE,
    async run({ db, user, now }, args, { propose }) {
      const found = await resolveTool(db, args)
      if (!found.tool) return found
      const tool = found.tool
      if (UNREQUESTABLE.includes(tool.status)) {
        return { unavailable: true, tool: toolView(tool), note: `It is ${tool.status.toLowerCase()} and cannot be requested now.` }
      }
      // One open ask per tool per person — the same rule `requests.create()`
      // applies; say so now rather than at the confirmation.
      const open = must(
        await db
          .from('tool_requests')
          .select('*')
          .eq('user_id', user.id)
          .eq('tool_id', tool.id)
          .in('status', ['Pending', 'Approved'])
          .limit(1),
      )
      if (open.length) return { alreadyRequested: true, request: requestView(open[0]) }

      const today = dayIn(now)
      const from = dateArg(args.neededFrom) ?? today
      const to = dateArg(args.neededTo) ?? from
      propose({
        type: 'tool_request',
        toolId: tool.id,
        toolName: tool.name,
        toolStatus: tool.status,
        neededFrom: from < today ? today : from,
        neededTo: to < from ? from : to,
        purpose: typeof args.purpose === 'string' ? args.purpose.trim().slice(0, 300) : '',
      })
      return {
        proposed: true,
        tool: toolView(tool),
        ...(tool.status !== 'Available'
          ? { note: `It is ${tool.status.toLowerCase()} right now; staff decide whether the dates can work.` }
          : {}),
        instruction:
          'The app is now showing a request card with the tool, dates and purpose. Tell the user to check them and confirm there; it is not sent yet.',
      }
    },
  },
  {
    name: 'prepare_problem_report',
    description:
      'Prepare a problem report about a tool (damage, a fault, something missing). Does NOT submit — the app shows the user a confirmation card first. Pick the closest type.',
    parameters: {
      type: 'object',
      properties: {
        ...TOOL_REF,
        type: { type: 'string', enum: MAINTENANCE_TYPES },
        description: { type: 'string', description: 'What is wrong, in the user’s words.' },
      },
    },
    perm: PERM.TOOL_VIEW,
    async run({ db }, args, { propose }) {
      const found = await resolveTool(db, args)
      if (!found.tool) return found
      propose({
        type: 'problem_report',
        toolId: found.tool.id,
        toolName: found.tool.name,
        problemType: enumArg(args.type, MAINTENANCE_TYPES, 'Corrective'),
        description: typeof args.description === 'string' ? args.description.trim().slice(0, 500) : '',
      })
      return {
        proposed: true,
        tool: toolView(found.tool),
        instruction:
          'The app is now showing a report card for this tool. Tell the user to check the details and send it there; it is not filed yet.',
      }
    },
  },
  {
    name: 'prepare_request_decision',
    description:
      'Staff only: prepare to approve or reject a pending tool request. Does NOT decide it — the app shows a confirmation card first. Use get_request_queue to find the request.',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'reject'] },
        note: { type: 'string', description: 'Optional note for the requester.' },
      },
      required: ['requestId', 'decision'],
    },
    perm: PERM.REQUEST_DECIDE,
    async run({ db }, args, { propose }) {
      const id = idArg(args.requestId)
      if (!id) return { error: 'Say which request — its ID from the queue.' }
      const rows = must(await db.from('tool_requests').select('*').eq('id', id).limit(1))
      const request = rows[0]
      if (!request) return { error: 'No request with that ID is visible to this account.' }
      if (request.status !== 'Pending') return { alreadyDecided: true, request: requestView(request, { withRequester: true }) }
      const decision = enumArg(args.decision, ['approve', 'reject'], null)
      if (!decision) return { error: 'Say whether to approve or reject it.' }
      propose({
        type: 'request_decision',
        requestId: request.id,
        batchId: request.batch_id ?? null,
        decision,
        toolName: request.tool_name,
        requester: request.user_name,
        note: typeof args.note === 'string' ? args.note.trim().slice(0, 300) : '',
      })
      return {
        proposed: true,
        request: requestView(request, { withRequester: true }),
        instruction: 'The app is now showing a confirmation card. Tell the user to confirm there; nothing is decided yet.',
      }
    },
  },
  {
    name: 'open_page',
    description:
      'Take the user straight to a Tool Track page. ONLY when they explicitly ask to open, go to or be taken to a page ("open Tool Map", "go to Requests"). Never for a question about data ("where is my drill", "show overdue tools") — answer those with the other functions.',
    parameters: {
      type: 'object',
      properties: {
        page: {
          type: 'string',
          description:
            'The page: dashboard, inventory, tool map, scan, return, transactions, requests, new request, messages, users, maintenance, problem reports, notifications, reports, settings, profile.',
        },
      },
      required: ['page'],
    },
    perm: null,
    async run({ user }, args, { navigate }) {
      const found = resolvePage(user, args.page)
      if (!found) return { error: 'There is no Tool Track page by that name.' }
      if (!found.allowed) return { notAvailable: true, note: `${found.label} isn't available for this account.` }
      navigate({ to: found.to, label: found.label })
      return { opened: true, page: found.label }
    },
  },
]

/* --------------------------------- pages --------------------------------- */

/**
 * Other words people use for a page, mapped to its route. Only names — which
 * page a role may open is never decided here, but by the navigation config.
 */
const PAGE_WORDS = {
  home: '/dashboard',
  dashboard: '/dashboard',
  tools: '/tools',
  'tool list': '/tools',
  map: '/tools/map',
  'tools map': '/tools/map',
  scanner: '/scan',
  'qr scanner': '/scan',
  returns: '/return',
  'return a tool': '/return',
  loans: '/transactions',
  'loan history': '/transactions',
  history: '/transactions',
  request: '/requests',
  'my requests': '/requests',
  'new request': '/requests/new',
  'request a tool': '/requests/new',
  chats: '/messages',
  inbox: '/messages',
  alerts: '/notifications',
  'problem reports': '/problem-reports',
  'report problems': '/problem-reports',
  account: '/profile',
  'my account': '/profile',
  profile: '/profile',
  analytics: '/reports',
  logs: '/activity',
  tobi: '/tobi',
}

/** The pages a page can be, beyond the navigation items: the form and the account. */
const EXTRA_DESTINATIONS = [
  { to: '/requests/new', label: 'New request', perm: PERM.REQUEST_CREATE },
  { to: '/profile', label: 'Profile' },
]

/**
 * Which page `wanted` names, and whether this user may open it.
 *
 * The page is found among every navigation item there is, so a page the role
 * lacks is still recognised and refused by name ("Users isn't available")
 * rather than guessed at. Whether it is allowed comes from the role's own
 * navigation — `visibleNavItems`, the list the sidebar and the bottom bar are
 * built from — so there is no second copy of who may open what.
 */
export function resolvePage(user, wanted) {
  const name = textArg(wanted)
    .toLowerCase()
    .replace(/^(the|ang|yung|sa)\s+/, '')
    .replace(/\s+(page|tab|screen|pahina)$/, '')
    .trim()
  if (!name) return null
  const all = [...NAV_ITEMS, ...EXTRA_DESTINATIONS]
  const byWord = PAGE_WORDS[name]
  const page =
    all.find((item) => item.to === byWord) ??
    all.find((item) => item.label.toLowerCase() === name) ??
    all.find((item) => item.to.slice(1).replace(/[/-]/g, ' ') === name) ??
    all.find((item) => name.length > 3 && item.label.toLowerCase().includes(name))
  if (!page) return null
  const allowed =
    visibleNavItems(user.role, (perm) => can(user, perm)).some((item) => item.to === page.to) ||
    EXTRA_DESTINATIONS.some((extra) => extra.to === page.to && (!extra.perm || can(user, extra.perm)))
  return { to: page.to, label: navLabel(page, user.role), allowed }
}

/** The functions a role may use — the only ones the model is told about. */
export function toolsFor(user) {
  return TOBI_TOOLS.filter((tool) => !tool.perm || can(user, tool.perm))
}

/**
 * Run one call from the model. Authorization is checked again here, against the
 * server's own record of the caller, however the call was produced.
 */
export async function runTool(name, args, ctx, hooks) {
  const tool = TOBI_TOOLS.find((candidate) => candidate.name === name)
  if (!tool) return { error: 'Unknown function.' }
  if (tool.perm && !can(ctx.user, tool.perm)) {
    return { error: 'This information is not available for your account.' }
  }
  try {
    return await tool.run(ctx, args && typeof args === 'object' ? args : {}, hooks)
  } catch (err) {
    if (err instanceof ToolError) return { error: err.message }
    console.warn('[tobi] function failed', name, err?.message)
    return { error: 'That information could not be read right now.' }
  }
}

