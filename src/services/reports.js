import * as db from './db'
import { COLLECTIONS } from './db'
import {
  ACTIVE_TXN_STATUSES,
  CONDITION,
  TOOL_STATUS,
  TXN_STATUS,
  USER_STATUS,
} from '../utils/constants'
import { countBy, percent } from '../utils/helpers'
import {
  daysBetween,
  isDueSoon,
  isOverdue,
  isToday,
  lastMonths,
  monthKey,
  withinRange,
} from '../utils/dates'

/**
 * Derived statistics.
 *
 * Nothing here is stored — every number is computed from the tools,
 * transactions and users collections, so the dashboard can never
 * drift out of sync with the underlying records. There are no hardcoded counts.
 *
 * The functions below assume the caller may see laboratory-wide data, which is
 * true for staff. A student's dashboard uses `studentDashboard()` instead: their
 * queries only return their own loans, so a system-wide total would silently be
 * computed from a subset. Asking a different question is more honest than
 * showing a wrong answer.
 */

async function loadAll() {
  const { tools, transactions, users, maintenance } = await db.listMany([
    COLLECTIONS.tools,
    COLLECTIONS.transactions,
    COLLECTIONS.users,
    COLLECTIONS.maintenance,
  ])
  return { tools, transactions, users, maintenance }
}

/** Headline counters for the dashboard cards. */
export async function dashboardStats({ dueSoonThresholdDays = 1 } = {}) {
  const { tools, transactions, users } = await loadAll()

  const byStatus = countBy(tools, 'status')
  const active = transactions.filter((t) => ACTIVE_TXN_STATUSES.includes(t.status))

  const totalTools = tools.length
  const available = byStatus[TOOL_STATUS.AVAILABLE] ?? 0
  const borrowed = byStatus[TOOL_STATUS.BORROWED] ?? 0
  const overdue = byStatus[TOOL_STATUS.OVERDUE] ?? 0
  const damaged = byStatus[TOOL_STATUS.DAMAGED] ?? 0
  const maintenance = byStatus[TOOL_STATUS.MAINTENANCE] ?? 0
  const lost = byStatus[TOOL_STATUS.LOST] ?? 0
  const retired = byStatus[TOOL_STATUS.RETIRED] ?? 0

  const inCirculation = totalTools - retired - lost
  const outNow = borrowed + overdue

  return {
    totalTools,
    available,
    borrowed,
    overdue,
    damaged,
    maintenance,
    lost,
    retired,

    totalUsers: users.length,
    activeUsers: users.filter((u) => u.status === USER_STATUS.ACTIVE).length,

    todayTransactions: transactions.filter(
      (t) => isToday(t.borrowDate) || isToday(t.returnDate),
    ).length,
    todayBorrowed: transactions.filter((t) => isToday(t.borrowDate)).length,
    todayReturned: transactions.filter((t) => isToday(t.returnDate)).length,

    activeLoans: active.length,
    dueSoon: active.filter(
      (t) => t.status === TXN_STATUS.BORROWED && isDueSoon(t.dueDate, dueSoonThresholdDays),
    ).length,

    // Share of the usable inventory currently out on loan.
    utilization: percent(outNow, inCirculation),
    availabilityRate: percent(available, inCirculation),
    inCirculation,
  }
}

/**
 * The signed-in student's own figures.
 *
 * Every number here comes from documents the student is allowed to read: their
 * transactions (queried by `userId`) and the shared tool inventory. No user
 * totals, no other students' loans, no laboratory-wide transaction counts.
 */
export async function studentDashboard(userId, { dueSoonThresholdDays = 1 } = {}) {
  const { tools, transactions } = await db.listMany([
    COLLECTIONS.tools,
    COLLECTIONS.transactions,
  ])

  const mine = transactions.filter((t) => t.userId === userId)
  const active = mine.filter((t) => ACTIVE_TXN_STATUSES.includes(t.status))
  // A student cannot run the overdue sweep, so lateness is derived from the due
  // date rather than trusting the stored status.
  const overdue = active.filter((t) => t.status === TXN_STATUS.OVERDUE || isOverdue(t.dueDate))
  const dueSoon = active.filter(
    (t) => !overdue.includes(t) && isDueSoon(t.dueDate, dueSoonThresholdDays),
  )

  const byStatus = countBy(tools, 'status')
  const available = byStatus[TOOL_STATUS.AVAILABLE] ?? 0

  return {
    activeLoans: active.length,
    dueSoon: dueSoon.length,
    overdue: overdue.length,
    totalTransactions: mine.length,
    returned: mine.filter((t) => t.returnDate).length,
    damaged: mine.filter((t) => t.status === TXN_STATUS.DAMAGED).length,
    availableTools: available,
    totalTools: tools.length,

    loans: [...active].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
    overdueLoans: overdue,
    recent: [...mine]
      .sort((a, b) => new Date(b.createdAt ?? b.borrowDate) - new Date(a.createdAt ?? a.borrowDate))
      .slice(0, 6),
  }
}

/** Newest transactions, enriched for the dashboard table. */
export async function recentTransactions(limit = 5) {
  const transactions = await db.list(COLLECTIONS.transactions)
  return [...transactions]
    .sort((a, b) => new Date(b.createdAt ?? b.borrowDate) - new Date(a.createdAt ?? a.borrowDate))
    .slice(0, limit)
}

/** Tools ranked by how often they leave the room. */
export async function mostBorrowedTools(limit = 5, { from, to } = {}) {
  const { tools, transactions } = await loadAll()
  // A deleted tool's loans are detached, not destroyed (their `toolId` is
  // nulled by the 0009 migration so the history survives). They are no longer
  // inventory, so they must not rank as "most borrowed" under a null key.
  const scoped = transactions.filter(
    (t) => t.toolId && (!from && !to ? true : withinRange(t.borrowDate, from, to)),
  )
  const counts = countBy(scoped, 'toolId')

  return Object.entries(counts)
    .map(([toolId, count]) => {
      const tool = tools.find((t) => t.id === toolId)
      return {
        toolId,
        count,
        name: tool?.name ?? scoped.find((t) => t.toolId === toolId)?.toolName ?? toolId,
        category: tool?.category ?? '—',
        status: tool?.status ?? '—',
      }
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** Borrowers ranked by activity, with their outstanding count. */
export async function mostActiveUsers(limit = 5, { from, to } = {}) {
  const { users, transactions } = await loadAll()
  const scoped = transactions.filter((t) => (!from && !to ? true : withinRange(t.borrowDate, from, to)))
  const counts = countBy(scoped, 'userId')

  return Object.entries(counts)
    .map(([userId, count]) => {
      const user = users.find((u) => u.id === userId)
      const rows = scoped.filter((t) => t.userId === userId)
      return {
        userId,
        count,
        name: user?.fullName ?? rows[0]?.userName ?? userId,
        role: user?.role ?? rows[0]?.userRole ?? '—',
        course: user?.course ?? '',
        active: rows.filter((t) => ACTIVE_TXN_STATUSES.includes(t.status)).length,
        overdue: rows.filter((t) => t.status === TXN_STATUS.OVERDUE).length,
      }
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** Borrow/return counts per month for the activity chart. */
export async function monthlyActivity(months = 6) {
  const transactions = await db.list(COLLECTIONS.transactions)
  const buckets = lastMonths(months)

  return buckets.map(({ key, label, full }) => ({
    month: label,
    fullMonth: full,
    borrowed: transactions.filter((t) => monthKey(t.borrowDate) === key).length,
    returned: transactions.filter((t) => t.returnDate && monthKey(t.returnDate) === key).length,
    overdue: transactions.filter(
      (t) => monthKey(t.borrowDate) === key && (t.status === TXN_STATUS.OVERDUE || t.wasOverdue),
    ).length,
  }))
}

/** Inventory split by status, for the donut. */
export async function statusBreakdown() {
  const tools = await db.list(COLLECTIONS.tools)
  const counts = countBy(tools, 'status')
  return Object.entries(counts)
    .map(([status, value]) => ({ name: status, value }))
    .sort((a, b) => b.value - a.value)
}

/** Inventory split by category, with how many of each are out. */
export async function categoryBreakdown() {
  const tools = await db.list(COLLECTIONS.tools)
  const grouped = {}
  for (const tool of tools) {
    const row = (grouped[tool.category] ||= { name: tool.category, total: 0, out: 0, available: 0 })
    row.total++
    if (tool.status === TOOL_STATUS.BORROWED || tool.status === TOOL_STATUS.OVERDUE) row.out++
    if (tool.status === TOOL_STATUS.AVAILABLE) row.available++
  }
  return Object.values(grouped).sort((a, b) => b.total - a.total)
}

export async function conditionBreakdown() {
  const tools = await db.list(COLLECTIONS.tools)
  const counts = countBy(tools, 'condition')
  return Object.values(CONDITION)
    .map((condition) => ({ name: condition, value: counts[condition] ?? 0 }))
    .filter((row) => row.value > 0)
}

/**
 * Return-rate and punctuality over an optional date range.
 * `returnRate` counts closed loans against everything issued in the window.
 */
export async function returnMetrics({ from, to } = {}) {
  const transactions = await db.list(COLLECTIONS.transactions)
  const scoped = transactions.filter((t) => (!from && !to ? true : withinRange(t.borrowDate, from, to)))

  const closed = scoped.filter((t) => t.returnDate)
  const onTime = closed.filter((t) => !t.wasOverdue && t.status !== TXN_STATUS.DAMAGED)
  const late = closed.filter((t) => t.wasOverdue)
  const damaged = scoped.filter((t) => t.status === TXN_STATUS.DAMAGED)
  const stillOut = scoped.filter((t) => ACTIVE_TXN_STATUSES.includes(t.status))

  const durations = closed
    .map((t) => daysBetween(t.borrowDate, t.returnDate))
    .filter((d) => Number.isFinite(d) && d >= 0)

  return {
    total: scoped.length,
    returned: closed.length,
    onTime: onTime.length,
    late: late.length,
    damaged: damaged.length,
    outstanding: stillOut.length,
    returnRate: percent(closed.length, scoped.length),
    onTimeRate: percent(onTime.length, closed.length),
    damageRate: percent(damaged.length, scoped.length),
    averageDays: durations.length
      ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
      : 0,
  }
}

/** Per-tool utilisation table: times borrowed, days out, current state. */
export async function toolUtilization({ from, to } = {}) {
  const { tools, transactions } = await loadAll()
  const scoped = transactions.filter((t) => (!from && !to ? true : withinRange(t.borrowDate, from, to)))

  return tools
    .map((tool) => {
      const rows = scoped.filter((t) => t.toolId === tool.id)
      // A same-day loan still occupies the tool, so every loan counts as ≥ 1 day.
      const daysOut = rows.reduce((sum, t) => {
        const days = daysBetween(t.borrowDate, t.returnDate ?? new Date().toISOString())
        return sum + (Number.isFinite(days) ? Math.max(days, 1) : 1)
      }, 0)
      return {
        id: tool.id,
        name: tool.name,
        category: tool.category,
        status: tool.status,
        condition: tool.condition,
        location: tool.location,
        timesBorrowed: rows.length,
        daysOut,
        lastBorrowed: rows.length
          ? rows.reduce((latest, t) => (t.borrowDate > latest ? t.borrowDate : latest), rows[0].borrowDate)
          : null,
      }
    })
    .sort((a, b) => b.timesBorrowed - a.timesBorrowed || a.name.localeCompare(b.name))
}

/** Open overdue loans with a day count, for the dashboard warning panel. */
export async function overdueSummary() {
  const { tools, transactions, users } = await loadAll()
  return transactions
    .filter((t) => t.status === TXN_STATUS.OVERDUE)
    .map((txn) => ({
      transaction: txn,
      tool: tools.find((t) => t.id === txn.toolId) ?? null,
      user: users.find((u) => u.id === txn.userId) ?? null,
      daysOverdue: Math.abs(daysBetween(new Date(), txn.dueDate)),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
}

/** Everything the reports page needs, in one pass. */
export async function fullReport(range = {}) {
  const [stats, mostBorrowed, activeUsers, monthly, status, category, condition, metrics, utilization] =
    await Promise.all([
      dashboardStats(),
      mostBorrowedTools(8, range),
      mostActiveUsers(8, range),
      monthlyActivity(6),
      statusBreakdown(),
      categoryBreakdown(),
      conditionBreakdown(),
      returnMetrics(range),
      toolUtilization(range),
    ])
  return {
    stats,
    mostBorrowed,
    activeUsers,
    monthly,
    status,
    category,
    condition,
    metrics,
    utilization,
  }
}
