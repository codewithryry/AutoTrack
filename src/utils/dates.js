/**
 * Date helpers. Everything the domain stores is an ISO string; everything the
 * UI shows goes through one of the formatters here so the app reads consistently.
 *
 * Day-level comparisons (overdue, due-soon) deliberately operate on calendar days
 * in local time — a tool due "May 22" is not overdue at 09:00 on May 22.
 */

const MS_PER_DAY = 86_400_000

export const nowISO = () => new Date().toISOString()

/** Parse anything date-ish into a Date, or null when it is not usable. */
export function toDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Local calendar midnight for a value. */
export function startOfDay(value = new Date()) {
  const d = toDate(value) ?? new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** `YYYY-MM-DD` in local time — the format `<input type="date">` expects. */
export function toDateInput(value) {
  const d = toDate(value)
  if (!d) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const todayInput = () => toDateInput(new Date())

/**
 * Convert a `YYYY-MM-DD` input value to an ISO timestamp anchored at local noon.
 * Noon avoids the classic off-by-one where a UTC-midnight timestamp renders as
 * the previous day for users west of Greenwich.
 */
export function fromDateInput(value) {
  if (!value) return null
  const [y, m, d] = String(value).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString()
}

export function addDays(value, days) {
  const d = toDate(value) ?? new Date()
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

export const addDaysISO = (value, days) => addDays(value, days).toISOString()

/** Whole calendar days from `a` to `b`. Positive when `b` is later. */
export function daysBetween(a, b) {
  const da = startOfDay(a)
  const db = startOfDay(b)
  if (!da || !db) return 0
  return Math.round((db - da) / MS_PER_DAY)
}

/** Negative once the due date has passed; 0 on the due date itself. */
export const daysUntilDue = (dueDate) => daysBetween(new Date(), dueDate)

/** True only after the whole due day has elapsed. */
export function isOverdue(dueDate, reference = new Date()) {
  const due = toDate(dueDate)
  if (!due) return false
  return startOfDay(reference) > startOfDay(due)
}

export function isDueSoon(dueDate, thresholdDays = 1, reference = new Date()) {
  const diff = daysBetween(reference, dueDate)
  return diff >= 0 && diff <= thresholdDays
}

export const isSameDay = (a, b) => {
  const da = toDate(a)
  const db = toDate(b)
  return !!da && !!db && startOfDay(da).getTime() === startOfDay(db).getTime()
}

export const isToday = (value) => isSameDay(value, new Date())

/* --------------------------- formatters --------------------------- */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "May 20, 2025" */
export function formatDate(value, fallback = '—') {
  const d = toDate(value)
  if (!d) return fallback
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/** "May 20, 2025 · 2:35 PM" */
export function formatDateTime(value, fallback = '—') {
  const d = toDate(value)
  if (!d) return fallback
  return `${formatDate(d)} · ${formatTime(d)}`
}

export function formatTime(value, fallback = '—') {
  const d = toDate(value)
  if (!d) return fallback
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

/** "May 20" — compact axis/label form. */
export function formatShortDate(value, fallback = '—') {
  const d = toDate(value)
  if (!d) return fallback
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
}

/** "May 2025" */
export function formatMonth(value) {
  const d = toDate(value)
  if (!d) return '—'
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`
}

/** `YYYY-MM` grouping key. */
export function monthKey(value) {
  const d = toDate(value)
  if (!d) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** "just now" · "5m ago" · "3d ago" · then falls back to an absolute date. */
export function timeAgo(value) {
  const d = toDate(value)
  if (!d) return '—'
  const secs = Math.floor((Date.now() - d.getTime()) / 1000)
  if (secs < 0) return formatDate(d)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return formatDate(d)
}

/** Human phrasing of a due date relative to today. */
export function dueLabel(dueDate) {
  const diff = daysUntilDue(dueDate)
  if (diff < 0) return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} overdue`
  if (diff === 0) return 'Due today'
  if (diff === 1) return 'Due tomorrow'
  return `Due in ${diff} days`
}

/** Inclusive range test against `YYYY-MM-DD` bounds; blank bounds are open. */
export function withinRange(value, from, to) {
  const d = toDate(value)
  if (!d) return false
  const t = startOfDay(d).getTime()
  if (from) {
    const f = startOfDay(fromDateInput(from))
    if (f && t < f.getTime()) return false
  }
  if (to) {
    const e = startOfDay(fromDateInput(to))
    if (e && t > e.getTime()) return false
  }
  return true
}

/** Last `count` months as `[{ key, label }]`, oldest first. */
export function lastMonths(count = 6, reference = new Date()) {
  const out = []
  const base = toDate(reference) ?? new Date()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    out.push({ key: monthKey(d), label: `${MONTHS[d.getMonth()].slice(0, 3)}` , full: formatMonth(d) })
  }
  return out
}
