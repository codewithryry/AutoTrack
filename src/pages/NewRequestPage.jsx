import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Send, X } from 'lucide-react'
import {
  ErrorState,
  SearchInput,
  SectionCard,
  Spinner,
  TextAreaField,
  TextField,
} from '../components/ui'
import { AutoLocationNotice, useAutoLocation } from '../components/LocationCapture'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useDebounced, useRequests, useTools, useTransactions } from '../hooks'
import * as requestService from '../services/requests'
import { fromDateInput, toDateInput, todayInput } from '../utils/dates'
import {
  ACTIVE_TXN_STATUSES,
  OPEN_REQUEST_STATUSES,
  REQUEST_STATUS,
  TOOL_STATUS,
} from '../utils/constants'
import { isStudent } from '../utils/permissions'
import { cx, matchesQuery } from '../utils/helpers'

/**
 * Ask for a tool — the one and only place a borrowing request is created.
 *
 * The form is the request service's own validation drawn on screen — the same
 * `validate()` the service runs before it writes, so nothing is accepted here
 * that would be refused there. Nothing is issued: an approved request creates a
 * hold, and the tool still leaves the crib through the borrow desk.
 *
 * Every role may tick several tools: one submission becomes one request record
 * per tool, all sharing a batch id so staff decide them in one action. A tool
 * the requester already has an open request on is not offered again, and the
 * service refuses a twin regardless.
 */
/** How many matches the student's picker shows at once. */
const MAX_RESULTS = 20

export default function NewRequestPage() {
  const navigate = useNavigate()
  const { user, settings } = useApp()
  const toast = useToast()
  const { tools, loading, error: toolsError, reload: reloadTools } = useTools()
  const { requests } = useRequests()
  // This account's own loans, used to tell a spent approval from a live one.
  const { transactions } = useTransactions()
  const [searchParams] = useSearchParams()

  // Who is asking still decides what may be asked for — a student sees only
  // what is on the shelf — but nobody is limited to one tool any more: one trip
  // to the crib usually means several, and each ticked tool becomes its own
  // request under the same window and purpose, exactly as staff already did.
  const student = isStudent(user)

  const maxDays = settings.maxBorrowDays ?? 30
  const today = todayInput()

  // A job rarely needs one tool, so the form takes a list. Each tool still
  // becomes its own request — that is what staff decide on, and what a hold is
  // created for — but they are raised together, in one go.
  const [toolIds, setToolIds] = useState(() => {
    const preset = searchParams.get('tool')
    return preset ? [preset] : []
  })

  const [form, setForm] = useState(() => ({
    neededFrom: today,
    neededTo: toDateInput(
      new Date(Date.now() + (settings.defaultBorrowDays ?? 3) * 86_400_000),
    ),
    purpose: '',
  }))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  // The student picker's query. Staff never see it.
  const [search, setSearch] = useState('')
  // Where the tool will be collected. Optional: a refusal or a failed fix
  // leaves the request without a collection point and sends it anyway.
  const {
    location: collectionLocation,
    failure: locationFailure,
    ensure: ensureLocation,
  } = useAutoLocation()

  // The tools this person already has an open request on — asking again would
  // be the same ask, so they are not offered.
  //
  // Read against this account's own rows only — never against the tool — so a
  // tool another student has asked for, or is holding, is not blocked here; the
  // inventory's own status and the hold check at approval time are what stop
  // two people claiming it for the same window.
  //
  // An approval that has already been collected and handed back is spent: the
  // borrowing it authorised is over, so the same tool can be asked for again.
  const alreadyRequested = useMemo(() => {
    const mine = requests.filter(
      (r) => r.userId === user?.id && OPEN_REQUEST_STATUSES.includes(r.status),
    )
    const spent = (request) => {
      if (request.status !== REQUEST_STATUS.APPROVED || !request.decidedAt) return false
      const loans = transactions.filter(
        (t) =>
          t.toolId === request.toolId &&
          t.userId === request.userId &&
          new Date(t.borrowDate) >= new Date(request.decidedAt),
      )
      return loans.length > 0 && loans.every((t) => !ACTIVE_TXN_STATUSES.includes(t.status))
    }
    return new Set(mine.filter((r) => !spent(r)).map((r) => r.toolId))
  }, [requests, transactions, user?.id])

  // A student asks for what the inventory has available; staff may ask for any
  // tool that has not been retired, because a request is for a future window.
  //
  // A tool the requester already has an open request on is still listed for a
  // student, marked and not tickable, rather than removed: the reads settle in
  // their own order after a refresh, and silently dropping rows as the requests
  // arrive is what made the list look as though it had emptied itself. Staff
  // keep the list exactly as it was — those rows are filtered out for them.
  const options = useMemo(
    () =>
      tools
        .filter((tool) =>
          student ? tool.status === TOOL_STATUS.AVAILABLE : tool.status !== TOOL_STATUS.RETIRED,
        )
        .filter((tool) => student || !alreadyRequested.has(tool.id))
        .map((tool) => ({
          value: tool.id,
          label: `${tool.name} · ${tool.id}`,
          requested: alreadyRequested.has(tool.id),
        })),
    [tools, student, alreadyRequested],
  )

  // The student's picker is a search box, not a catalogue: with hundreds of
  // tools on the shelf, scrolling the whole inventory to find one is the wrong
  // shape on a phone. Nothing is listed until something is typed, and then only
  // what matches — the same `matchesQuery` fields every other search uses.
  // Staff keep the full list they have always had.
  const debouncedSearch = useDebounced(search, 200)
  const matches = useMemo(() => {
    if (!student) return options
    const term = debouncedSearch.trim()
    if (!term) return []
    const byId = new Map(tools.map((tool) => [tool.id, tool]))
    return options
      .filter((option) =>
        matchesQuery(byId.get(option.value) ?? {}, term, [
          'id',
          'name',
          'brand',
          'model',
          'category',
          'location',
          'serialNumber',
        ]),
      )
      .slice(0, MAX_RESULTS)
  }, [student, options, debouncedSearch, tools])

  // What is already ticked, kept on screen while the search moves on to the
  // next tool — a selection must never be lost behind a query.
  const selected = useMemo(
    () =>
      toolIds.map((id) => ({
        id,
        name: tools.find((tool) => tool.id === id)?.name ?? id,
      })),
    [toolIds, tools],
  )

  const set = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  // Ticking adds, unticking removes — every role builds the same list.
  const toggleTool = (toolId) => {
    setToolIds((current) =>
      current.includes(toolId)
        ? current.filter((value) => value !== toolId)
        : [...current, toolId],
    )
    setErrors((current) => ({ ...current, toolId: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!toolIds.length) {
      setErrors({ toolId: 'Choose at least one tool.' })
      return
    }

    const window = {
      neededFrom: fromDateInput(form.neededFrom),
      neededTo: fromDateInput(form.neededTo),
      purpose: form.purpose,
    }

    // The service's own validation, run once per tool exactly as it will be on
    // the way in — nothing is sent that would be refused there.
    for (const toolId of toolIds) {
      const found = requestService.validate({ toolId, ...window }, { maxDays })
      if (Object.keys(found).length) {
        setErrors(found)
        return
      }
    }

    setBusy(true)
    try {
      // Tools ticked together are one ask: they share a batch id, so staff
      // decide them in one action and every loan they become carries it. Each
      // tool still gets its own record — that is what a hold, a checkout and a
      // return each work on.
      // The collection point, taken as the request is sent rather than when the
      // form opened. Null when refused or unavailable, which the service
      // already treats as "none supplied".
      const captured = await ensureLocation()

      const batchId = toolIds.length > 1 ? requestService.newBatchId() : null
      const saved = []
      for (const toolId of toolIds) {
        saved.push(
          await requestService.create(
            { toolId, ...window, collectionLocation: captured, batchId },
            user,
            { maxDays },
          ),
        )
      }
      toast.success(
        saved.length === 1
          ? `Request ${saved[0].id} was sent to the laboratory staff.`
          : `${saved.length} tools were sent as one request to the laboratory staff.`,
      )
      navigate(saved.length === 1 ? `/requests/${saved[0].id}` : '/requests', { replace: true })
    } catch (err) {
      if (err.errors) setErrors(err.errors)
      toast.error(err.message ?? 'That request could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* No page header and no card heading: the shell's top bar already names
          the page, and the form's own fields say what each one is. */}
      <form onSubmit={submit} className="mx-auto max-w-2xl">
        <SectionCard>
          <div className="space-y-3.5">
            {/* A checklist rather than a picker: one trip to the crib usually
                means several tools, and each ticked one becomes its own
                request under the same window and purpose. */}
            <div>
              {/* The search leads: finding the tool is the first thing done
                  here, and what has been picked reads underneath it. */}
              {student && (
                <div className="mb-2.5">
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="Search the inventory by name, ID, brand or category…"
                  />
                </div>
              )}

              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide">
                Tools <span className="text-red-500">*</span>
              </p>
              {/* What is going on the request, as a list rather than a row of
                  chips: one tool per line, named the same way the results are,
                  and each one removable without finding it in the search again.
                  It stays put while the search moves on to the next tool. */}
              {student && selected.length > 0 && (
                <ul
                  className="mb-1.5 divide-y overflow-hidden rounded-xl border"
                  style={{ background: 'rgb(var(--surface-2))' }}
                >
                  {selected.map((item) => (
                    <li
                      key={item.id}
                      className="flex min-h-[40px] items-center gap-2 px-3 py-1.5 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate font-semibold">{item.name}</span>
                      <span className="mono subtle shrink-0 text-[11px]">{item.id}</span>
                      <button
                        type="button"
                        onClick={() => toggleTool(item.id)}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors
                                   hover:bg-black/5 dark:hover:bg-white/10"
                        aria-label={`Remove ${item.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* The results box only exists once there is something to show:
                  a student with an empty query gets the one-line hint below
                  instead of an empty panel taking up the screen. */}
              {student && !debouncedSearch.trim() && options.length > 0 ? null : (
              <div className="max-h-64 overflow-y-auto rounded-xl border">
                {/* Four states, kept apart: still loading, a failed read with
                    nothing to fall back on, a read that genuinely returned
                    nothing, and the list itself. A failure is never rendered as
                    an empty inventory — that is what made the list look as if
                    it had vanished on refresh. A failed revalidation that still
                    has the previous read to show keeps showing it. */}
                {loading ? (
                  <p className="muted p-3 text-sm">Loading tools…</p>
                ) : toolsError && tools.length === 0 ? (
                  <ErrorState
                    title="The tool list could not be loaded."
                    description={toolsError.message}
                    onRetry={reloadTools}
                  />
                ) : options.length === 0 ? (
                  <p className="muted p-3 text-sm">
                    {tools.length === 0
                      ? 'The inventory has no tools to request yet.'
                      : !student && alreadyRequested.size
                        ? 'Every available tool is already on one of your open requests.'
                        : 'No tool is on the shelf right now.'}
                  </p>
                ) : matches.length === 0 ? (
                  <p className="muted p-3 text-sm">
                    No available tool matches “{debouncedSearch.trim()}”.
                  </p>
                ) : (
                  matches.map((option) => (
                    <label
                      key={option.value}
                      className={cx(
                        'flex min-h-[44px] items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0',
                        option.requested
                          ? 'cursor-not-allowed opacity-60'
                          : 'cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0"
                        checked={toolIds.includes(option.value)}
                        disabled={option.requested}
                        onChange={() => toggleTool(option.value)}
                      />
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {option.requested && (
                        <span className="subtle shrink-0 text-[11px] font-bold">
                          already requested
                        </span>
                      )}
                    </label>
                  ))
                )}
              </div>
              )}
              {/* Only what the list itself does not already say: the error, the
                  prompt while nothing is picked, and the note that a long
                  search was truncated. Counting the rows back to the reader is
                  a line for nothing. */}
              {(() => {
                const note = errors.toolId
                  ? errors.toolId
                  : !toolIds.length
                    ? student
                      ? 'Search, then tick every tool you need for this job.'
                      : 'Tick every tool you need for this job.'
                    : student && matches.length === MAX_RESULTS
                      ? `Showing the first ${MAX_RESULTS} matches — refine the search for more.`
                      : null
                if (!note) return null
                return (
                  <p className={cx('mt-1 text-xs', errors.toolId ? 'text-red-500' : 'muted')}>
                    {note}
                  </p>
                )
              })()}
            </div>

            {/* The two dates are one answer — the window — so they stay on one
                line at every width, phone included. `min-w-0` on the cells lets
                the date inputs shrink inside the row instead of widening it. */}
            <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0 sm:gap-4">
              <TextField
                label="Needed from"
                type="date"
                required
                min={today}
                value={form.neededFrom}
                onChange={set('neededFrom')}
                error={errors.neededFrom}
              />
              <TextField
                label="Return by"
                type="date"
                required
                min={form.neededFrom || today}
                value={form.neededTo}
                onChange={set('neededTo')}
                error={errors.neededTo}
                hint={`Up to ${maxDays} days.`}
              />
            </div>

            <TextAreaField
              // The note sits on the label's own line rather than under the
              // box — a row of type saved on a phone — but keeps its own
              // weight and case, so it still reads as a note and not as part
              // of the field's name.
              label={
                <>
                  Purpose
                  <span className="subtle ml-1.5 text-[11px] font-medium normal-case tracking-normal">
                    optional, helps staff decide quickly
                  </span>
                </>
              }
              rows={3}
              maxLength={300}
              value={form.purpose}
              onChange={set('purpose')}
              error={errors.purpose}
              placeholder="What is the tool for?"
            />

            {/* The collection point, captured once with the request — the same
                reading the borrow desk takes, kept on the request so staff know
                where to have the tool ready. */}
            {/* Never in the way: a refusal, a failure or a device that cannot
                report one all leave `null`, which is what "no location" is
                stored as — the request still sends. */}
            <AutoLocationNotice location={collectionLocation} failure={locationFailure} />
          </div>
        </SectionCard>

        {/* The actions sit under the card and clear of the bottom bar on a
            phone, where the shell already reserves the room. */}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Link to="/requests" className="btn btn-outline">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner /> : <Send className="h-4 w-4" />}
            Send request
          </button>
        </div>
      </form>
    </>
  )
}
