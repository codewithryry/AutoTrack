import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ToolImage from './ToolImage'
import { SelectField, Spinner, TextAreaField } from './ui'
import { useToast } from '../context/ToastContext'
import * as maintenanceService from '../services/maintenance'
import * as toolService from '../services/tools'
import * as txnService from '../services/transactions'
import { PERM } from '../utils/permissions'
import { MAINTENANCE_TYPES, NON_BORROWABLE_REASON, TOOL_STATUS } from '../utils/constants'
import { cx } from '../utils/helpers'
import { dueLabel, formatDate } from '../utils/dates'

/* -------------------------------------------------------------------------
 * The sections. Each one owns a band of the result and nothing else, which is
 * what keeps the spacing honest: the gaps live in the parent's `space-y`, so
 * no section can quietly add a margin on top of another's.
 * ---------------------------------------------------------------------- */

/**
 * Navigation, not a title. Small, and first, because it is the way out.
 *
 * Same rounded-pill treatment every other back link in the app uses (the
 * tool detail page, tool history, the request detail page) — `rounded-full`,
 * a hairline border, the muted-text pill fill on hover — so this one reads as
 * the same control rather than a differently-shaped one-off.
 */
function ScanResultHeader({ onReset }) {
  return (
    <button
      type="button"
      onClick={onReset}
      className="muted inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5
                 text-[13px] font-semibold transition-colors hover:bg-black/[0.03] dark:hover:bg-white/5"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Scan another tool
    </button>
  )
}

/**
 * The picture, the name, the id and the status — one header block rather than
 * a photo beside a half-empty column.
 *
 * A bigger tile (128px) and every piece of identity gathered around it: the
 * previous split — a small photo, a wide gap, then the status as its own
 * section further down the page — read as unfinished, with the top of the
 * screen mostly empty. Grouping the tick, the name, the id and the live
 * status into one row makes the header do all of its job in one place, so
 * "found, and what it is" is read as a single fact rather than assembled from
 * three separate ones.
 *
 * The tick still sits on the image corner so "found" reads as a property of
 * *this tool*, which is what a banner at the top of the page failed at.
 */
function ToolIdentity({ tool, tone, dot }) {
  const detail = [tool.condition, tool.category].filter(Boolean).join(' · ')
  return (
    <div className="flex items-start gap-4">
      {/* The tile is `relative` and exactly the image's size, so the tick sits
          on the picture's corner rather than floating in the gap beside it —
          which is what it did when the badge was anchored to a taller box. */}
      <div className="relative h-[128px] w-[128px] shrink-0" data-scan="image">
        {/* The tile carries its own surface and border. `--surface-3` alone is
            within a shade of the page behind it, so without this the picture
            area reads as blank space and the tick looks unattached to
            anything. */}
        <ToolImage
          tool={tool}
          className="h-full w-full"
          rounded="rounded-2xl"
        />
        <span
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{ border: '1px solid rgb(var(--border))' }}
          aria-hidden="true"
        />
        <span
          className="absolute -bottom-1.5 -right-1.5 grid h-[28px] w-[28px] place-items-center
                     rounded-full bg-emerald-500 text-white ring-[3px]"
          style={{ '--tw-ring-color': 'rgb(var(--app-bg))' }}
          aria-hidden="true"
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
      </div>

      {/* `justify-between` over the tile's own height rather than the row
          simply stacking top-aligned: with the taller photo beside it, the
          name/id block and the status line now share the tile's height
          instead of leaving the bottom half of the row empty. */}
      <div className="flex min-h-[128px] min-w-0 flex-1 flex-col justify-between py-0.5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-600 dark:text-emerald-400">
            Tool found
          </p>
          {/* Clamped rather than truncated to one line: a name is read here to
              confirm "this is the tool I scanned", and cutting it after a
              dozen characters is often the part that would have done that.
              Two lines bounds the height a genuinely long name can claim —
              nothing in the data model limits how long one may be — without
              losing the words that make it recognisable. */}
          <h2 className="mt-1 line-clamp-2 text-[20px] font-extrabold leading-[1.15] tracking-tight">
            {tool.name}
          </h2>
          <p className="subtle mono mt-1 text-[13px]">{tool.id}</p>
        </div>

        <div>
          <p className={cx('flex items-center gap-2 text-[14px] font-bold', tone)}>
            <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', dot)} />
            {tool.status}
          </p>
          {detail && <p className="subtle mt-0.5 truncate text-[12px]">{detail}</p>}
        </div>
      </div>
    </div>
  )
}

/**
 * The facts, two across.
 *
 * Two columns rather than a stack because these are short values read at a
 * glance, not a form being filled in — and the vertical space it saves is what
 * lets the picture above be big enough to recognise. A value too long to sit
 * beside its neighbour wraps inside its own column rather than widening the
 * grid, so nothing overflows at 320px.
 */
function ToolMetadata({ facts }) {
  if (!facts.length) return null
  return (
    <dl
      className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl p-3.5"
      style={{ background: 'rgb(var(--surface-2))' }}
    >
      {facts.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="subtle text-[10px] font-bold uppercase tracking-[0.08em]">{label}</dt>
          <dd className="mt-0.5 break-words text-[13px] font-semibold leading-snug">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The one thing to press. Sized for a thumb, not for drama.
 *
 * A step larger than the secondary rows below it — 17px against their 14px —
 * so the size itself says which one is the primary action, not only the
 * fill color. This is the size every other page's mobile primary now matches,
 * so a phone sees the same weight of "the one main thing" wherever it appears.
 */
function PrimaryAction({ action, onNavigate }) {
  if (!action) return null
  return (
    <button
      type="button"
      onClick={() => onNavigate(action.to)}
      className="btn btn-primary w-full justify-between rounded-xl px-4 text-[17px] font-bold"
      style={{ minHeight: '50px' }}
    >
      {action.label}
      <ArrowRight className="h-[18px] w-[18px] opacity-70" />
    </button>
  )
}

/**
 * The rest, as rows.
 *
 * Grouped in one divided box rather than given borders each: two outlined
 * buttons under a filled one read as three competing choices, whereas a
 * divided list reads as "and also these". Details is weighted above Report,
 * since one is where most people go next and the other is an exception.
 *
 * Text and a chevron only — no leading icon. A row already reads as its own
 * label; putting a glyph beside every one of them added a second thing to
 * scan without adding a second thing to know. The chevron alone is enough of
 * an affordance once the row is inside a bordered list like this one.
 *
 * Neither row leaves this screen any more. "View tool details" used to
 * navigate to the tool's own page — a whole new screen, and a "Back to Scan"
 * trip to undo it — for a summary that fits in a few lines; it now expands in
 * place the same way "Report a problem" does, so scanning several tools in a
 * row never opens and closes a page it did not need. The full record — QR
 * code, maintenance history, staff controls — is still one tap away on
 * `detailHref` for whoever actually needs it, but that is no longer the only
 * way to see what the tool is.
 */
function SecondaryActions({
  detailHref,
  tool,
  viewingDetails,
  onToggleDetails,
  reporting,
  onToggleReport,
  onReported,
}) {
  const row = 'flex w-full items-center justify-between gap-3 px-3 text-left text-[14px] font-semibold transition-colors min-h-[46px] hover:bg-black/5 dark:hover:bg-white/5'
  return (
    // A surface behind the border, not the border alone: `--border` sits only
    // a few points of luminance from `--app-bg`, so without a fill this list
    // read as barely-there text floating under the button rather than a
    // second, distinct control — matching `.card`'s own pairing of a surface,
    // a border and a shadow for exactly the same reason.
    <div
      className="overflow-hidden rounded-xl shadow-card"
      style={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))' }}
    >
      <button type="button" onClick={onToggleDetails} aria-expanded={viewingDetails} className={row}>
        View tool details
        <ChevronDown
          className={cx('h-4 w-4 opacity-40 transition-transform', viewingDetails && 'rotate-180')}
        />
      </button>
      <Accordion open={viewingDetails}>
        <div style={{ borderTop: '1px solid rgb(var(--border))' }}>
          <ToolDetailsSummary tool={tool} detailHref={detailHref} />
        </div>
      </Accordion>

      <button
        type="button"
        onClick={onToggleReport}
        aria-expanded={reporting}
        className={cx(row, 'font-medium')}
        style={{ borderTop: '1px solid rgb(var(--border))' }}
      >
        <span className="subtle">Report a problem</span>
        <ChevronDown
          className={cx('h-4 w-4 opacity-40 transition-transform', reporting && 'rotate-180')}
        />
      </button>
      <Accordion open={reporting}>
        <div style={{ borderTop: '1px solid rgb(var(--border))' }}>
          <ReportProblemInline
            tool={tool}
            open={reporting}
            onReported={onReported}
            onCancel={onToggleReport}
          />
        </div>
      </Accordion>
    </div>
  )
}

/**
 * The grid-rows expand/collapse every accordion on this screen shares: the
 * track size animates rather than `height`, so content of a variable height —
 * a form's error message, a tool with no description — still expands and
 * collapses smoothly rather than jumping or clipping mid-animation.
 */
function Accordion({ open, children }) {
  return (
    <div
      className="grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}

/**
 * "Konting summary lang" — a light read, not the whole tool page repeated
 * inline: the identity row above already carries location and brand/model,
 * so this adds only what that row leaves out — when it was purchased and its
 * description — plus a link to the full record (maintenance history, QR
 * code, staff controls) for whoever needs more than a summary.
 */
function ToolDetailsSummary({ tool, detailHref }) {
  return (
    <div className="space-y-3 p-3.5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <dt className="subtle text-[10px] font-bold uppercase tracking-[0.08em]">Tool ID</dt>
          <dd className="mono mt-0.5 text-[13px] font-semibold">{tool.id}</dd>
        </div>
        <div>
          <dt className="subtle text-[10px] font-bold uppercase tracking-[0.08em]">Purchased</dt>
          <dd className="mono mt-0.5 text-[13px] font-semibold">{formatDate(tool.purchaseDate)}</dd>
        </div>
      </dl>

      {tool.description && (
        <div>
          <p className="subtle text-[10px] font-bold uppercase tracking-[0.08em]">Description</p>
          <p className="muted mt-0.5 text-[13px] leading-snug">{tool.description}</p>
        </div>
      )}

      <Link
        to={detailHref}
        className="flex items-center gap-1 text-[13px] font-semibold text-amberline-600 dark:text-amberline-400"
      >
        Full record and history
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}

/**
 * The same report-a-problem form `ReportProblemDialog` opens as a modal
 * elsewhere, laid out in place instead. Same service call
 * (`maintenanceService.reportProblem`), same fields, same validation — the
 * only thing that changed is the chrome around it.
 */
function ReportProblemInline({ tool, open, onReported, onCancel }) {
  const toast = useToast()
  const [type, setType] = useState('Corrective')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  // A fresh form each time it opens, so a previous draft never attaches
  // itself to a different tool.
  useEffect(() => {
    if (!open) return
    setType('Corrective')
    setDescription('')
    setErrors({})
    setBusy(false)
  }, [open, tool?.id])

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setErrors({})
    try {
      await maintenanceService.reportProblem({ toolId: tool.id, type, description })
      toast.success('Thank you — the laboratory staff have been notified.', {
        title: 'Problem reported',
      })
      onReported?.()
    } catch (err) {
      if (err?.errors) setErrors(err.errors)
      else toast.error(err?.message ?? 'The report could not be sent.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 p-3.5">
      <div
        className="flex items-start gap-2.5 rounded-lg border p-3"
        style={{ background: 'rgb(var(--surface-2))' }}
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
        <p className="subtle text-xs leading-relaxed">
          This report is filed against <span className="font-semibold">{tool.name}</span> and goes
          to the laboratory staff. The tool's status is not changed by reporting it.
        </p>
      </div>

      <SelectField
        label="What kind of problem?"
        value={type}
        onChange={(e) => setType(e.target.value)}
        options={MAINTENANCE_TYPES}
        error={errors.type}
        required
      />

      <TextAreaField
        label="What is wrong?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        error={errors.description}
        hint="What you noticed, and when. Staff see this on the service log."
        rows={3}
        maxLength={500}
        required
      />

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn btn-ghost" disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy && <Spinner />}
          Send report
        </button>
      </div>
    </form>
  )
}

/* ---------------------------------------------------------------------- */

/**
 * What a phone shows once a scan has resolved: the tool, and the one thing to
 * do about it.
 *
 * This is the *state* the camera is replaced by, not a card laid over it. The
 * scanner is unmounted by the page before this renders, so everything here has
 * the whole screen.
 *
 * Deliberately not the tool's page. A scan is a decision point in a workshop:
 * what is this, can I take it, where does it live. A short summary — purchase
 * date, description — expands in place behind "View tool details"; the full
 * record with its maintenance history and QR code is a link inside that
 * summary for whoever needs more, and does not belong in front of somebody
 * standing at a rack by default.
 *
 * `ToolScanResult` still serves the desktop, where a column beside the scanner
 * can afford the fuller panel. Both read the same permissions from the same
 * helpers, so neither can offer an action the other would refuse — the rules
 * live in `services/`, not in either component.
 */
export default function ToolFound({ tool, loan, can, onNavigate, onReset }) {
  const [reporting, setReporting] = useState(false)
  // Only one of the two expandable rows is ever open at a time — opening one
  // closes the other, the same single-open rule the Settings accordion uses,
  // so the screen never has two forms/summaries stacked open on a phone.
  const [viewingDetails, setViewingDetails] = useState(false)

  const activeLoan = loan?.transaction
  const eligibility = toolService.borrowEligibility(tool)
  const overdue = tool.status === TOOL_STATUS.OVERDUE || activeLoan?.status === 'Overdue'
  const outOfService = [
    TOOL_STATUS.MAINTENANCE,
    TOOL_STATUS.DAMAGED,
    TOOL_STATUS.LOST,
    TOOL_STATUS.RETIRED,
  ].includes(tool.status)

  // The same expressions the desktop panel uses, so the two cannot disagree
  // about what this person may do.
  const mayIssue = eligibility.ok && can(PERM.BORROW_FOR_OTHERS)
  const mayReceive = !!activeLoan && can(PERM.RETURN_ANY)
  const mayBorrow = eligibility.ok && can(PERM.BORROW) && !can(PERM.BORROW_FOR_OTHERS)
  const mayReturnOwn = !!activeLoan && can(PERM.RETURN) && !mayReceive

  /*
   * One dominant action, chosen by the tool's state rather than stacked.
   *
   * Everything else on this screen is a row, so there is never a set of
   * controls that all look equally like the thing to press.
   */
  const primary = mayReceive
    ? { label: 'Return tool', to: `/return?tool=${tool.id}` }
    : mayReturnOwn
      ? {
          label: txnService.returnRequested(activeLoan) ? 'Return requested' : 'Return tool',
          to: `/return?tool=${tool.id}`,
        }
      : mayIssue
        ? { label: 'Borrow tool', to: `/borrow?tool=${tool.id}` }
        : mayBorrow
          ? { label: 'Request to borrow', to: `/requests/new?tool=${tool.id}` }
          : null

  const statusTone = overdue
    ? 'text-red-600 dark:text-red-400'
    : activeLoan
      ? 'text-blue-600 dark:text-blue-400'
      : outOfService
        ? 'text-orange-600 dark:text-orange-400'
        : 'text-emerald-600 dark:text-emerald-400'

  const statusDot = overdue
    ? 'bg-red-500'
    : activeLoan
      ? 'bg-blue-500'
      : outOfService
        ? 'bg-orange-500'
        : 'bg-emerald-500'

  // Only what a decision needs. Anything absent is dropped rather than shown
  // as an em dash — a field with nothing in it is not information.
  const facts = [
    ['Location', tool.location],
    ['Brand / model', [tool.brand, tool.model].filter(Boolean).join(' · ')],
  ].filter(([, value]) => !!value)

  return (
    <div className="scan-found space-y-4">
      <ScanResultHeader onReset={onReset} />

      <div className="space-y-4">
        <ToolIdentity tool={tool} tone={statusTone} dot={statusDot} />

        {/* Why it cannot be taken, when that is the answer. */}
        {!activeLoan && !eligibility.ok && (
          <p className="rounded-xl border border-orange-200 bg-orange-50 px-3.5 py-2.5 text-[13px] leading-snug
                        text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200">
            {NON_BORROWABLE_REASON[tool.status] ?? eligibility.reason}
          </p>
        )}

        {/* Who has it, for whoever may know. A student sees this only for
            their own loan — `activeLoanContext` returns no one else's. */}
        {activeLoan && (
          <div className="rounded-xl px-3.5 py-3" style={{ background: 'rgb(var(--surface-2))' }}>
            <p className="subtle text-[10px] font-bold uppercase tracking-[0.08em]">
              {can(PERM.TXN_VIEW_ALL) ? 'Borrower' : 'Currently borrowed by'}
            </p>
            <p className="mt-0.5 text-[14px] font-bold">{activeLoan.userName}</p>
            <p className="muted mt-0.5 text-xs">
              Due {formatDate(activeLoan.dueDate)} · {dueLabel(activeLoan.dueDate)}
            </p>
          </div>
        )}

        <ToolMetadata facts={facts} />
      </div>

      <div className="space-y-2.5 pt-0.5">
        <PrimaryAction action={primary} onNavigate={onNavigate} />
        <SecondaryActions
          detailHref={`/tools/${tool.id}?from=scan`}
          tool={tool}
          viewingDetails={viewingDetails}
          onToggleDetails={() =>
            setViewingDetails((v) => {
              if (!v) setReporting(false)
              return !v
            })
          }
          reporting={reporting}
          onToggleReport={() =>
            setReporting((v) => {
              if (!v) setViewingDetails(false)
              return !v
            })
          }
          onReported={() => setReporting(false)}
        />
      </div>
    </div>
  )
}
