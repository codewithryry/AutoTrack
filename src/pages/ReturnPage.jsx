import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  Repeat,
  Wrench,
} from 'lucide-react'
import {
  ConditionBadge,
  DetailItem,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  SectionCard,
  SkeletonRows,
  Spinner,
  TextAreaField,
  TxnStatusBadge,
} from '../components/ui'
import { LocationCaptureField } from '../components/LocationCapture'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useDebounced, useTransactions } from '../hooks'
import * as txnService from '../services/transactions'
import { ValidationError } from '../services/tools'
import { canReturnTransaction, PERM } from '../utils/permissions'
import { CONDITION, RETURN_CONDITIONS, TXN_STATUS } from '../utils/constants'
import { cx, matchesQuery } from '../utils/helpers'
import { dueLabel, formatDate } from '../utils/dates'

const CONDITION_COPY = {
  [CONDITION.EXCELLENT]: 'As new — no wear, ready for immediate reissue.',
  [CONDITION.GOOD]: 'Normal working order with expected wear.',
  [CONDITION.FAIR]: 'Usable but showing wear; flag it for inspection.',
  [CONDITION.DAMAGED]: 'Broken or unsafe — the tool is pulled from circulation.',
}

const CONDITION_TONE = {
  [CONDITION.EXCELLENT]: 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10',
  [CONDITION.GOOD]: 'border-teal-400 bg-teal-50 dark:bg-teal-500/10',
  [CONDITION.FAIR]: 'border-amber-400 bg-amber-50 dark:bg-amber-500/10',
  [CONDITION.DAMAGED]: 'border-red-400 bg-red-50 dark:bg-red-500/10',
}

/**
 * Return desk.
 *
 * Lists every loan the signed-in role may close, then runs the condition check
 * that decides whether the tool goes back on the shelf or into the damaged pile.
 */
export default function ReturnPage() {
  const { user, can } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const { transactions, loading, error, reload } = useTransactions()
  const preselectedTool = searchParams.get('tool')

  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 200)

  const [condition, setCondition] = useState(CONDITION.GOOD)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  // Where the tool is being handed back. Independent of the collection point —
  // the two are stored and shown as separate readings, never as a route.
  const [returnLocation, setReturnLocation] = useState(null)

  const openLoans = useMemo(
    () =>
      transactions
        .filter((t) => t.status === TXN_STATUS.BORROWED || t.status === TXN_STATUS.OVERDUE)
        .filter((t) => canReturnTransaction(user, t)),
    [transactions, user],
  )

  const visibleLoans = useMemo(
    () =>
      openLoans.filter((t) =>
        matchesQuery(t, debouncedSearch, ['toolId', 'toolName', 'userName', 'purpose']),
      ),
    [openLoans, debouncedSearch],
  )

  // Jump straight to the loan when arriving from a scan or the dashboard.
  useEffect(() => {
    if (!preselectedTool || !openLoans.length) return
    const match = openLoans.find((t) => t.toolId === preselectedTool)
    if (match) setSelectedId(match.id)
  }, [preselectedTool, openLoans])

  const selected = openLoans.find((t) => t.id === selectedId) ?? null

  // A borrower who does not work the counter can only ask for the return; staff
  // confirm it. `BORROW_FOR_OTHERS` is the existing "works the crib" permission.
  const asksOnly = !can(PERM.BORROW_FOR_OTHERS)
  const alreadyAsked = txnService.returnRequested(selected)

  const submit = async (event) => {
    event.preventDefault()
    if (!selected) {
      toast.error('Select the tool being returned.')
      return
    }
    setSubmitting(true)
    setErrors({})

    try {
      // A student asks; the crib confirms. Same record, same service, two
      // steps — nothing is closed here for a borrower.
      if (asksOnly) {
        await txnService.requestReturn(
          { transactionId: selected.id, condition, notes },
          user,
        )
        toast.success(
          `Staff have been asked to receive ${selected.toolName}. Hand it in at the crib.`,
          { title: 'Return requested' },
        )
        setSelectedId('')
        setNotes('')
        setCondition(CONDITION.GOOD)
        setReturnLocation(null)
        return
      }

      await txnService.returnTool(
        { transactionId: selected.id, condition, notes, returnLocation },
        user,
      )

      const where = returnLocation
        ? 'The return location was recorded.'
        : 'No return location was recorded.'

      if (condition === CONDITION.DAMAGED) {
        toast.warning(
          `${selected.toolName} was returned damaged and removed from circulation. ${where}`,
          { title: 'Tool returned — damaged' },
        )
      } else {
        toast.success(`Tool successfully returned. ${where}`, { title: selected.toolName })
      }

      setSelectedId('')
      setNotes('')
      setCondition(CONDITION.GOOD)
      setReturnLocation(null)
      navigate(`/tools/${selected.toolId}`)
    } catch (err) {
      if (err instanceof ValidationError) {
        setErrors(err.errors)
        toast.error('Please correct the highlighted fields.')
      } else {
        toast.error(err.message ?? 'Unable to complete the return.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* The sticky top bar already names this page, and the numbered steps
          below say what it does — so the H1, the subtitle and the scan shortcut
          are dropped: returning is not a scanning flow. The Scan page itself is
          untouched. */}
      {/* This page closes borrowings and nothing else: issuing is reached from
          the approved request it belongs to, on Requests, so neither half of
          the counter is offered from two places. */}
      <PageHeader hideTitle />

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        {/* ------------------------- open loans ------------------------- */}
        <SectionCard
          title="1 · Select the tool being returned"
          description={`${openLoans.length} tool${openLoans.length === 1 ? '' : 's'} currently out`}
          bodyClassName="p-0"
        >
          <div className="border-b p-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search by tool, ID or borrower…"
            />
          </div>

          {error ? (
            <ErrorState
              title="Open borrowings could not be loaded"
              description={error.message}
              onRetry={reload}
            />
          ) : loading && !transactions.length ? (
            <SkeletonRows rows={4} columns={2} />
          ) : visibleLoans.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={search ? 'No matching borrowings.' : 'Nothing is out right now.'}
              description={
                search
                  ? 'No open borrowing matches that search.'
                  : 'Every tool has been returned to the laboratory.'
              }
              compact
            />
          ) : (
            <ul className="max-h-[520px] divide-y overflow-y-auto">
              {visibleLoans.map((txn) => {
                const active = txn.id === selectedId
                const overdue = txn.status === TXN_STATUS.OVERDUE
                return (
                  <li key={txn.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(txn.id)}
                      className={cx(
                        'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                        active
                          ? 'bg-amberline-400/10'
                          : 'hover:bg-black/[0.03] dark:hover:bg-white/5',
                      )}
                      aria-pressed={active}
                    >
                      <span
                        className={cx(
                          'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                          active && 'bg-amberline-400 text-navy-950',
                        )}
                        style={active ? undefined : { background: 'rgb(var(--surface-3))' }}
                      >
                        {active ? (
                          <CheckCircle2 className="h-5 w-5" />
                        ) : (
                          <Wrench className="h-4 w-4 opacity-60" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{txn.toolName}</span>
                        <span className="subtle block truncate text-xs">
                          <span className="mono">{txn.toolId}</span> · {txn.userName}
                        </span>
                        <span
                          className={cx(
                            'mt-0.5 block text-[11px] font-bold',
                            overdue ? 'text-red-600 dark:text-red-400' : 'subtle',
                          )}
                        >
                          {dueLabel(txn.dueDate)}
                          {txnService.returnRequested(txn) && ' · return requested'}
                        </span>
                      </span>
                      <TxnStatusBadge status={txn.status} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </SectionCard>

        {/* ------------------------- condition check ------------------------- */}
        <div className="space-y-4">
          {selected ? (
            <>
              <SectionCard title="Loan record">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={`/tools/${selected.toolId}`}
                      className="block truncate text-sm font-bold hover:underline"
                    >
                      {selected.toolName}
                    </Link>
                    <p className="subtle mono text-xs">{selected.toolId}</p>
                  </div>
                  <TxnStatusBadge status={selected.status} />
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <DetailItem label="Borrower">{selected.userName}</DetailItem>
                  <DetailItem label="Role">{selected.userRole}</DetailItem>
                  <DetailItem label="Borrowed" mono>
                    {formatDate(selected.borrowDate)}
                  </DetailItem>
                  <DetailItem label="Due" mono>
                    {formatDate(selected.dueDate)}
                  </DetailItem>
                  <DetailItem label="Condition when issued" className="col-span-2">
                    <ConditionBadge condition={selected.conditionOut} />
                  </DetailItem>
                  {selected.purpose && (
                    <DetailItem label="Purpose" className="col-span-2">
                      <span className="muted font-normal">{selected.purpose}</span>
                    </DetailItem>
                  )}
                </dl>

                {selected.status === TXN_STATUS.OVERDUE && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-500/30 dark:bg-red-500/10">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                    <p className="text-xs font-medium text-red-800 dark:text-red-200">
                      This tool is overdue — {dueLabel(selected.dueDate).toLowerCase()}. The late
                      return is recorded against the transaction.
                    </p>
                  </div>
                )}
              </SectionCard>

              {/* Already handed in and waiting on the counter — stated on the
                  record so neither the borrower nor staff ask twice. */}
              {alreadyAsked && (
                <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 dark:border-blue-500/30 dark:bg-blue-500/10">
                  <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
                  <p className="text-xs font-medium leading-snug text-blue-800 dark:text-blue-200">
                    Return requested on {formatDate(selected.returnRequestedAt)}
                    {selected.returnRequestCondition
                      ? ` · reported ${selected.returnRequestCondition}`
                      : ''}
                    . {asksOnly
                      ? 'Laboratory staff will confirm it when the tool is handed in.'
                      : 'Confirm it below once the tool is physically back.'}
                  </p>
                </div>
              )}

              <SectionCard
                title="2 · Condition check"
                description={
                  asksOnly
                    ? 'Tell the crib what condition you are handing it back in'
                    : 'Inspect the tool before accepting it back'
                }
              >
                <form onSubmit={submit} className="space-y-4" noValidate>
                  <fieldset>
                    <legend className="label mb-2">
                      Returned condition <span className="text-red-500">*</span>
                    </legend>
                    <div className="space-y-2">
                      {RETURN_CONDITIONS.map((option) => {
                        const active = condition === option
                        return (
                          <label
                            key={option}
                            className={cx(
                              'flex cursor-pointer items-start gap-3 rounded-lg border-2 px-3 py-2.5 transition-all',
                              active
                                ? CONDITION_TONE[option]
                                : 'hover:bg-black/[0.03] dark:hover:bg-white/5',
                            )}
                            style={active ? undefined : { borderColor: 'rgb(var(--border))' }}
                          >
                            <input
                              type="radio"
                              name="condition"
                              value={option}
                              checked={active}
                              onChange={() => {
                                setCondition(option)
                                setErrors((e) => ({ ...e, condition: undefined }))
                              }}
                              className="mt-0.5 h-4 w-4 shrink-0 accent-amberline-500"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-bold">{option}</span>
                              <span className="subtle block text-xs leading-snug">
                                {CONDITION_COPY[option]}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                    {errors.condition && (
                      <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                        {errors.condition}
                      </p>
                    )}
                  </fieldset>

                  {condition === CONDITION.DAMAGED && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-500/30 dark:bg-red-500/10">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                      <p className="text-xs font-medium leading-snug text-red-800 dark:text-red-200">
                        Marking the tool damaged sets its status to <strong>Damaged</strong>, blocks
                        further borrowing and raises a notification for the laboratory
                        administrator.
                      </p>
                    </div>
                  )}

                  <TextAreaField
                    label="Inspection notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Ratchet mechanism slips under load; calibration sticker missing."
                    rows={3}
                  />

                  {/* The return point is recorded when the tool is actually
                      received, so only the counter captures it. */}
                  {!asksOnly && (
                    <LocationCaptureField
                      value={returnLocation}
                      onChange={setReturnLocation}
                      title="Where is this tool being handed back?"
                      description="One reading, taken now, stored as the borrowing's return point. It is kept separately from where the tool was collected."
                      disabled={submitting}
                    />
                  )}

                  <button
                    type="submit"
                    className={cx(
                      'btn btn-lg w-full',
                      condition === CONDITION.DAMAGED ? 'btn-danger' : 'btn-success',
                    )}
                    disabled={submitting || (asksOnly && alreadyAsked)}
                  >
                    {submitting ? <Spinner /> : <ClipboardCheck className="h-4 w-4" />}
                    {submitting
                      ? asksOnly
                        ? 'Sending request…'
                        : 'Processing return…'
                      : asksOnly
                        ? alreadyAsked
                          ? 'Return already requested'
                          : 'Request return'
                        : 'Confirm return'}
                  </button>

                  <p className="subtle text-center text-xs leading-relaxed">
                    {asksOnly
                      ? 'The tool stays on your record until laboratory staff receive it at the crib and confirm the return.'
                      : 'The transaction is closed, the tool status updated and the activity written to the laboratory log.'}
                  </p>
                </form>
              </SectionCard>
            </>
          ) : (
            <SectionCard title="Loan record">
              <EmptyState
                icon={ClipboardCheck}
                title="No borrowing selected."
                description="Pick a tool from the list to check it back in."
                compact
              />
            </SectionCard>
          )}

          <div
            className="rounded-lg border px-3.5 py-3"
            style={{ background: 'rgb(var(--surface-2))' }}
          >
            <p className="flex items-center gap-1.5 text-xs font-bold">
              <MapPin className="h-3.5 w-3.5" />
              Put the tool back where it belongs
            </p>
            <p className="subtle mt-1 text-xs leading-relaxed">
              {selected
                ? `Return this tool to its storage position after the check is complete.`
                : 'Each tool has a fixed storage position shown on its record.'}
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
