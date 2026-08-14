import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  MapPin,
  QrCode,
  Repeat,
  Search,
  Undo2,
  UserCheck,
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
  SelectField,
  SkeletonRows,
  Spinner,
  StatusBadge,
  TextAreaField,
  TextField,
} from '../components/ui'
import Walkthrough, { usePageTour } from '../components/Walkthrough'
import { LocationCaptureField } from '../components/LocationCapture'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useDebounced, useTools, useUsers } from '../hooks'
import * as toolService from '../services/tools'
import * as txnService from '../services/transactions'
import { ValidationError } from '../services/tools'
import { isStudent, PERM } from '../utils/permissions'
import { TOOL_STATUS, USER_STATUS } from '../utils/constants'
import { cx, matchesQuery } from '../utils/helpers'
import { addDaysISO, fromDateInput, toDateInput, todayInput } from '../utils/dates'

/**
 * Borrow desk.
 *
 * Step 1 picks the tool (pre-filled when arriving from a scan), step 2 confirms
 * borrower and dates. Students can only ever select themselves.
 */

/**
 * First-run walkthrough for the borrow desk. A student is taking a tool out for
 * themselves, so their wording says so; staff are issuing one on someone else's
 * behalf and get their own. `Walkthrough` drops any step whose target is absent
 * — the form appears only once a tool is chosen — so the tour stays honest.
 */
const borrowTour = (student) =>
  student
    ? [
        {
          target: 'borrow-list',
          title: 'Pick your tool',
          text: 'Only tools that are free right now are listed. Search by name, ID or shelf, then tap one to select it.',
        },
        {
          target: 'borrow-form',
          title: 'Check the dates',
          text: 'Your own name is filled in — you borrow under your account. Set the return date, or tap a quick-set button.',
        },
        {
          target: 'borrow-submit',
          title: 'Confirm and collect',
          text: 'Confirming records the loan against your account and marks the tool as borrowed. It then shows on your dashboard until you return it.',
        },
      ]
    : [
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
  // Empty for a student — they may only borrow for themselves, and the security
  // rules do not let them read the directory.
  const { users } = useUsers()

  const preselectedId = searchParams.get('tool')
  const [selectedId, setSelectedId] = useState(preselectedId ?? '')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 200)

  const canBorrowForOthers = can(PERM.BORROW_FOR_OTHERS)

  // Once per account on this device, remembered separately from every other page.
  const tour = usePageTour('borrow', user?.id)
  const tourSteps = useMemo(() => borrowTour(isStudent(user)), [user])

  const [form, setForm] = useState(() => ({
    userId: '',
    borrowDate: todayInput(),
    dueDate: toDateInput(addDaysISO(new Date(), 3)),
    purpose: '',
    notes: '',
  }))
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  // Where the tool is being collected. Null until the borrower asks for a
  // reading, and null again if they refuse or the fix fails — the loan is
  // created either way.
  const [borrowLocation, setBorrowLocation] = useState(null)

  // Default the borrower and the due date once settings and the session are known.
  useEffect(() => {
    setForm((f) => ({
      ...f,
      userId: f.userId || (canBorrowForOthers ? '' : (user?.id ?? '')),
      dueDate: toDateInput(addDaysISO(new Date(), settings.defaultBorrowDays)),
    }))
  }, [user?.id, canBorrowForOthers, settings.defaultBorrowDays])

  useEffect(() => {
    if (preselectedId) setSelectedId(preselectedId)
  }, [preselectedId])

  const availableTools = useMemo(
    () => tools.filter((t) => t.status === TOOL_STATUS.AVAILABLE),
    [tools],
  )

  const visibleTools = useMemo(
    () =>
      availableTools.filter((tool) =>
        matchesQuery(tool, debouncedSearch, ['id', 'name', 'category', 'brand', 'location', 'serialNumber']),
      ),
    [availableTools, debouncedSearch],
  )

  const selectedTool = tools.find((t) => t.id === selectedId) ?? null
  const eligibility = selectedTool ? toolService.borrowEligibility(selectedTool) : null

  const borrowerOptions = useMemo(() => {
    const active = users.filter((u) => u.status === USER_STATUS.ACTIVE)
    if (canBorrowForOthers) {
      return active.map((u) => ({
        value: u.id,
        label: `${u.fullName} — ${u.role}${u.studentId ? ` (${u.studentId})` : ''}`,
      }))
    }
    return user ? [{ value: user.id, label: `${user.fullName} — ${user.role}` }] : []
  }, [users, canBorrowForOthers, user])

  const setField = (field) => (event) => {
    const value = event?.target ? event.target.value : event
    setForm((f) => ({ ...f, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!selectedTool) {
      toast.error('Select a tool to borrow first.')
      return
    }
    setSubmitting(true)
    setErrors({})

    try {
      const txn = await txnService.borrow(
        {
          toolId: selectedTool.id,
          userId: form.userId,
          borrowDate: fromDateInput(form.borrowDate),
          dueDate: fromDateInput(form.dueDate),
          purpose: form.purpose,
          notes: form.notes,
          borrowLocation,
        },
        user,
        { maxDays: settings.maxBorrowDays },
      )
      // Said plainly either way, so nobody has to guess afterwards whether the
      // pin was stored.
      toast.success(
        borrowLocation
          ? `${selectedTool.name} borrowed. The collection location was recorded.`
          : `${selectedTool.name} borrowed. No collection location was recorded.`,
        { title: 'Transaction created' },
      )
      navigate(`/tools/${txn.toolId}`)
    } catch (err) {
      if (err instanceof ValidationError) {
        setErrors(err.errors)
        toast.error('Please correct the highlighted fields.')
      } else {
        toast.error(err.message ?? 'Unable to complete the borrowing.')
      }
    } finally {
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
        hideTitle={isStudent(user)}
      >
        {/* A student reaches Scan and Return from the bottom bar, so the header
            shortcuts only repeat navigation they already have. Staff, whose bar
            does not carry these routes, keep both. */}
        {!isStudent(user) && (
          <>
            <Link to="/scan" className="btn btn-outline">
              <QrCode className="h-4 w-4" />
              Scan instead
            </Link>
            {can(PERM.RETURN) && (
              <Link to="/return" className="btn btn-outline">
                <Undo2 className="h-4 w-4" />
                Return a tool
              </Link>
            )}
          </>
        )}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        {/* ---------------------------- step 1: tool ---------------------------- */}
        <SectionCard
          title="1 · Select a tool"
          description={`${availableTools.length} tools are available for borrowing`}
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
              title={search ? 'No matching tools available.' : 'No tools are available right now.'}
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
                const active = tool.id === selectedId
                return (
                  <li key={tool.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(tool.id)}
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
          {selectedTool ? (
            <>
              <SectionCard title="Selected tool">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={`/tools/${selectedTool.id}`}
                      className="block truncate text-sm font-bold hover:underline"
                    >
                      {selectedTool.name}
                    </Link>
                    <p className="subtle mono text-xs">{selectedTool.id}</p>
                  </div>
                  <StatusBadge status={selectedTool.status} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <DetailItem label="Category">{selectedTool.category}</DetailItem>
                  <DetailItem label="Condition">
                    <ConditionBadge condition={selectedTool.condition} />
                  </DetailItem>
                  <DetailItem label="Location" className="col-span-2">
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      {selectedTool.location}
                    </span>
                  </DetailItem>
                </dl>

                {eligibility && !eligibility.ok && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-500/30 dark:bg-red-500/10">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                    <p className="text-xs font-medium text-red-800 dark:text-red-200">
                      {eligibility.reason}
                    </p>
                  </div>
                )}
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
                    disabled={!canBorrowForOthers}
                    hint={
                      canBorrowForOthers
                        ? 'Instructors and administrators may issue tools to any active user.'
                        : 'Students borrow tools under their own account.'
                    }
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

                  <LocationCaptureField
                    value={borrowLocation}
                    onChange={setBorrowLocation}
                    title="Where is this tool being collected?"
                    description="One reading, taken now, stored as the loan's collection point. It records where the tool changed hands — not where it goes afterwards."
                    disabled={submitting}
                  />

                  <button
                    type="submit"
                    className="btn btn-primary btn-lg w-full"
                    disabled={submitting || !eligibility?.ok}
                    data-tour="borrow-submit"
                  >
                    {submitting ? <Spinner /> : <ArrowRight className="h-4 w-4" />}
                    {submitting ? 'Creating transaction…' : 'Confirm borrowing'}
                  </button>

                  <p className="subtle text-center text-xs leading-relaxed">
                    Confirming creates a transaction, marks the tool as borrowed and records the
                    activity in the laboratory log.
                  </p>
                </form>
              </SectionCard>
            </>
          ) : (
            <SectionCard title="Selected tool">
              <EmptyState
                icon={Search}
                title="No tool selected."
                description="Choose an available tool from the list, or scan its QR code to jump straight here."
                compact
                action={
                  <Link to="/scan" className="btn btn-primary">
                    <QrCode className="h-4 w-4" />
                    Scan a tool
                  </Link>
                }
              />
            </SectionCard>
          )}

          {can(PERM.BORROW_FOR_OTHERS) && (
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
          )}
        </div>
      </div>

      <Walkthrough steps={tourSteps} open={tour.open} onClose={tour.close} compact={isStudent(user)} />
    </>
  )
}
