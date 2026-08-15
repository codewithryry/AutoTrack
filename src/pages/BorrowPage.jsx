import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  MapPin,
  QrCode,
  Repeat,
  Undo2,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react'
import {
  ConditionBadge,
  DetailItem,
  EmptyState,
  ErrorState,
  PageHeader,
  RequestStatusBadge,
  SearchInput,
  SectionCard,
  SelectField,
  SkeletonRows,
  Spinner,
  StatusBadge,
  TextAreaField,
  TextField,
} from '../components/ui'
import Walkthrough, { usePageTour } from '../components/Walkthrough'
import { AutoLocationNotice, useAutoLocation } from '../components/LocationCapture'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useDebounced, useRequests, useReservations, useTools, useUsers } from '../hooks'
import * as toolService from '../services/tools'
import * as txnService from '../services/transactions'
import { ValidationError } from '../services/tools'
import { PERM } from '../utils/permissions'
import {
  REQUEST_STATUS,
  RESERVATION_STATUS,
  TOOL_STATUS,
  USER_STATUS,
} from '../utils/constants'
import { cx, matchesQuery } from '../utils/helpers'
import {
  addDaysISO,
  formatDate,
  formatDateTime,
  fromDateInput,
  toDateInput,
  todayInput,
} from '../utils/dates'

/**
 * Borrow desk — and the operational side of an approved request.
 *
 * Step 1 picks the tool (pre-filled when arriving from a scan), step 2 confirms
 * borrower and dates. Staff issue directly; a student who has not been approved
 * for the tool raises one request instead, which staff decide on the Requests
 * page.
 *
 * Everything already approved is listed at the top as *ready to borrow*: who it
 * was approved for, who approved it and when, and the button that turns that
 * approval into the loan. Approved → Borrowed → Returned all happen here, and
 * the request behind it is left alone as the approval record.
 */

/**
 * First-run walkthrough for the borrow desk. `Walkthrough` drops any step whose
 * target is absent — the form appears only once a tool is chosen — so the tour
 * stays honest.
 */
const borrowTour = [
  {
    target: 'borrow-ready',
    title: 'Approved and waiting',
    text: 'Requests the laboratory has already approved. Releasing one brings it into the form below with the authorised student filled in.',
  },
  {
    target: 'borrow-list',
    title: 'Select the tool',
    text: 'Everything available for issue, searchable by name, ID, brand or location.',
  },
  {
    target: 'borrow-form',
    title: 'Borrower and dates',
    text: 'Issue to any active user, then set the due date. Your name is recorded as the issuing staff member.',
  },
  {
    target: 'borrow-submit',
    title: 'Confirm the issue',
    text: 'Confirming creates the transaction, marks the tool as borrowed and writes the activity log.',
  },
]

export default function BorrowPage() {
  const { user, can, settings } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const { tools, loading: loadingTools, error: toolsError, reload: reloadTools } = useTools()
  const { users } = useUsers()
  // What approval has already decided: the standing holds, and the requests
  // that created them.
  const { reservations } = useReservations()
  const { requests } = useRequests()

  const preselectedId = searchParams.get('tool')
  // Several tools can leave the crib in one handover, so the selection is a
  // toggle list.
  const [selectedIds, setSelectedIds] = useState(() => (preselectedId ? [preselectedId] : []))
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 200)

  // Once per account on this device, remembered separately from every other page.
  const tour = usePageTour('borrow', user?.id)
  const tourSteps = borrowTour

  const [form, setForm] = useState(() => ({
    userId: '',
    borrowDate: todayInput(),
    dueDate: toDateInput(addDaysISO(new Date(), 3)),
    purpose: '',
    notes: '',
  }))
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  // `submitting` disables the button, but only after React has re-rendered —
  // two taps inside that frame both got through, which is one of the ways a
  // duplicate request was raised. The ref closes the gap synchronously. The
  // service refuses a twin regardless; this stops the second call being made.
  const inFlight = useRef(false)
  // Where the tool is being collected. Null until the borrower asks for a
  // reading, and null again if they refuse or the fix fails — the loan is
  // created either way.
  // The collection point, taken by the flow rather than by a button. `ensure()`
  // in the submit handler is what ties the reading to the loan being created.
  const {
    location: borrowLocation,
    failure: locationFailure,
    ensure: ensureLocation,
  } = useAutoLocation()

  // Default the borrower and the due date once settings and the session are known.
  useEffect(() => {
    setForm((f) => ({
      ...f,
      dueDate: toDateInput(addDaysISO(new Date(), settings.defaultBorrowDays)),
    }))
  }, [settings.defaultBorrowDays])

  useEffect(() => {
    if (preselectedId) setSelectedIds([preselectedId])
  }, [preselectedId])

  // The counter issues what is free right now.
  const poolTools = useMemo(
    () => tools.filter((t) => t.status === TOOL_STATUS.AVAILABLE),
    [tools],
  )

  const visibleTools = useMemo(
    () =>
      poolTools.filter((tool) =>
        matchesQuery(tool, debouncedSearch, ['id', 'name', 'category', 'brand', 'location', 'serialNumber']),
      ),
    [poolTools, debouncedSearch],
  )

  const selectedTools = useMemo(
    () => selectedIds.map((id) => tools.find((t) => t.id === id)).filter(Boolean),
    [tools, selectedIds],
  )
  // Only what is free may be issued.
  const allEligible =
    selectedTools.length > 0 &&
    selectedTools.every((tool) => toolService.borrowEligibility(tool).ok)

  /* ------------------------- approved and waiting ------------------------- */

  // A standing hold is what an approved request leaves behind, so it is the
  // approved item itself. Its request is joined on for who approved it and
  // when — the record staff identify the authorised student by.
  const readyToBorrow = useMemo(
    () =>
      reservations
        .filter((hold) => hold.status === RESERVATION_STATUS.RESERVED)
        .map((hold) => ({
          hold,
          request: requests.find((r) => r.id === hold.requestId) ?? null,
        })),
    [reservations, requests],
  )

  // The approval covering what is on screen right now: this tool, for this
  // borrower. It is what tells the counter the handover in front of them is an
  // approved one, and it is closed by the service when the loan is created.
  const primaryTool = selectedTools[0] ?? null
  const approvalForSelection = useMemo(
    () =>
      primaryTool && form.userId
        ? (readyToBorrow.find(
            ({ hold }) => hold.toolId === primaryTool.id && hold.userId === form.userId,
          ) ?? null)
        : null,
    [readyToBorrow, primaryTool, form.userId],
  )

  /** Bring an approved item into the form below, ready to be confirmed. */
  const startFromApproval = ({ hold }) => {
    setSelectedIds([hold.toolId])
    setForm((f) => ({
      ...f,
      userId: hold.userId,
      borrowDate: todayInput(),
      dueDate: toDateInput(hold.endsAt),
    }))
    setErrors({})
  }

  const borrowerOptions = useMemo(
    () =>
      users
        .filter((u) => u.status === USER_STATUS.ACTIVE)
        .map((u) => ({
          value: u.id,
          label: `${u.fullName} — ${u.role}${u.studentId ? ` (${u.studentId})` : ''}`,
        })),
    [users],
  )

  // One issue can cover as many tools as the handover needs, so the list is a
  // multi-select.
  const toggleTool = (toolId) => {
    setSelectedIds((current) =>
      current.includes(toolId)
        ? current.filter((id) => id !== toolId)
        : [...current, toolId],
    )
    setErrors((e) => ({ ...e, toolId: undefined }))
  }

  const setField = (field) => (event) => {
    const value = event?.target ? event.target.value : event
    setForm((f) => ({ ...f, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    if (inFlight.current) return
    if (!selectedTools.length) {
      setErrors((e) => ({ ...e, toolId: 'Select at least one tool.' }))
      toast.error('Select a tool to borrow first.')
      return
    }
    inFlight.current = true
    setSubmitting(true)
    setErrors({})

    try {
      // Issue the tools there and then — this desk only ever creates loans.
      // A student's ask is raised once on /requests/new and never here, so
      // there is exactly one place a request record comes from.
      //
      // One loan per tool, through the same service the scanner uses: it
      // refuses a tool that is not available, and closes the hold an approval
      // left behind, so the same approval cannot be checked out twice.
      // Taken here, not on mount, so the point is where the handover actually
      // happens. Resolves to null if it is refused or cannot be had, which is
      // exactly what this field has always stored for "not captured".
      const captured = await ensureLocation()

      const details = {
        userId: form.userId,
        borrowDate: fromDateInput(form.borrowDate),
        dueDate: fromDateInput(form.dueDate),
        purpose: form.purpose,
        notes: form.notes,
        borrowLocation: captured,
      }
      const created = []
      for (const tool of selectedTools) {
        created.push(
          await txnService.borrow({ toolId: tool.id, ...details }, user, {
            maxDays: settings.maxBorrowDays,
          }),
        )
      }
      const count = created.length
      // Said plainly either way, so nobody has to guess afterwards whether the
      // pin was stored.
      toast.success(
        captured
          ? `${count} tool${count === 1 ? '' : 's'} borrowed. The collection location was recorded.`
          : `${count} tool${count === 1 ? '' : 's'} borrowed. No collection location was recorded.`,
        { title: count === 1 ? 'Transaction created' : 'Transactions created' },
      )
      navigate(count === 1 ? `/tools/${created[0].toolId}` : '/transactions')
    } catch (err) {
      if (err instanceof ValidationError) {
        setErrors(err.errors)
        toast.error('Please correct the highlighted fields.')
      } else {
        toast.error(err.message ?? 'Unable to complete the borrowing.')
      }
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  const applyPreset = (days) => {
    setForm((f) => ({ ...f, dueDate: toDateInput(addDaysISO(fromDateInput(f.borrowDate) ?? new Date(), days)) }))
    setErrors((e) => ({ ...e, dueDate: undefined }))
  }

  return (
    <>
      {/* The sticky header already names this page on a phone, so the H1 and its
          subtitle are dropped there and kept from `sm` up, exactly as the Scan
          page does it. The desktop layout is untouched. */}
      <PageHeader
        title="Borrow a tool"
        description="Issue laboratory equipment and create a transaction record."
        icon={Repeat}
        hideTitleMobile
      >
        <Link to="/scan" className="btn btn-outline">
          <QrCode className="h-4 w-4" />
          Scan instead
        </Link>
        {/* Receiving a tool is reached from the return request it answers, on
            Requests — this desk issues, and does not offer the other half of
            the counter a second time. */}
      </PageHeader>

      {/* ------------------------ approved · ready to borrow ------------------------
          Everything approval has already decided, waiting to be handed over.
          This is where an approved request becomes a loan — the request itself
          is never touched again, it stays the approval record. */}
      {readyToBorrow.length > 0 && (
        <SectionCard
          className="mb-4"
          title={`Approved · ready to borrow (${readyToBorrow.length})`}
          description="Approved requests waiting to be collected — release the tool to the authorised student"
          bodyClassName="p-0"
          data-tour="borrow-ready"
        >
          <ul className="divide-y">
            {readyToBorrow.map(({ hold, request }) => (
              <li key={hold.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={`/tools/${hold.toolId}`}
                      className="block truncate text-sm font-bold hover:underline"
                    >
                      {hold.toolName}
                    </Link>
                    <p className="subtle mono text-xs">
                      {hold.toolId}
                      {request ? ` · ${request.id}` : ''}
                    </p>
                  </div>
                  <RequestStatusBadge status={request?.status ?? REQUEST_STATUS.APPROVED} />
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <DetailItem label="Student" className="min-w-0">
                    {hold.userName}
                  </DetailItem>
                  <DetailItem label="Approved by" className="min-w-0">
                    {request?.decidedByName ?? '—'}
                  </DetailItem>
                  <DetailItem label="Approved" className="min-w-0" mono>
                    {request?.decidedAt ? formatDateTime(request.decidedAt) : '—'}
                  </DetailItem>
                  <DetailItem label="Return by" className="min-w-0" mono>
                    {formatDate(hold.endsAt)}
                  </DetailItem>
                </dl>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => startFromApproval({ hold })}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                    Release this tool
                  </button>
                  {request && (
                    <Link to={`/requests/${request.id}`} className="btn btn-outline btn-sm">
                      <ClipboardList className="h-3.5 w-3.5" />
                      Approval record
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        {/* ---------------------------- step 1: tool ---------------------------- */}
        <SectionCard
          title="1 · Select a tool"
          description={`${poolTools.length} tools available — select one or more for this issue`}
          bodyClassName="p-0"
          data-tour="borrow-list"
        >
          <div className="border-b p-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search available tools by name, ID or location…"
            />
          </div>

          {toolsError ? (
            <ErrorState
              title="The tool list could not be loaded"
              description={toolsError.message}
              onRetry={reloadTools}
            />
          ) : loadingTools && !tools.length ? (
            <SkeletonRows rows={5} columns={2} />
          ) : visibleTools.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title={search ? 'No matching tools.' : 'No tools are available right now.'}
              description={
                search
                  ? 'Try a different search term, or clear the search to see everything available.'
                  : 'Every tool is currently borrowed, under maintenance or out of service.'
              }
              compact
            />
          ) : (
            <ul className="max-h-[480px] divide-y overflow-y-auto">
              {visibleTools.map((tool) => {
                const active = selectedIds.includes(tool.id)
                return (
                  <li key={tool.id}>
                    <button
                      type="button"
                      onClick={() => toggleTool(tool.id)}
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
                          active
                            ? 'bg-amberline-400 text-navy-950'
                            : 'text-current',
                        )}
                        style={
                          active ? undefined : { background: 'rgb(var(--surface-3))' }
                        }
                      >
                        {active ? (
                          <CheckCircle2 className="h-5 w-5" />
                        ) : (
                          <Wrench className="h-4 w-4 opacity-60" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{tool.name}</span>
                        <span className="subtle block truncate text-xs">
                          <span className="mono">{tool.id}</span> · {tool.category} ·{' '}
                          {tool.location}
                        </span>
                      </span>
                      <ConditionBadge condition={tool.condition} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </SectionCard>

        {/* ---------------------------- step 2: details --------------------------- */}
        <div className="space-y-4">
          {selectedTools.length > 0 ? (
            <>
              <SectionCard title="Selected tools">
                  <ul className="divide-y">
                    {selectedTools.map((tool) => {
                      // An issue happens now, so the tool has to be free now.
                      const toolEligibility = toolService.borrowEligibility(tool)
                      return (
                        <li
                          key={tool.id}
                          className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Link
                                to={`/tools/${tool.id}`}
                                className="block truncate text-sm font-bold hover:underline"
                              >
                                {tool.name}
                              </Link>
                              <StatusBadge status={tool.status} />
                            </div>
                            <p className="subtle mono text-xs">{tool.id}</p>
                            <p className="subtle mt-1 flex items-center gap-1 text-xs">
                              <MapPin className="h-3 w-3 shrink-0 opacity-60" />
                              {tool.category} · {tool.location}
                            </p>
                            {toolEligibility && !toolEligibility.ok && (
                              <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                {toolEligibility.reason}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleTool(tool.id)}
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-black/[0.05] dark:hover:bg-white/5"
                            aria-label={`Remove ${tool.name}`}
                            title="Remove"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </SectionCard>

              <SectionCard title="2 · Borrowing details">
                <form onSubmit={submit} className="space-y-4" noValidate data-tour="borrow-form">
                  <SelectField
                    label="Borrower"
                    required
                    value={form.userId}
                    onChange={setField('userId')}
                    options={borrowerOptions}
                    placeholder="Select the borrower"
                    error={errors.userId}
                    hint="Instructors and administrators may issue tools to any active user."
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <TextField
                      label="Borrow date"
                      type="date"
                      required
                      max={todayInput()}
                      value={form.borrowDate}
                      onChange={setField('borrowDate')}
                      error={errors.borrowDate}
                    />
                    <TextField
                      label="Due date"
                      type="date"
                      required
                      min={form.borrowDate}
                      value={form.dueDate}
                      onChange={setField('dueDate')}
                      error={errors.dueDate}
                    />
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <span className="subtle self-center text-[11px] font-bold uppercase tracking-wider">
                      Quick set
                    </span>
                    {[1, 3, 7, 14].map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => applyPreset(days)}
                        className="btn btn-outline btn-sm"
                      >
                        <CalendarDays className="h-3 w-3" />
                        {days}d
                      </button>
                    ))}
                  </div>

                  <TextField
                    label="Purpose"
                    value={form.purpose}
                    onChange={setField('purpose')}
                    error={errors.purpose}
                    placeholder="e.g. Brake system service practical"
                  />

                  <TextAreaField
                    label="Notes"
                    value={form.notes}
                    onChange={setField('notes')}
                    placeholder="Optional remarks for the tool room."
                    rows={2}
                  />

                  {/* No control: the collection point is taken by the flow when
                      the loan is created. This line only says so. */}
                  <AutoLocationNotice location={borrowLocation} failure={locationFailure} />

                  <button
                    type="submit"
                    className="btn btn-primary btn-lg w-full"
                    disabled={submitting || !allEligible}
                    data-tour="borrow-submit"
                  >
                    {submitting ? <Spinner /> : <ArrowRight className="h-4 w-4" />}
                    {submitting ? 'Creating transaction…' : 'Confirm borrowing'}
                  </button>

                  {approvalForSelection ? (
                    <p className="subtle text-center text-xs leading-relaxed">
                      Releasing an approved request:{' '}
                      {approvalForSelection.request?.id ?? 'the approval'} was approved
                      {approvalForSelection.request?.decidedByName
                        ? ` by ${approvalForSelection.request.decidedByName}`
                        : ''}{' '}
                      for {approvalForSelection.hold.userName}. Confirming checks the tool out and
                      closes the hold.
                    </p>
                  ) : (
                    <p className="subtle text-center text-xs leading-relaxed">
                      Confirming creates {selectedTools.length === 1 ? 'a transaction' : 'the transactions'},
                      marks the tool{selectedTools.length === 1 ? '' : 's'} as borrowed and records the
                      activity in the laboratory log.
                    </p>
                  )}
                </form>
              </SectionCard>
            </>
          ) : (
            <SectionCard title="Selected tools">
              <EmptyState
                icon={PackageSearch}
                title="No tool selected."
                description="Pick one or more available tools from the list to issue them together."
                compact
              />
            </SectionCard>
          )}

          <div
            className="rounded-lg border px-3.5 py-3"
            style={{ background: 'rgb(var(--surface-2))' }}
          >
            <p className="flex items-center gap-1.5 text-xs font-bold">
              <UserCheck className="h-3.5 w-3.5" />
              Issuing on behalf of a student
            </p>
            <p className="subtle mt-1 text-xs leading-relaxed">
              Your name is recorded as the issuing staff member on the transaction, alongside the
              student who takes the tool.
            </p>
          </div>
        </div>
      </div>

      <Walkthrough steps={tourSteps} open={tour.open} onClose={tour.close} />
    </>
  )
}
