import * as db from './db'
import { COLLECTIONS } from './db'
import { DEFAULT_SETTINGS } from '../utils/constants'
import { PERM, assertCan } from '../utils/permissions'
import { nowISO } from '../utils/dates'

/**
 * Laboratory settings — one record, `settings/app-settings`.
 *
 * Every signed-in user may read it (the shell shows the laboratory name, and the
 * borrow desk needs the loan limits); only an administrator may write it.
 *
 * The theme is the exception: it is a per-device preference, so it lives in
 * localStorage. Storing it in the shared document would mean one user's choice
 * of dark mode followed everyone else onto every laboratory PC — and it would
 * make appearance an admin-only setting once `/settings` became admin-only.
 */

const SETTINGS_ID = DEFAULT_SETTINGS.id
const THEME_KEY = 'stms.theme'

export function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) ?? DEFAULT_SETTINGS.theme
  } catch {
    return DEFAULT_SETTINGS.theme
  }
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* storage unavailable — the theme applies for this session only */
  }
  return theme
}

/**
 * Read the settings.
 *
 * A missing document is not an error: the defaults are returned as-is and the
 * document is created the first time an administrator saves (or seeds). A
 * student must never try to create it — the rules would reject the write.
 */
export async function load() {
  // Read through `list` rather than `get`: it opens the collection's snapshot
  // listener, so a change an administrator makes on one machine reaches the
  // others without a reload. The collection holds a single small document.
  const stored = await db
    .list(COLLECTIONS.settings)
    .then((rows) => rows.find((row) => row.id === SETTINGS_ID) ?? null)
    .catch((err) => {
      console.warn('[settings] falling back to defaults', err)
      return null
    })
  // Merge so settings added in a later version get their defaults.
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}), id: SETTINGS_ID, theme: loadTheme() }
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

/**
 * Persist a patch. The theme is stored on the device; anything else needs the
 * settings permission and is written to the store.
 */
export async function save(patch, actor) {
  const current = await load()
  const { theme, ...rest } = patch ?? {}

  if (theme && theme !== current.theme) saveTheme(theme)

  const changesShared = Object.keys(rest).length > 0
  if (!changesShared) return { ...current, theme: theme ?? current.theme }

  assertCan(actor, PERM.SETTINGS_EDIT, 'Only an administrator can change the laboratory settings.')

  const next = {
    ...current,
    ...rest,
    id: SETTINGS_ID,
    defaultBorrowDays: Number(rest.defaultBorrowDays ?? current.defaultBorrowDays),
    maxBorrowDays: Number(rest.maxBorrowDays ?? current.maxBorrowDays),
    dueSoonThresholdDays: Number(rest.dueSoonThresholdDays ?? current.dueSoonThresholdDays),
    maintenanceIntervalDays: Number(
      rest.maintenanceIntervalDays ?? current.maintenanceIntervalDays,
    ),
    updatedAt: nowISO(),
    updatedBy: actor?.id ?? null,
  }

  // The theme is not part of the shared document.
  const { theme: _local, ...document } = next
  await db.upsert(COLLECTIONS.settings, document)
  return { ...next, theme: theme ?? current.theme }
}

export async function reset(actor) {
  assertCan(actor, PERM.SETTINGS_EDIT, 'Only an administrator can reset the laboratory settings.')
  const { theme, ...document } = { ...DEFAULT_SETTINGS, updatedAt: nowISO() }
  await db.upsert(COLLECTIONS.settings, document)
  return { ...DEFAULT_SETTINGS, updatedAt: nowISO(), theme: loadTheme() }
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
