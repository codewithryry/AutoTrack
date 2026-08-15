import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  ClipboardList,
  PackageSearch,
  Repeat,
  X,
} from 'lucide-react'
import {
  DetailItem,
  EmptyState,
  Modal,
  PageHeader,
  RequestStatusBadge,
  ReservationStatusBadge,
  SectionCard,
  Skeleton,
  Spinner,
  StatusBadge,
  TextAreaField,
} from '../components/ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useRequest, useRequests, useReservations, useTransactions } from '../hooks'
import * as requestService from '../services/requests'
import { REQUEST_STATUS } from '../utils/constants'
import { formatDate, formatDateTime } from '../utils/dates'
import { PERM } from '../utils/permissions'

/**
 * One request: what was asked for, what was decided, the hold the decision
 * created, and the borrowing it turned into.
 *
 * Deciding is staff work and withdrawing is the requester's — the same division
 * the service and the policies enforce, so the buttons here only ever offer what
 * the call behind them would accept.
 */
export default function RequestDetailPage() {
  const { id } = useParams()
  const { user, can } = useApp()
  const toast = useToast()
  const { request, loading } = useRequest(id)
  // Every request this role may read, so the batch this one belongs to can be
  // shown beside it. Same scoping as the Requests page — no extra read.
  const { requests } = useRequests()
  const { reservations } = useReservations()
  const { transactions } = useTransactions()

  const [decision, setDecision] = useState(null) // 'approve' | 'reject' | 'cancel'
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Every tool raised in this ask, this one included, when it covered several.
  // A request with no batch is a batch of one and shows nothing extra.
  const batchRows = useMemo(() => {
    if (!request?.batchId) return []
    const rows = requests.filter((r) => r.batchId === request.batchId)
    return rows.length > 1 ? rows : []
  }, [requests, request])

  const hold = useMemo(
    () => reservations.find((r) => r.requestId === id) ?? null,
    [reservations, id],
  )

  // The loan this approval became, if it has been collected. A fulfilled hold
  // names it outright; failing that it is the borrowing of this tool, by this
  // requester, that started after the decision was made.
  const loan = useMemo(() => {
    if (!request) return null
    if (hold?.transactionId) {
      return transactions.find((t) => t.id === hold.transactionId) ?? null
    }
    return (
      transactions.find(
        (t) =>
          t.toolId === request.toolId &&
          t.userId === request.userId &&
          !!request.decidedAt &&
          new Date(t.borrowDate) >= new Date(request.decidedAt),
      ) ?? null
    )
  }, [transactions, hold, request])

  if (loading && !request) {
    return (
      <div className="animate-fade-in">
        <Skeleton className="mb-3 h-4 w-36 rounded" />
        <Skeleton className="mb-5 h-8 w-56 rounded" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!request) {
    return (
      <div className="card">
        <EmptyState
          icon={PackageSearch}
          title="Request not found."
          description={`No request is recorded under ${id}.`}
          action={
            <Link to="/requests" className="btn btn-primary">
              Back to requests
            </Link>
          }
        />
      </div>
    )
  }

  // Who releases the tool: the counter, or the student collecting their own.
  const staffDesk = can(PERM.BORROW_FOR_OTHERS)
  const canDecide = can(PERM.REQUEST_DECIDE) && requestService.isDecidable(request)
  const canCancel =
    requestService.isCancellable(request) &&
    (request.userId === user?.id || can(PERM.REQUEST_DECIDE))

  const ACTIONS = {
    // A batch is decided in one action: every tool asked for together is
    // approved or rejected here, each still getting its own hold and record.
    approve: {
      title: request.batchId ? 'Approve this request?' : `Approve ${request.toolName}?`,
      label: 'Approve request',
      hint: request.batchId
        ? 'Every tool asked for in this request is approved together, each held for the requested window.'
        : 'The tool is held for the requested window and appears on the Borrow / Return desk as ready to borrow.',
      run: () => requestService.decideBatch(request, user, { approved: true, note }),
      done: 'Request approved — ready to borrow.',
    },
    reject: {
      title: `Reject ${request.id}?`,
      label: 'Reject request',
      hint: request.batchId
        ? 'Every tool asked for in this request is rejected together, and the reason is sent to the requester.'
        : 'The reason is sent to the requester.',
      run: () => requestService.decideBatch(request, user, { approved: false, note }),
      done: 'Request rejected.',
    },
    cancel: {
      title: `Withdraw ${request.id}?`,
      label: 'Withdraw request',
      hint: 'Any hold this request created is released.',
      run: () => requestService.cancel(request.id, user, { note }),
      done: 'Request withdrawn.',
    },
  }

  const active = decision ? ACTIONS[decision] : null

  const confirm = async () => {
    if (!active) return
    setBusy(true)
    try {
      const result = await active.run()
      // A batch reports what actually went through, so a tool that could not be
      // held is named rather than silently skipped.
      if (result?.failed?.length) {
        toast.warning(
          `${result.decided.length} decided · ${result.failed.length} could not be: ` +
            result.failed.map((f) => f.request.toolName).join(', '),
        )
      } else {
        toast.success(active.done)
      }
      setDecision(null)
      setNote('')
    } catch (err) {
      toast.error(err.message ?? 'That decision could not be recorded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Link
        to="/requests"
        className="muted mb-3 inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-black/[0.03] dark:hover:bg-white/5"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to requests
      </Link>

      {/* On a phone the shell's top bar already names this page, so the H1 and
          its subtitle stand down there and the record itself starts at the top
          of the screen — the reference is in the card below, which now carries
          the request's own id. The desktop keeps the heading. */}
      <PageHeader
        title="Detail"
        description={
          batchRows.length > 0
            ? `${request.batchId} · ${batchRows.length} tools · requested by ${request.userName}`
            : `${request.id} · ${request.toolName} · requested by ${request.userName}`
        }
        icon={ClipboardList}
        hideTitleMobile
      >
        <RequestStatusBadge status={request.status} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="min-w-0 space-y-4">
          {/* No card heading: the page is already titled, and the fields name
              themselves. */}
          <SectionCard>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {/* The reference the header carries on a wide screen, kept on the
                  record itself so a phone is not missing it. */}
              <DetailItem label={batchRows.length > 0 ? 'Batch' : 'Request'} className="min-w-0" mono>
                <span className="block truncate">
                  {batchRows.length > 0 ? request.batchId : request.id}
                </span>
              </DetailItem>
              <DetailItem label="Tool" className="min-w-0">
                <Link to={`/tools/${request.toolId}`} className="hover:underline">
                  {request.toolName}
                </Link>
              </DetailItem>
              <DetailItem label="Requester" className="min-w-0">
                {request.userName}
              </DetailItem>
              <DetailItem label="Role" className="min-w-0">
                {request.userRole}
              </DetailItem>
              <DetailItem label="Needed from" className="min-w-0" mono>
                {formatDate(request.neededFrom)}
              </DetailItem>
              <DetailItem label="Return by" className="min-w-0" mono>
                {formatDate(request.neededTo)}
              </DetailItem>
              <DetailItem label="Raised" className="min-w-0" mono>
                {formatDateTime(request.createdAt)}
              </DetailItem>
            </dl>
            {/* Every tool this ask covers, with where each one stands. The
                decision below applies to all of them at once; borrowing and
                returning stay per tool, on the records linked here. */}
            {batchRows.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <DetailItem label={`Tools in this request (${batchRows.length})`}>
                  <ul className="mt-1 space-y-1">
                    {batchRows.map((row) => (
                      <li key={row.id} className="flex items-center justify-between gap-2">
                        {row.id === request.id ? (
                          <span className="min-w-0 flex-1 truncate">{row.toolName}</span>
                        ) : (
                          <Link
                            to={`/requests/${row.id}`}
                            className="min-w-0 flex-1 truncate font-normal hover:underline"
                          >
                            {row.toolName}
                          </Link>
                        )}
                        <RequestStatusBadge status={row.status} />
                      </li>
                    ))}
                  </ul>
                </DetailItem>
              </div>
            )}
            {request.purpose && (
              <div className="mt-4 border-t pt-3">
                <DetailItem label="Purpose">{request.purpose}</DetailItem>
              </div>
            )}
          </SectionCard>

          {/* What was decided, once somebody has. */}
          {request.decidedAt && (
            <SectionCard title="Decision">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailItem label="Outcome" className="min-w-0">
                  <RequestStatusBadge status={request.status} />
                </DetailItem>
                <DetailItem label="Decided by" className="min-w-0">
                  {request.decidedByName ?? '—'}
                </DetailItem>
                <DetailItem label="Decided" className="min-w-0" mono>
                  {formatDateTime(request.decidedAt)}
                </DetailItem>
              </dl>
              {request.decisionNote && (
                <div className="mt-4 border-t pt-3">
                  <DetailItem label="Note">{request.decisionNote}</DetailItem>
                </div>
              )}
            </SectionCard>
          )}

          {/* The hold an approval created. It is an internal record with no
              page of its own, so this is where it is read: approved means the
              tool is held until it is released on the borrow desk. */}
          {hold && (
            <SectionCard
              title="Tool reserved"
              description="Held for the approved student until the borrowing is confirmed"
            >
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <DetailItem label="Reference" className="min-w-0" mono>
                  {hold.id}
                </DetailItem>
                <DetailItem label="Status" className="min-w-0">
                  <ReservationStatusBadge status={hold.status} />
                </DetailItem>
                <DetailItem label="Held from" className="min-w-0" mono>
                  {formatDate(hold.startsAt)}
                </DetailItem>
                <DetailItem label="Until" className="min-w-0" mono>
                  {formatDate(hold.endsAt)}
                </DetailItem>
              </dl>
            </SectionCard>
          )}

          {/* The counter's own actions, at a full tap size on a phone. */}
          {(canDecide || canCancel) && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {canDecide && (
                <>
                  <button
                    type="button"
                    className="btn btn-success sm:flex-none"
                    onClick={() => setDecision('approve')}
                  >
                    <Check className="h-4 w-4" />
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger sm:flex-none"
                    onClick={() => setDecision('reject')}
                  >
                    <X className="h-4 w-4" />
                    Reject
                  </button>
                </>
              )}
              {canCancel && (
                <button
                  type="button"
                  className="btn btn-outline sm:flex-none"
                  onClick={() => setDecision('cancel')}
                >
                  Withdraw
                </button>
              )}
            </div>
          )}
        </div>

        {/* -------------------------- the borrowing itself --------------------------
            Where this approval has got to. The request stays the approval
            record; the loan it becomes lives on the borrow desk, so this panel
            reports the state and points there rather than repeating it. */}
        <div className="lg:sticky lg:top-20">
          <SectionCard
            title="Borrowing"
            description={
              loan
                ? 'The transaction this approval became'
                : 'What happens next with this request'
            }
          >
            {loan ? (
              <dl className="grid grid-cols-2 gap-4">
                <DetailItem label="Transaction" className="min-w-0" mono>
                  {loan.id}
                </DetailItem>
                <DetailItem label="Status" className="min-w-0">
                  <StatusBadge status={loan.status} />
                </DetailItem>
                <DetailItem label="Borrowed" className="min-w-0" mono>
                  {formatDateTime(loan.borrowDate)}
                </DetailItem>
                <DetailItem label="Due" className="min-w-0" mono>
                  {formatDate(loan.dueDate)}
                </DetailItem>
                <DetailItem label="Returned" className="min-w-0" mono>
                  {loan.returnDate ? formatDateTime(loan.returnDate) : 'Not yet returned'}
                </DetailItem>
                <DetailItem label="Issued by" className="min-w-0">
                  {loan.issuedByName ?? '—'}
                </DetailItem>
              </dl>
            ) : request.status === REQUEST_STATUS.APPROVED ? (
              <div className="space-y-3">
                <p className="muted text-sm leading-relaxed">
                  This request is approved and {request.toolName} is ready to borrow — nothing needs
                  to be requested again.{' '}
                  {staffDesk
                    ? 'Release it to the student from the Borrow / Return desk.'
                    : 'Collect it at the crib, then confirm the borrowing from your Requests list.'}
                </p>
                <Link to={staffDesk ? '/borrow' : '/requests'} className="btn btn-primary btn-sm">
                  <Repeat className="h-3.5 w-3.5" />
                  {staffDesk ? 'Open Borrow / Return' : 'Go to Requests'}
                </Link>
              </div>
            ) : (
              <p className="muted text-sm leading-relaxed">
                {request.status === REQUEST_STATUS.PENDING
                  ? 'Waiting for the laboratory staff to decide. Once approved, the tool becomes ready to borrow on the Borrow / Return desk.'
                  : `This request is ${request.status.toLowerCase()}, so there is no borrowing against it.`}
              </p>
            )}
          </SectionCard>
        </div>
      </div>

      <Modal
        open={!!active}
        onClose={busy ? undefined : () => setDecision(null)}
        title={active?.title ?? ''}
        description={active?.hint}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setDecision(null)}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy}>
              {busy && <Spinner />}
              {active?.label}
            </button>
          </>
        }
      >
        <TextAreaField
          label="Note"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional — sent to the requester."
        />
      </Modal>
    </>
  )
}
