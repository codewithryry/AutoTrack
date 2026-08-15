import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, CheckCircle2, FileCheck2, Plus, Undo2 } from 'lucide-react'
import {
  EmptyState,
  ErrorState,
  FilterSelect,
  MobileFilterBar,
  RequestStatusBadge,
  ReservationStatusBadge,
  SearchInput,
  SectionCard,
  SkeletonRows,
} from '../components/ui'
import Walkthrough, { usePageTour } from '../components/Walkthrough'
import { useApp } from '../context/AppContext'
import { useDebounced, useRequests, useReservations, useTransactions } from '../hooks'
import * as txnService from '../services/transactions'
import { formatDate, timeAgo } from '../utils/dates'
import {
  ACTIVE_TXN_STATUSES,
  REQUEST_STATUS,
  REQUEST_STATUSES,
  RESERVATION_STATUS,
} from '../utils/constants'
import { isStaff } from '../utils/permissions'

/**
 * Tool requests — one page, three readings of it.
 *
 * For a student this is the single place their borrowing lives before the tool
 * is in their hands: one request per tool, its state (Pending, Approved,
 * Rejected, Cancelled). Approving is the issue itself — the tool goes out with
 * the decision — so there is nothing here for a student to confirm, and an
 * approval is never raised again.
 *
 * For staff it is the queue of everyone's asks waiting to be decided. The list
 * a role may see is decided by `useRequests`, which filters to what the
 * policies already return.
 */
/**
 * The requests walkthrough, once per account on this device.
 *
 * Staff and a student are looking at two different jobs on the same page — a
 * queue to decide, and one ask to follow — so each gets its own sequence rather
 * than a shared one with steps that do not apply. Every step points at an
 * element that is really on this page, and `Walkthrough` drops any whose target
 * is absent, so a clear queue or a student with no holds shortens the tour
 * honestly rather than highlighting nothing.
 */
const requestsTour = (staff) =>
  staff
    ? [
        {
          title: 'The request queue',
          text: 'Everything students have asked to borrow, waiting on a decision from the crib. Whatever is still pending sits at the top.',
        },
        {
          target: 'requests-returns',
          title: 'Tools coming back',
          text: 'The other end of the same queue: borrowers who have asked to hand a tool back. Confirm return opens the return desk, which is the one place a loan is closed.',
        },
        {
          target: 'requests-filters',
          title: 'Find one ask',
          text: 'Search by request, tool or requester. The status filter opens on Pending — set it to All statuses to see what has already been decided.',
        },
        {
          target: 'requests-list',
          title: 'Decide a request',
          text: 'Open a row for the full ask and approve or reject it there. Approving is the issue itself: it places the hold that keeps the tool for that student.',
        },
      ]
    : [
        {
          title: 'Your requests, start to finish',
          text: 'Asking for a tool starts here, and this is where the ask lives until staff decide it — Pending, then Approved or Rejected.',
        },
        {
          target: 'requests-new',
          title: 'Ask for a tool',
          text: 'Raise a request for anything on the shelf. On a phone this is the “+” in the bar at the bottom of the screen.',
        },
        {
          target: 'requests-filters',
          title: 'Find one of yours',
          text: 'Search by tool or reason, and narrow by status when the list gets long.',
        },
        {
          target: 'requests-list',
          title: 'Follow what you asked for',
          text: 'Open a row for the full record and the thread with the crib. Nothing is collected from here — an approved request is handed to you at the counter.',
        },
        {
          target: 'requests-holds',
          title: 'Tools held for you',
          text: 'An approved request reserves the tool until you collect it. It appears here until it is in your hands.',
        },
      ]

export default function RequestsPage() {
  const { user } = useApp()
  const { requests, loading, error, reload } = useRequests()
  const { reservations } = useReservations()
  const { transactions } = useTransactions()

  const staff = isStaff(user)
  // Once per account on this device, remembered separately from every other page.
  const tour = usePageTour('requests', user?.id)
  const tourSteps = useMemo(() => requestsTour(staff), [staff])
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 200)
  const [status, setStatus] = useState(staff ? REQUEST_STATUS.PENDING : 'all')

  const filtered = useMemo(() => {
    const term = debounced.trim().toLowerCase()
    const rows = requests.filter((request) => {
      if (status !== 'all' && request.status !== status) return false
      if (!term) return true
      return [request.id, request.toolName, request.userName, request.purpose]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    })
    // Whatever is still waiting on somebody comes first; the rest stays newest
    // first, which is the order the service returns.
    return [...rows].sort((a, b) => {
      const pending = (r) => (r.status === REQUEST_STATUS.PENDING ? 0 : 1)
      return pending(a) - pending(b)
    })
  }, [requests, debounced, status])

  // A student's own standing holds, so the state of an approved request is on
  // the same screen as the request. Only holds still waiting to be collected:
  // a fulfilled one is the loan, which belongs on Return and then Transactions,
  // not repeated here. Staff have a page of their own for these.
  const myHolds = useMemo(
    () =>
      staff ? [] : reservations.filter((h) => h.status === RESERVATION_STATUS.RESERVED),
    [staff, reservations],
  )

  // The list, grouped by the ask rather than by the row.
  //
  // Rows raised together share a `batchId`, so they are one line here: the ask,
  // how many tools it covers and where it stands overall. A row without one is
  // a group of itself and looks exactly as it always did. Each tool keeps its
  // own record behind the line — borrowing and returning are unchanged.
  const groups = useMemo(() => {
    const out = []
    const seen = new Map()
    for (const request of filtered) {
      if (!request.batchId) {
        out.push({ key: request.id, batchId: null, rows: [request], lead: request })
        continue
      }
      const existing = seen.get(request.batchId)
      if (existing) {
        existing.rows.push(request)
        continue
      }
      const group = {
        key: request.batchId,
        batchId: request.batchId,
        rows: [request],
        lead: request,
      }
      seen.set(request.batchId, group)
      out.push(group)
    }
    // Where a group leads to, and how it reads at a glance: whatever is still
    // waiting on somebody opens first, and the badge follows the same order —
    // Pending over Approved over everything else.
    for (const group of out) {
      const by = (status) => group.rows.filter((r) => r.status === status)
      const pending = by(REQUEST_STATUS.PENDING)
      const approved = by(REQUEST_STATUS.APPROVED)
      group.lead = pending[0] ?? approved[0] ?? group.rows[0]
      group.status = group.lead.status
      group.mixed = group.rows.some((r) => r.status !== group.status)
    }
    return out
  }, [filtered])

  // Tools a borrower has asked to hand back, waiting on the counter to receive
  // them. Staff only — the same queue as the asks above it, at the other end of
  // the borrowing: the loan is still open and only becomes Returned when it is
  // confirmed on the return desk, which is where the button goes.
  const returnRequests = useMemo(() => {
    if (!staff) return []
    return transactions
      .filter((t) => ACTIVE_TXN_STATUSES.includes(t.status) && txnService.returnRequested(t))
      .sort(
        (a, b) => new Date(a.returnRequestedAt ?? 0) - new Date(b.returnRequestedAt ?? 0),
      )
  }, [staff, transactions])

  const statusOptions = [{ value: 'all', label: 'All statuses' }, ...REQUEST_STATUSES]

  return (
    <>
      {/* No page header at any width: the shell's top bar names the page, and
          the list card below carries the count. */}

      {/* ---------------------------- return requests ----------------------------
          The other end of the same queue: borrowers who have asked to hand a
          tool back. Nothing is decided here — the row opens the return desk,
          which is the one place a loan is closed and the tool put back. */}
      {/* Always on screen for staff, empty or not: this is where a return is
          confirmed, and a card that only exists when something is waiting is a
          queue nobody knows to look for. */}
      {staff && (
        <SectionCard
          className="mb-4"
          data-tour="requests-returns"
          title={`Return requests (${returnRequests.length})`}
          description="Tools handed in and waiting for you to confirm the return"
          bodyClassName="p-0"
        >
          {returnRequests.length === 0 && (
            <p className="muted p-4 text-sm">
              Nothing waiting. A borrower's request to hand a tool back appears here, and
              confirming it closes their record and puts the tool back on the shelf.
            </p>
          )}
          <ul className="divide-y">
            {returnRequests.map((txn) => (
              <li key={txn.id} className="flex flex-wrap items-center gap-3 p-4">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="truncate text-sm font-bold">{txn.toolName}</span>
                    <span className="mono subtle text-[11px]">{txn.toolId}</span>
                  </span>
                  <span className="muted mt-0.5 block truncate text-xs">
                    {txn.userName} · requested {timeAgo(txn.returnRequestedAt)}
                    {txn.returnRequestCondition ? ` · reported ${txn.returnRequestCondition}` : ''}
                  </span>
                </span>
                <Link to={`/return?tool=${txn.toolId}`} className="btn btn-success btn-sm">
                  <Undo2 className="h-3.5 w-3.5" />
                  Confirm return
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Raising a request is the requester's own step: staff decide them, they
          do not write them, so the button is theirs alone. On the phone it lives
          in the bottom bar's raised slot instead, so it is desktop-only here. */}
      {!staff && (
      <div className="mb-4 hidden justify-end lg:flex" data-tour="requests-new">
        <Link to="/requests/new" className="btn btn-primary">
          <Plus className="h-4 w-4" />
          New request
        </Link>
      </div>
      )}

      {/* -------------------------------- filters ------------------------------- */}
      <div className="card mb-3 p-2.5 sm:mb-4 sm:p-3" data-tour="requests-filters">
        <div className="space-y-2 sm:space-y-3">
          {/* The status filter sits at the end of the search row on a phone;
              the desktop keeps its own dropdown below. */}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={staff ? 'Search by request, tool or requester…' : 'Search your requests…'}
              />
            </div>
            <div className="sm:hidden">
              <MobileFilterBar
                iconOnly
                filters={[
                  {
                    key: 'status',
                    label: 'Status',
                    value: status,
                    onChange: setStatus,
                    options: statusOptions,
                  },
                ]}
                hasFilters={!!debounced || status !== 'all'}
                onClear={() => {
                  setSearch('')
                  setStatus('all')
                }}
              />
            </div>
          </div>
          <div className="hidden sm:flex">
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={statusOptions}
            />
          </div>
        </div>
      </div>

      {/* -------------------------------- requests ------------------------------ */}
      <SectionCard
        title={
          staff
            ? `Borrow requests (${groups.length})`
            : `${groups.length} request${groups.length === 1 ? '' : 's'}`
        }
        description={staff ? 'Approve or reject what students have asked for' : undefined}
        bodyClassName="p-0"
        data-tour="requests-list"
      >
        {error ? (
          <ErrorState
            title="Requests could not be loaded."
            description={error.message}
            onRetry={reload}
          />
        ) : loading && !requests.length ? (
          <SkeletonRows rows={5} columns={3} />
        ) : filtered.length === 0 ? (
          /* No call to action: raising a request is the "+" in the bottom bar
             on a phone and the button above this card on the desktop, so the
             empty state is the icon and the line that explains it. */
          <EmptyState
            icon={staff ? CheckCircle2 : FileCheck2}
            title={staff ? 'No requests waiting.' : 'Nothing requested yet.'}
            description={
              staff
                ? 'The queue is clear — new student requests will show up here.'
                : "Need a tool? Ask for it here and we'll let you know once staff decide."
            }
          />
        ) : (
          <ul>
            {groups.map((group) => {
              const { lead, rows, batchId } = group
              const batch = rows.length > 1
              return (
                <li key={group.key}>
                  <Link
                    to={`/requests/${lead.id}`}
                    className="flex min-h-[64px] items-center gap-3 border-b px-4 py-3 transition-colors
                               last:border-b-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="truncate text-sm font-bold">
                          {batch
                            ? `${rows.length} tools · ${rows
                                .map((r) => r.toolName)
                                .join(', ')}`
                            : lead.toolName}
                        </span>
                        <span className="mono subtle text-[11px]">{batchId ?? lead.id}</span>
                      </span>
                      <span className="muted mt-0.5 block truncate text-xs">
                        {staff && `${lead.userName} · `}
                        {formatDate(lead.neededFrom)} → {formatDate(lead.neededTo)}
                        {group.mixed ? ' · mixed statuses' : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <RequestStatusBadge status={group.status} />
                      <span className="subtle text-[10px] font-semibold">
                        {timeAgo(lead.createdAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      {/* A student's holds: what an approved request is actually reserving. */}
      {!staff && myHolds.length > 0 && (
        <SectionCard
          className="mt-4"
          data-tour="requests-holds"
          title="Your reservations"
          description="Tools held for you until you collect them"
          bodyClassName="p-0"
        >
          <ul>
            {myHolds.map((hold) => (
              <li
                key={hold.id}
                className="flex min-h-[60px] items-center gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <CalendarCheck className="h-4 w-4 shrink-0 opacity-50" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{hold.toolName}</span>
                  <span className="muted mt-0.5 block truncate text-xs">
                    {formatDate(hold.startsAt)} → {formatDate(hold.endsAt)}
                  </span>
                </span>
                <ReservationStatusBadge status={hold.status} />
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <Walkthrough steps={tourSteps} open={tour.open} onClose={tour.close} compact={!staff} />
    </>
  )
}
