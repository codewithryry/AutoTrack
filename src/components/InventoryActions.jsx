import { useEffect, useRef, useState } from 'react'
import { Download, FileDown, Printer, Upload } from 'lucide-react'
import { Modal } from './ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import * as transfer from '../services/inventoryTransfer'
import { printQRLabels } from '../utils/qr'
import { cx } from '../utils/helpers'
import { PERM } from '../utils/permissions'

/**
 * Import, Export and Print, beside the inventory's Add-tool button.
 *
 * All three are gated on `PERM.TOOL_CREATE` — the permission an administrator
 * and an instructor hold and a student does not, which is the same gate the
 * Add-tool button already uses. Hiding the buttons is only the first layer:
 * `tools.create()` calls `assertCan` on every row an import writes, so the
 * service refuses the work even if the control were reached another way.
 *
 * Nothing here generates a QR code or validates a tool. `utils/qr.js` already
 * prints an A4 sheet from the scanner's own payload, and `services/tools.js`
 * already knows what a valid tool is; this screen is the doorway to both.
 */
export default function InventoryActions({ tools = [], filtered = [], selected = [], className }) {
  const { user, can } = useApp()
  const toast = useToast()

  const [importOpen, setImportOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)

  // The gate. Rendering nothing is the visible half; the service layer is the
  // half that actually enforces it.
  if (!can(PERM.TOOL_CREATE)) return null

  const exportNow = () => {
    if (!filtered.length) {
      toast.info('There is nothing to export with these filters.')
      return
    }
    transfer.exportTools(filtered)
    toast.success(`${filtered.length} tool${filtered.length === 1 ? '' : 's'} exported.`)
  }

  return (
    <>
      <div className={cx('flex items-center gap-2', className)}>
        <button type="button" onClick={() => setImportOpen(true)} className="btn btn-outline btn-sm">
          <Upload className="h-4 w-4" />
          Import
        </button>
        <button type="button" onClick={exportNow} className="btn btn-outline btn-sm">
          <Download className="h-4 w-4" />
          Export
        </button>
        <button type="button" onClick={() => setPrintOpen(true)} className="btn btn-outline btn-sm">
          <Printer className="h-4 w-4" />
          Print
        </button>
      </div>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        actor={user}
        toast={toast}
      />
      <PrintDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        tools={tools}
        filtered={filtered}
        selected={selected}
        toast={toast}
      />
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

function ImportDialog({ open, onClose, actor, toast }) {
  const fileRef = useRef(null)
  const [analysis, setAnalysis] = useState(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setAnalysis(null)
    setFileName('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const close = () => {
    reset()
    onClose()
  }

  const choose = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)

    if (!/\.csv$/i.test(file.name)) {
      setAnalysis({
        rows: [],
        ok: 0,
        failed: 0,
        fileError:
          'Only CSV files can be imported. Save the spreadsheet as CSV, or start from the ' +
          'sample template below.',
      })
      return
    }

    setBusy(true)
    try {
      // Read and check, never write. The preview below is what the person
      // confirms.
      setAnalysis(await transfer.analyseImport(await file.text()))
    } catch (err) {
      setAnalysis({ rows: [], ok: 0, failed: 0, fileError: err?.message ?? 'That file could not be read.' })
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!analysis?.ok) return
    setBusy(true)
    try {
      const { created, failures } = await transfer.commitImport(analysis.rows, actor)
      if (created) {
        toast.success(`${created} tool${created === 1 ? '' : 's'} added to the inventory.`)
      }
      if (failures.length) {
        toast.info(`${failures.length} row${failures.length === 1 ? '' : 's'} could not be saved.`)
      }
      close()
    } catch (err) {
      toast.error(err?.message ?? 'The import could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const invalidRows = analysis?.rows.filter((r) => !r.valid) ?? []

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import inventory"
      description="Upload a CSV file of inventory records. Nothing is saved until you confirm."
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={transfer.downloadTemplate}
            className="btn btn-ghost btn-sm"
          >
            <FileDown className="h-4 w-4" />
            Download sample template
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={close} className="btn btn-ghost">
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy || !analysis?.ok}
              className="btn btn-primary"
            >
              {analysis?.ok ? `Import ${analysis.ok}` : 'Import'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={choose}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0
                       file:bg-black/5 file:px-3 file:py-2 file:text-sm file:font-semibold
                       dark:file:bg-white/10"
          />
          {fileName && <p className="subtle mt-1.5 text-xs">{fileName}</p>}
        </div>

        {/* What the file must contain, in the app's own vocabulary so nobody has
            to guess what "Condition" will accept. */}
        <div className="rounded-xl border p-3">
          <p className="text-xs font-bold uppercase tracking-wider">Required columns</p>
          <p className="subtle mt-1 text-xs leading-relaxed">
            {transfer.IMPORT_COLUMNS.map((c) => c.label + (c.required ? '*' : '')).join(' · ')}
          </p>
          <dl className="mt-2 space-y-1">
            {Object.entries(transfer.COLUMN_HELP).map(([key, help]) => (
              <div key={key} className="flex gap-2 text-[11px]">
                <dt className="shrink-0 font-semibold">
                  {transfer.IMPORT_COLUMNS.find((c) => c.key === key)?.label}
                </dt>
                <dd className="subtle min-w-0">{help}</dd>
              </div>
            ))}
          </dl>
        </div>

        {busy && !analysis && <p className="muted text-sm">Checking the file…</p>}

        {analysis?.fileError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700
                          dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {analysis.fileError}
          </div>
        )}

        {analysis && !analysis.fileError && (
          <div className="space-y-3">
            <p className="text-sm font-semibold">
              {analysis.ok} ready to import
              {analysis.failed > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  {' '}
                  · {analysis.failed} with problems
                </span>
              )}
            </p>

            {/* Every refusal, with its line number, so a spreadsheet can be
                corrected without guessing which row is meant. */}
            {invalidRows.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-xl border">
                <ul className="divide-y text-xs">
                  {invalidRows.map((row) => (
                    <li key={row.line} className="p-2.5">
                      <p className="font-semibold">
                        Line {row.line}
                        {row.draft.id ? ` · ${row.draft.id}` : ''}
                      </p>
                      <ul className="subtle mt-0.5 space-y-0.5">
                        {Object.entries(row.errors).map(([field, message]) => (
                          <li key={field}>{message}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.ok > 0 && (
              // Not `.tbl`: that class's `min-width: 640px` is right for a page
              // table with room to breathe, but would force this compact preview
              // to scroll sideways inside a 320px dialog for no reason. The
              // header treatment below is `.tbl thead th`'s own, though — the
              // same small-caps label style every other table in the app uses —
              // so this still reads as the same kind of table, just sized for
              // where it lives.
              <div className="max-h-48 overflow-auto rounded-xl border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0" style={{ background: 'rgb(var(--surface-2))' }}>
                    <tr>
                      <th className="p-2 text-left text-[11px] font-bold uppercase tracking-wider">
                        Tool ID
                      </th>
                      <th className="p-2 text-left text-[11px] font-bold uppercase tracking-wider">
                        Name
                      </th>
                      <th className="p-2 text-left text-[11px] font-bold uppercase tracking-wider">
                        Category
                      </th>
                      <th className="p-2 text-left text-[11px] font-bold uppercase tracking-wider">
                        Location
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {analysis.rows
                      .filter((r) => r.valid)
                      .map((row) => (
                        <tr key={row.line}>
                          <td className="mono p-2">{row.draft.id}</td>
                          <td className="p-2">{row.draft.name}</td>
                          <td className="p-2">{row.draft.category}</td>
                          <td className="p-2">{row.draft.location}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="subtle text-[11px] leading-relaxed">
              Only new tools are added. A row whose Tool ID already exists is refused rather than
              overwriting the tool that holds it.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 * Print
 * ------------------------------------------------------------------ */

function PrintDialog({ open, onClose, tools, filtered, selected = [], toast }) {
  // A selection is a more specific intent than "what is on screen", so it wins
  // when there is one. Falls back to the filtered list the moment it is cleared.
  const [scope, setScope] = useState(selected.length ? 'selected' : 'filtered')
  useEffect(() => {
    if (open) setScope(selected.length ? 'selected' : 'filtered')
  }, [open, selected.length])
  const [busy, setBusy] = useState(false)

  const forScope = { all: tools, filtered, selected }[scope] ?? []
  const count = forScope.length

  const run = async () => {
    if (!count) return
    setBusy(true)
    try {
      // The existing sheet: A4, one card per tool, `break-inside: avoid`, and
      // the scanner's own payload. It opens in its own window, so none of the
      // app's chrome is in the printed output.
      await printQRLabels(forScope)
    } catch (err) {
      toast.error(err?.message ?? 'The QR sheet could not be prepared.')
    } finally {
      setBusy(false)
      onClose()
    }
  }

  const Option = ({ value, label, n }) => (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border p-3">
      <input
        type="radio"
        name="print-scope"
        value={value}
        checked={scope === value}
        onChange={() => setScope(value)}
        className="h-4 w-4"
      />
      <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
      <span className="subtle text-xs">{n}</span>
    </label>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Print inventory QR codes"
      description="A print-ready sheet of QR labels, one card per tool."
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button type="button" onClick={run} disabled={busy || !count} className="btn btn-primary">
            <Printer className="h-4 w-4" />
            Print QR codes
          </button>
        </div>
      }
    >
      <div className="space-y-2.5">
        {/* Offered only when something is selected: an empty scope would be a
            radio button that prints nothing. */}
        {selected.length > 0 && (
          <Option value="selected" label="Selected tools" n={selected.length} />
        )}
        <Option value="filtered" label="Tools shown on this page" n={filtered.length} />
        <Option value="all" label="All tools in the inventory" n={tools.length} />

        <p className="pt-1 text-sm font-semibold">
          {count} QR code{count === 1 ? '' : 's'} ready to print
        </p>
        <p className="subtle text-[11px] leading-relaxed">
          Each card carries the tool's name and ID under its code, and uses the same payload the
          Scan page reads — a printed label works with the scanner straight away.
        </p>
      </div>
    </Modal>
  )
}
