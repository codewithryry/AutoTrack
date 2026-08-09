import * as db from './db'
import { COLLECTIONS } from './db'
import { DEFAULT_SETTINGS } from '../utils/constants'
import { nowISO } from '../utils/dates'

/** Application settings — a single document, always present. */

const SETTINGS_ID = DEFAULT_SETTINGS.id

export async function load() {
  const stored = await db.get(COLLECTIONS.settings, SETTINGS_ID)
  if (!stored) {
    const fresh = { ...DEFAULT_SETTINGS, updatedAt: nowISO() }
    await db.upsert(COLLECTIONS.settings, fresh)
    return fresh
  }
  // Merge so settings added in a later version get their defaults.
  return { ...DEFAULT_SETTINGS, ...stored }
}

export function validate(input) {
  const errors = {}
  if (!input.labName?.trim()) errors.labName = 'Laboratory name is required.'
  if (!input.labLocation?.trim()) errors.labLocation = 'Laboratory location is required.'

  const days = Number(input.defaultBorrowDays)
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    errors.defaultBorrowDays = 'Enter a whole number of days between 1 and 90.'
  }

  const max = Number(input.maxBorrowDays)
  if (!Number.isInteger(max) || max < 1 || max > 365) {
    errors.maxBorrowDays = 'Enter a whole number of days between 1 and 365.'
  } else if (Number.isInteger(days) && max < days) {
    errors.maxBorrowDays = 'The maximum cannot be shorter than the default duration.'
  }

  const threshold = Number(input.dueSoonThresholdDays)
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 14) {
    errors.dueSoonThresholdDays = 'Enter a whole number of days between 0 and 14.'
  }

  const interval = Number(input.maintenanceIntervalDays)
  if (!Number.isInteger(interval) || interval < 7 || interval > 730) {
    errors.maintenanceIntervalDays = 'Enter a whole number of days between 7 and 730.'
  }

  return errors
}

export async function save(patch) {
  const current = await load()
  const next = {
    ...current,
    ...patch,
    id: SETTINGS_ID,
    defaultBorrowDays: Number(patch.defaultBorrowDays ?? current.defaultBorrowDays),
    maxBorrowDays: Number(patch.maxBorrowDays ?? current.maxBorrowDays),
    dueSoonThresholdDays: Number(patch.dueSoonThresholdDays ?? current.dueSoonThresholdDays),
    maintenanceIntervalDays: Number(
      patch.maintenanceIntervalDays ?? current.maintenanceIntervalDays,
    ),
    updatedAt: nowISO(),
  }
  await db.upsert(COLLECTIONS.settings, next)
  return next
}

export async function reset() {
  const fresh = { ...DEFAULT_SETTINGS, updatedAt: nowISO() }
  await db.upsert(COLLECTIONS.settings, fresh)
  return fresh
}

/** Apply the stored theme to the document root. */
export function applyTheme(theme) {
  const root = document.documentElement
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme === 'dark'
        ? 'dark'
        : 'light'
  root.setAttribute('data-theme', resolved)
  root.style.colorScheme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#080D17' : '#0B1220')
  return resolved
}
