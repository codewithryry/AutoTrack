/** Small shared utilities used across pages and services. */

/** Conditional className joiner. */
export function cx(...args) {
  const out = []
  for (const a of args) {
    if (!a) continue
    if (typeof a === 'string') out.push(a)
    else if (Array.isArray(a)) {
      const inner = cx(...a)
      if (inner) out.push(inner)
    } else if (typeof a === 'object') {
      for (const [k, v] of Object.entries(a)) if (v) out.push(k)
    }
  }
  return out.join(' ')
}

/** Sequential, zero-padded domain ids: `TOOL-00001`. */
export function padId(prefix, n, width = 5) {
  return `${prefix}-${String(n).padStart(width, '0')}`
}

/**
 * Immutable transaction id — sortable by time and collision-safe enough for a
 * single-device local database. `TXN-20250520-4F2A9C`.
 */
export function generateTxnId(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('')
  return `TXN-${stamp}-${randomToken(6)}`
}

export function randomToken(length = 8) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTUVWXYZ' // no I/L/O to stay readable
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

export const uid = (prefix) => `${prefix}-${randomToken(10)}`

/** Case/diacritic-insensitive substring match across several fields. */
export function matchesQuery(item, query, fields) {
  if (!query) return true
  const q = normalize(query)
  return fields.some((f) => normalize(item?.[f] ?? '').includes(q))
}

const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g')

export function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .trim()
}

/** Stable comparator supporting strings, numbers and dates. */
export function sortBy(list, key, direction = 'asc') {
  const dir = direction === 'desc' ? -1 : 1
  return [...list].sort((a, b) => {
    const av = a?.[key]
    const bv = b?.[key]
    if (av == null && bv == null) return 0
    if (av == null) return 1 // nulls always last
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
    const ad = Date.parse(av)
    const bd = Date.parse(bv)
    if (!Number.isNaN(ad) && !Number.isNaN(bd) && looksLikeDate(av) && looksLikeDate(bv)) {
      return (ad - bd) * dir
    }
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir
  })
}

function looksLikeDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
}

export function groupBy(list, keyFn) {
  return list.reduce((acc, item) => {
    const key = typeof keyFn === 'function' ? keyFn(item) : item[keyFn]
    ;(acc[key] ||= []).push(item)
    return acc
  }, {})
}

export function countBy(list, keyFn) {
  return list.reduce((acc, item) => {
    const key = typeof keyFn === 'function' ? keyFn(item) : item[keyFn]
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

export const unique = (list) => [...new Set(list)]

export function initials(name) {
  return String(name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export const percent = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0)

export function formatCurrency(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return '—'
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function truncate(text, max = 60) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/* ------------------------------ CSV ------------------------------ */

function csvCell(value) {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** `columns` is `[{ key, label, format? }]`. */
export function toCSV(rows, columns) {
  const header = columns.map((c) => csvCell(c.label)).join(',')
  const body = rows.map((row) =>
    columns.map((c) => csvCell(c.format ? c.format(row[c.key], row) : row[c.key])).join(','),
  )
  return [header, ...body].join('\r\n')
}

export function downloadBlob(content, filename, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke on the next tick so Safari has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const UTF8_BOM = '﻿'

export function downloadCSV(rows, columns, filename) {
  // BOM keeps Excel from mangling non-ASCII characters
  downloadBlob(UTF8_BOM + toCSV(rows, columns), filename, 'text/csv;charset=utf-8')
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Unable to read the selected file.'))
    reader.readAsText(file)
  })
}

export function debounce(fn, wait = 250) {
  let timer
  const wrapped = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
  wrapped.cancel = () => clearTimeout(timer)
  return wrapped
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Deterministic pick — used by the seeder so demo data is varied but sane. */
export const pick = (list, index) => list[index % list.length]
