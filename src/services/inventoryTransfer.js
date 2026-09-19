/**
 * Bulk inventory in and out: the sample template, the CSV parser, and the
 * validation pass that stands between a spreadsheet and the database.
 *
 * Nothing here decides what a valid tool is. `services/tools.js` already owns
 * that — required fields, known categories and conditions, the `TOOL-00001`
 * shape, and the uniqueness of both the id and the serial number — so this
 * calls `tools.validate()` per row and reports what it says. A second set of
 * rules would be a second answer to the same question, and the two would drift.
 *
 * CSV rather than XLSX: the project has no spreadsheet library, and adding one
 * for this would put several hundred kilobytes into a bundle that was just
 * trimmed for low-end phones. Excel, Sheets and Numbers all open a UTF-8 CSV
 * directly, and the download carries a BOM so Excel reads accents correctly.
 */

import * as db from './db'
import { COLLECTIONS } from './db'
import * as toolService from './tools'
import { downloadBlob, downloadCSV } from '../utils/helpers'
import { CATEGORIES, CONDITIONS, TOOL_STATUS, TOOL_STATUSES } from '../utils/constants'

/**
 * The columns an import understands, in the order the template writes them.
 *
 * `key` matches the field on a tool record, so a parsed row needs no second
 * mapping on its way to `tools.create()`.
 */
export const IMPORT_COLUMNS = [
  { key: 'id', label: 'Tool ID', required: true },
  { key: 'name', label: 'Tool Name', required: true },
  { key: 'category', label: 'Category', required: true },
  { key: 'brand', label: 'Brand' },
  { key: 'serialNumber', label: 'Serial Number' },
  { key: 'location', label: 'Location', required: true },
  { key: 'condition', label: 'Condition', required: true },
  { key: 'status', label: 'Status' },
  { key: 'description', label: 'Description' },
]

/** The same columns an export writes. Kept identical so a round trip works. */
export const EXPORT_COLUMNS = IMPORT_COLUMNS.map(({ key, label }) => ({ key, label }))

const TEMPLATE_FILENAME = 'ToolTrack_Inventory_Import_Template.csv'

/** `ToolTrack_Inventory_2026-09-19.csv` */
export const exportFilename = () =>
  `ToolTrack_Inventory_${new Date().toISOString().slice(0, 10)}.csv`

/* ------------------------------------------------------------------ *
 * Template
 * ------------------------------------------------------------------ */

/**
 * Example rows, written from the app's own vocabulary.
 *
 * The category, condition and status values are taken from `utils/constants`
 * rather than typed here, so the sample can never show a value the validator
 * would then reject.
 */
function sampleRows() {
  const category = (n) => CATEGORIES[Math.min(n, CATEGORIES.length - 1)] ?? ''
  const condition = (n) => CONDITIONS[Math.min(n, CONDITIONS.length - 1)] ?? ''
  return [
    {
      id: 'TOOL-00001',
      name: 'Socket Ratchet 1/2"',
      category: category(0),
      brand: 'Stanley',
      serialNumber: 'SR-1001',
      location: 'Cabinet A · Shelf 1',
      condition: condition(0),
      status: TOOL_STATUS.AVAILABLE,
      description: 'Reversible ratchet handle, 1/2 inch drive.',
    },
    {
      id: 'TOOL-00002',
      name: 'Torque Wrench 10-100 Nm',
      category: category(1),
      brand: 'Tekton',
      serialNumber: 'TW-2043',
      location: 'Cabinet B · Shelf 2',
      condition: condition(0),
      status: TOOL_STATUS.AVAILABLE,
      description: 'Calibrated annually. Store at its lowest setting.',
    },
    {
      id: 'TOOL-00003',
      name: 'Digital Multimeter',
      category: category(2),
      brand: 'Fluke',
      serialNumber: 'DM-5512',
      location: 'Cabinet C · Drawer 1',
      condition: condition(1),
      status: TOOL_STATUS.AVAILABLE,
      description: 'Leads checked before every loan.',
    },
  ]
}

/**
 * Download the ready-to-fill template.
 *
 * Three filled rows rather than an empty header: a blank sheet leaves somebody
 * guessing what "Condition" will accept, and the fastest way to say it is to
 * show it.
 */
export function downloadTemplate() {
  downloadCSV(sampleRows(), EXPORT_COLUMNS, TEMPLATE_FILENAME)
}

/** A short, readable note of what each column accepts — shown in the dialog. */
export const COLUMN_HELP = {
  id: 'TOOL-00001 — five digits or more, unique',
  category: CATEGORIES.join(' · '),
  condition: CONDITIONS.join(' · '),
  status: `${TOOL_STATUSES.join(' · ')} (optional, defaults to ${TOOL_STATUS.AVAILABLE})`,
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

/**
 * Write the rows the page is currently showing.
 *
 * The caller passes its filtered list, so an active search or status filter is
 * what lands in the file — exporting the whole inventory when the screen shows
 * eleven tools would not be the thing anybody asked for.
 */
export function exportTools(tools) {
  downloadCSV(tools ?? [], EXPORT_COLUMNS, exportFilename())
}

/* ------------------------------------------------------------------ *
 * CSV parsing
 * ------------------------------------------------------------------ */

/**
 * A small RFC 4180 reader: quoted fields, embedded commas and newlines, and
 * doubled quotes inside a quoted field.
 *
 * Hand-written rather than imported because it is thirty lines and the
 * alternative is a dependency for one screen.
 */
export function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  // A byte-order mark would otherwise become part of the first header.
  const input = text.replace(/^﻿/, '')

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      // Swallow the \n of a \r\n pair.
      if (char === '\r' && input[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  // Whatever is left when the text ends, unless it ended on a newline.
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/** Header label → field key, tolerant of case and spacing. */
function headerMap(header) {
  const normalise = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const byLabel = new Map(IMPORT_COLUMNS.map((c) => [normalise(c.label), c.key]))
  // A file exported from this app and fed straight back in.
  for (const c of IMPORT_COLUMNS) byLabel.set(normalise(c.key), c.key)
  return header.map((cell) => byLabel.get(normalise(cell)) ?? null)
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/**
 * Read a file into rows, each carrying its own verdict.
 *
 * Nothing is written here. The result is what the preview shows and what
 * `commitImport` later acts on, so the person sees exactly what will happen
 * before it does.
 *
 * @returns {Promise<{ rows: Array, ok: number, failed: number, fileError?: string }>}
 */
export async function analyseImport(text) {
  const table = parseCSV(text)
  if (!table.length) {
    return { rows: [], ok: 0, failed: 0, fileError: 'That file is empty.' }
  }

  const keys = headerMap(table[0])
  const recognised = keys.filter(Boolean)
  if (!recognised.includes('id') || !recognised.includes('name')) {
    return {
      rows: [],
      ok: 0,
      failed: 0,
      fileError:
        'This does not look like a ToolTrack inventory file — the Tool ID and Tool Name ' +
        'columns are missing. Download the sample template and fill that in.',
    }
  }

  // Existing ids, read once rather than per row.
  const existing = new Set(
    (await db.list(COLLECTIONS.tools)).map((t) => String(t.id).toUpperCase()),
  )
  // Ids seen earlier in this same file — a duplicate inside one spreadsheet is
  // just as broken as one that clashes with the database.
  const seen = new Set()

  const rows = []
  for (let r = 1; r < table.length; r += 1) {
    const cells = table[r]
    const draft = {}
    keys.forEach((key, c) => {
      if (key) draft[key] = String(cells[c] ?? '').trim()
    })

    if (draft.id) draft.id = draft.id.toUpperCase()

    const errors = {}

    // Ask the application's own validator first, so the rules are the ones the
    // Add-tool form enforces.
    Object.assign(errors, await toolService.validate(draft))

    // `validate` checks the database; it cannot know about a row three lines
    // above this one in the same file.
    if (draft.id && seen.has(draft.id)) {
      errors.id = `Tool ID ${draft.id} appears more than once in this file.`
    } else if (draft.id && existing.has(draft.id) && !errors.id) {
      errors.id = `${draft.id} already exists in the inventory.`
    }
    if (draft.id) seen.add(draft.id)

    rows.push({
      line: r + 1, // the line number in the file, as a spreadsheet counts
      draft,
      errors,
      valid: Object.keys(errors).length === 0,
    })
  }

  return {
    rows,
    ok: rows.filter((r) => r.valid).length,
    failed: rows.filter((r) => !r.valid).length,
  }
}

/**
 * Write the rows that passed.
 *
 * Only ever creates. A row whose id already exists was refused during analysis,
 * so an import can add to the inventory but never quietly rewrite a tool
 * somebody is holding.
 *
 * @returns {Promise<{ created: number, failures: Array<{ line: number, message: string }> }>}
 */
export async function commitImport(rows, actor) {
  const failures = []
  let created = 0

  for (const row of rows) {
    if (!row.valid) continue
    try {
      await toolService.create(row.draft, actor)
      created += 1
    } catch (err) {
      // A row can still fail here — somebody else may have taken the id between
      // the preview and the confirmation. Reported rather than swallowed.
      failures.push({ line: row.line, message: err?.message ?? 'Could not be saved.' })
    }
  }

  return { created, failures }
}
