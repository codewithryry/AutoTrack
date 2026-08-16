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

  const url = String(input.departmentUrl ?? '').trim()
  if (url.length > 300) {
    errors.departmentUrl = 'Keep the address under 300 characters.'
  } else if (url && !/^https?:\/\//i.test(url)) {
    errors.departmentUrl = 'Enter a full address beginning with https:// or http://.'
  }

  // The name the link is shown under. Optional — without one the address is
  // shown instead — but a name with no address has nothing to open.
  const name = String(input.departmentName ?? '').trim()
  if (name.length > 80) {
    errors.departmentName = 'Keep the page name under 80 characters.'
  } else if (name && !url) {
    errors.departmentName = 'Add the address this name should open.'
  }

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

/* ------------------------------------------------------------------ *
 * What the settings table actually holds
 *
 * The document is written as one row, so a single key the table does not have
 * fails the whole statement — and with it every other setting in the same save.
 * That is what `updatedBy` did: nothing ever added an `updated_by` column, so
 * an administrator's changes were rejected and the page reverted to the stored
 * values on the next read.
 *
 * `SHARED_FIELDS` is therefore the explicit list of what may be sent, matched
 * to `0001_schema.sql`, and `departmentUrl` — added later by `0010` — is asked
 * for the same way every other post-0001 column is, so a database that has not
 * had that migration applied still saves everything else.
 * ------------------------------------------------------------------ */

const SHARED_FIELDS = [
  'id',
  'labName',
  'labLocation',
  'institution',
  'defaultBorrowDays',
  'maxBorrowDays',
  'dueSoonThresholdDays',
  'maintenanceIntervalDays',
  'notifyOverdue',
  'notifyDueSoon',
  'notifyReturns',
  'notifyMaintenance',
  'updatedAt',
]

const DEPARTMENT_URL_COLUMN = 'departmentUrl'
const DEPARTMENT_NAME_COLUMN = 'departmentName'

/** Whether this database has had `0010_settings_department_page.sql` applied. */
export const departmentUrlAvailable = () =>
  db.supportsColumn(COLLECTIONS.settings, DEPARTMENT_URL_COLUMN)

/** Whether this database has had `0029_settings_department_name.sql` applied. */
export const departmentNameAvailable = () =>
  db.supportsColumn(COLLECTIONS.settings, DEPARTMENT_NAME_COLUMN)

/** Drop anything the table does not have a column for. */
async function writableDocument(document) {
  const allowed = new Set(SHARED_FIELDS)
  if (await departmentUrlAvailable()) allowed.add(DEPARTMENT_URL_COLUMN)
  // Asked for the same way, so a database without 0029 still saves the rest.
  if (await departmentNameAvailable()) allowed.add(DEPARTMENT_NAME_COLUMN)
  return Object.fromEntries(Object.entries(document).filter(([key]) => allowed.has(key)))
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
  }

  // The theme is not part of the shared document.
  const { theme: _local, ...document } = next
  await db.upsert(COLLECTIONS.settings, await writableDocument(document))
  return { ...next, theme: theme ?? current.theme }
}

export async function reset(actor) {
  assertCan(actor, PERM.SETTINGS_EDIT, 'Only an administrator can reset the laboratory settings.')
  const { theme, ...document } = { ...DEFAULT_SETTINGS, updatedAt: nowISO() }
  await db.upsert(COLLECTIONS.settings, await writableDocument(document))
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
  // Keeps the pre-paint background set in index.html in step with a theme
  // switched at runtime, so overscroll never shows the previous colour.
  root.style.background = resolved === 'dark' ? 'rgb(8 13 23)' : 'rgb(241 244 249)'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#080D17' : '#0B1220')
  return resolved
}
