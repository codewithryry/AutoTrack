import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  HardHat,
  MapPin,
  Pencil,
  RotateCcw,
  Undo2,
  UserCheck,
} from 'lucide-react'
import { ConditionBadge, DetailItem, StatusBadge } from './ui'
import ReportProblemDialog from './ReportProblemDialog'
import ToolImage from './ToolImage'
import * as toolService from '../services/tools'
import * as txnService from '../services/transactions'
import { PERM } from '../utils/permissions'
import { NON_BORROWABLE_REASON, TOOL_STATUS } from '../utils/constants'
import { cx } from '../utils/helpers'
import { dueLabel, formatDate } from '../utils/dates'

/**
 * What a scan resolves to, for every role.
 *
 * This replaces the two panels that used to live in `ScanPage` — one for
 * instructors, one for everybody else. They rendered the same tool, computed
 * the same tone, and drew the same badges and layout; only the buttons at the
 * bottom really differed. Keeping them apart meant every change had to be made
 * twice, and it is why an administrator scanning a label got the *student*
 * panel: they are not an instructor, so they fell through to the other branch
 * and lost the edit, maintenance and serial-number sections entirely.
 *
 * One panel, in the order the spec asks for:
 *
 *     Tool information → Status → Borrowing → Actions
 *
 * Every section and every button is gated on a permission rather than on a role
 * name. That matters here: in this project an instructor holds `TOOL_EDIT` and
 * `MAINTENANCE_MANAGE`, so asking "is this an admin?" would hide controls they
 * are entitled to. Asking `can(PERM.X)` is the same question the service layer
 * asks, so the two cannot disagree.
 *
 * Hiding is only the visible half. `services/tools.js` and
 * `services/transactions.js` call `assertCan` on every write, so a student who
 * types a URL or replays a request is refused by the service whatever this
 * component chose to render.
 */
export default function ToolScanResult({ tool, loan, can, onNavigate, onReset }) {
  const [reporting, setReporting] = useState(false)
  const activeLoan = loan?.transaction
  const borrower = loan?.borrower

  // The same helpers the borrow and return pages use, so the panel can never
  // offer an action the workflow behind it would refuse.
  const eligibility = toolService.borrowEligibility(tool)

  const overdue = tool.status === TOOL_STATUS.OVERDUE || activeLoan?.status === 'Overdue'
  const outOfService = [
    TOOL_STATUS.MAINTENANCE,
    TOOL_STATUS.DAMAGED,
    TOOL_STATUS.LOST,
    TOOL_STATUS.RETIRED,
  ].includes(tool.status)

  /* ---------------------------- what may be done ----------------------------
     Read once, here, so the actions below and the headline above them cannot
     drift apart. */
  const mayIssue = eligibility.ok && can(PERM.BORROW_FOR_OTHERS)
  const mayReceive = !!activeLoan && can(PERM.RETURN_ANY)
  const mayBorrow = eligibility.ok && can(PERM.BORROW) && !can(PERM.BORROW_FOR_OTHERS)
  const mayReturnOwn = !!activeLoan && can(PERM.RETURN) && !mayReceive
  const mayReadAllTxns = can(PERM.TXN_VIEW_ALL)
  const mayEdit = can(PERM.TOOL_EDIT)
  const mayService = can(PERM.MAINTENANCE_VIEW)

  // Staff see who is holding the tool and the record behind it. A student's own
  // loan still shows — `activeLoanContext` only ever returns their own — but
  // somebody else's is not theirs to read.
  const showBorrowerDetail = mayReadAllTxns

  const tone = overdue ? 'danger' : activeLoan ? 'info' : outOfService ? 'warning' : 'success'

  const TONE_BAR = {
    success: 'bg-emerald-500',
    info: 'bg-blue-500',
    warning: 'bg-orange-500',
    danger: 'bg-red-500',
  }
  const TONE_WELL = {
    success: 'bg-emerald-500/12',
    info: 'bg-blue-500/12',
    warning: 'bg-orange-500/12',
    danger: 'bg-red-500/12',
  }
  const TONE_TEXT = {
    success: 'text-emerald-600 dark:text-emerald-400',
    info: 'text-blue-600 dark:text-blue-400',
    warning: 'text-orange-600 dark:text-orange-400',
    danger: 'text-red-600 dark:text-red-400',
  }

  // One line saying what this person is looking at. Staff are working a counter;
  // a student is asking whether they can take the tool.
  const headline = overdue
    ? mayReceive
      ? 'Overdue — recover this tool'
      : 'Overdue'
    : activeLoan
      ? mayReceive
        ? 'On loan — ready to receive'
        : 'On loan'
      : outOfService
        ? `Out of service · ${tool.status}`
        : mayIssue
          ? 'Available to issue'
          : 'Available'

  const ToneIcon =
    tone === 'success' ? CheckCircle2 : tone === 'danger' ? AlertTriangle : tone === 'warning' ? HardHat : Undo2
  const TONE_ICON_COLOUR = {
    success: 'text-emerald-500',
    info: 'text-blue-500',
    warning: 'text-orange-500',
    danger: 'text-red-500',
  }

  // `from=scan` keeps the tool page's back control pointing at the scanner
  // rather than at the inventory — the scan is where this person came from.
  const detailHref = `/tools/${tool.id}?from=scan`

  return (
    <section className="card relative overflow-hidden">
      <span className={cx('absolute inset-x-0 top-0 h-1', TONE_BAR[tone])} />

      <div className="p-4 pt-5 sm:p-5 sm:pt-6">
        {/* ------------------------ tool information ------------------------ */}
        <div className="flex items-start gap-3">
          {/* The picture is what confirms the thing in your hand is the thing
              on the screen — the one question a scan cannot answer on its own.
              `ToolImage` already lazy-loads, falls back to the wrench tile when
              there is no photo, and does the same if the URL fails, so a tool
              without a picture costs nothing and a broken one never shows. */}
          <ToolImage tool={tool} className="h-16 w-16" rounded="rounded-xl" />
          <div className="min-w-0 flex-1">
            <Link
              to={detailHref}
              className="block truncate text-lg font-extrabold leading-tight hover:underline"
            >
              {tool.name}
            </Link>
            <p className="subtle mono mt-0.5 text-sm">{tool.id}</p>
            <p className={cx('mt-1.5 text-xs font-bold', TONE_TEXT[tone])}>{headline}</p>
          </div>
          <span
            className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-xl', TONE_WELL[tone])}
          >
            <ToneIcon className={cx('h-6 w-6', TONE_ICON_COLOUR[tone])} />
          </span>
        </div>

        {/* ------------------------------ status ------------------------------ */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={tool.status} />
          <ConditionBadge condition={tool.condition} />
          <span
            className="badge border-transparent"
            style={{ background: 'rgb(var(--surface-3))', color: 'rgb(var(--text-muted))' }}
          >
            {tool.category}
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4">
          <DetailItem label="Location">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="truncate">{tool.location}</span>
            </span>
          </DetailItem>
          <DetailItem label="Brand / model">
            {[tool.brand, tool.model].filter(Boolean).join(' · ') || '—'}
          </DetailItem>
          {/* The serial number is asset paperwork rather than something a
              borrower needs, so it appears for whoever may edit the record. */}
          {mayEdit && tool.serialNumber && (
            <DetailItem label="Serial number">
              <span className="mono truncate">{tool.serialNumber}</span>
            </DetailItem>
          )}
          {mayEdit && tool.nextMaintenanceDate && (
            <DetailItem label="Next service">{formatDate(tool.nextMaintenanceDate)}</DetailItem>
          )}
        </dl>

        {/* ---------------------------- borrowing ---------------------------- */}
        {activeLoan && (
          <div
            className="mt-4 rounded-lg border p-3.5"
            style={{ background: 'rgb(var(--surface-2))' }}
          >
            <p className="subtle text-[11px] font-bold uppercase tracking-wider">
              {showBorrowerDetail ? 'Borrower' : 'Currently borrowed by'}
            </p>
            <p className="mt-1 text-sm font-bold">{activeLoan.userName}</p>

            {showBorrowerDetail ? (
              <>
                <p className="muted mt-0.5 text-xs">
                  {[borrower?.role ?? activeLoan.userRole, borrower?.email]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-3 border-t pt-3">
                  <DetailItem label="Transaction">
                    <span className="mono truncate">{activeLoan.id}</span>
                  </DetailItem>
                  <DetailItem label="Status">{activeLoan.status}</DetailItem>
                  <DetailItem label="Borrowed">{formatDate(activeLoan.borrowDate)}</DetailItem>
                  <DetailItem label="Due">{formatDate(activeLoan.dueDate)}</DetailItem>
                </dl>
              </>
            ) : (
              <p className="muted mt-0.5 text-xs">
                Since {formatDate(activeLoan.borrowDate)} · due {formatDate(activeLoan.dueDate)}
              </p>
            )}

            <p className={cx('mt-2.5 text-xs font-bold', overdue ? TONE_TEXT.danger : TONE_TEXT.info)}>
              {dueLabel(activeLoan.dueDate)}
            </p>
            {showBorrowerDetail && activeLoan.purpose && (
              <p className="muted mt-1 text-xs leading-relaxed">Purpose: {activeLoan.purpose}</p>
            )}
          </div>
        )}

        {/* Why it cannot be borrowed, when there is no loan to explain it. */}
        {!activeLoan && !eligibility.ok && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-orange-200 bg-orange-50 px-3.5 py-3 dark:border-orange-500/30 dark:bg-orange-500/10">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
            <p className="text-sm font-medium leading-snug text-orange-800 dark:text-orange-200">
              {NON_BORROWABLE_REASON[tool.status] ?? eligibility.reason}
            </p>
          </div>
        )}

        {/* ----------------------------- actions -----------------------------
            The one large primary action first, then the supporting ones. Each
            is gated on the permission the workflow behind it enforces. */}
        <div className="mt-5 space-y-2">
          {mayReceive && (
            <button
              type="button"
              onClick={() => onNavigate(`/return?tool=${tool.id}`)}
              className="btn btn-success btn-lg w-full"
            >
              <Undo2 className="h-4 w-4" />
              Receive return
            </button>
          )}

          {mayReturnOwn && (
            <button
              type="button"
              onClick={() => onNavigate(`/return?tool=${tool.id}`)}
              className={cx(
                'btn btn-lg w-full',
                txnService.returnRequested(activeLoan) ? 'btn-outline' : 'btn-success',
              )}
            >
              <Undo2 className="h-4 w-4" />
              {txnService.returnRequested(activeLoan) ? 'Return requested' : 'Return tool'}
            </button>
          )}

          {mayIssue && (
            <button
              type="button"
              onClick={() => onNavigate(`/borrow?tool=${tool.id}`)}
              className="btn btn-primary btn-lg w-full"
            >
              <UserCheck className="h-4 w-4" />
              Borrow for a student
            </button>
          )}

          {/* Scanning identifies the tool; a student's borrowing still starts as
              one request, on the one page that creates them. No leading icon:
              a filled, full-width primary already reads as the one thing to do
              here, and an arrow beside plain English was decoration rather
              than information. */}
          {mayBorrow && (
            <button
              type="button"
              onClick={() => onNavigate(`/requests/new?tool=${tool.id}`)}
              className="btn btn-primary btn-lg w-full"
            >
              Request to borrow
            </button>
          )}

          {activeLoan && mayReadAllTxns && (
            <Link to={`/transactions?tool=${tool.id}`} className="btn btn-outline w-full">
              <ClipboardList className="h-4 w-4" />
              Open transaction record
            </Link>
          )}

          {outOfService && mayService && (
            <Link to="/maintenance" className="btn btn-outline w-full">
              <HardHat className="h-4 w-4" />
              Open service log
            </Link>
          )}

          {/* Editing and the QR label both live on the tool's own page, which
              already gates them and already owns the form. Linking there rather
              than repeating either here keeps one write path and one label
              workshop, so there is nothing to keep in step. */}
          {mayEdit && (
            <Link to={detailHref} className="btn btn-outline w-full">
              <Pencil className="h-4 w-4" />
              Manage this tool
            </Link>
          )}

          {activeLoan && !mayReceive && !mayReturnOwn && (
            <p className="subtle text-center text-xs">
              Only {activeLoan.userName} or a laboratory instructor can return this tool.
            </p>
          )}

          {/* Every role may report: a student holding a tool is the most
              likely person to notice something wrong with it. What a report
              may contain is decided by the database, not by this button.
              Icon-free, matching the primary above: outlined and full-width
              already reads as secondary next to it. */}
          <button
            type="button"
            onClick={() => setReporting(true)}
            className="btn btn-outline w-full"
          >
            Report a problem
          </button>

          <Link to={detailHref} className="btn btn-outline w-full">
            Tool details
          </Link>

          {/* A navigation row, not a third button: the tool's timeline is
              laboratory record-keeping, offered to whoever may read everyone's
              transactions. No icon on the left — the label alone says what
              this is — and only the chevron on the right as an affordance,
              matching the equivalent row on the tool's own page. */}
          {mayReadAllTxns && (
            <Link
              to={`/tools/${tool.id}/history?from=scan`}
              className="-mb-1 mt-0.5 flex min-h-[44px] items-center justify-between gap-3 border-t
                         px-1 text-sm font-semibold transition-colors hover:bg-black/[0.03]
                         dark:hover:bg-white/5"
            >
              History
              <ArrowRight className="h-4 w-4 shrink-0 opacity-40" />
            </Link>
          )}

          <button type="button" onClick={onReset} className="btn btn-ghost w-full">
            <RotateCcw className="h-4 w-4" />
            Scan another tool
          </button>
        </div>
      </div>

      <ReportProblemDialog
        tool={tool}
        open={reporting}
        onClose={() => setReporting(false)}
      />
    </section>
  )
}
