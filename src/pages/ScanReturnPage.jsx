import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  QrCode,
  Search,
  ShieldAlert,
  Undo2,
  XCircle,
} from 'lucide-react'
import QRScanner from '../components/QRScanner'
import {
  ConditionBadge,
  DetailItem,
  EmptyState,
  Modal,
  PageHeader,
  RoleBadge,
  SearchInput,
  SectionCard,
  SelectField,
  Spinner,
  TextAreaField,
  TxnStatusBadge,
} from '../components/ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useDebounced, useTransactions } from '../hooks'
import * as txnService from '../services/transactions'
import { ValidationError } from '../services/tools'
import { PERM } from '../utils/permissions'
import {
  ACTIVE_TXN_STATUSES,
  CONDITION,
  RETURN_CONDITIONS,
  RETURN_ISSUE_TYPES,
  RETURN_REJECTION_REASONS,
} from '../utils/constants'
import { cx, matchesQuery } from '../utils/helpers'
import { formatDate, formatDateTime } from '../utils/dates'
import { parseReturnQRPayload } from '../utils/qrPayload'

/**
 * The counter's other half of the QR-first return flow: a student presents
 * the code `ReturnPage` generated for them, staff scan it here, inspect the
 * physical tool, and decide. Everything after the scan runs through the same
 * `transactions.js` functions the manual return desk always has — this page
 * adds no return logic of its own, only the QR entry point to it.
 */
export default function ScanReturnPage() {
  const { user, can } = useApp()
  const toast = useToast()
  const canDecide = can(PERM.BORROW_FOR_OTHERS)

  const [request, setRequest] = useState(null)
  const [looking, setLooking] = useState(false)
  const [lookupError, setLookupError] = useState(null)
  const [manualOpen, setManualOpen] = useState(false)

  const resolve = useCallback(
    async (txn, { fromScan = false } = {}) => {
      if (!txn) {
        setLookupError('Return request not found.')
        return
      }
      setRequest(txn)
      setLookupError(null)
      if (fromScan) {
        await txnService.logReturnQrScan(txn, user).catch(() => {})
      }
    },
    [user],
  )

  const handleDetected = useCallback(
    async (raw) => {
      setLooking(true)
      setLookupError(null)
      const parsed = parseReturnQRPayload(raw)
      if (!parsed.ok) {
        setLookupError(parsed.error)
        toast.error(parsed.error)
        setLooking(false)
        return
      }
      try {
        const txn = await txnService.getByReturnQrToken(parsed.token)
        if (!txn) {
          const message = 'Invalid QR. No return request matches this code.'
          setLookupError(message)
          toast.error(message)
          return
        }
        await resolve(txn, { fromScan: true })
      } catch (err) {
        const message = err.message ?? 'Unable to read that code.'
        setLookupError(message)
        toast.error(message)
      } finally {
        setLooking(false)
      }
    },
    [resolve, toast],
  )

  const reset = () => {
    setRequest(null)
    setLookupError(null)
    setManualOpen(false)
  }

  if (!canDecide) {
    return (
      <SectionCard title="Return QR">
        <EmptyState
          icon={ShieldAlert}
          title="Not available for your role"
          description="Only laboratory staff who work the return desk can decide a scanned return request."
        />
      </SectionCard>
    )
  }

  return (
    <>
      <PageHeader
        title="Scan Return QR"
        icon={QrCode}
        description="Scan a student's return QR code to process their returned tool."
      />

      {request ? (
        <ReturnRequestDetail request={request} actor={user} onClose={reset} onUpdated={setRequest} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard>
            <QRScanner
              onDetected={handleDetected}
              disabled={looking}
              parse={parseReturnQRPayload}
              manualLabel="Manual return request lookup"
              manualToggleLabel="Find Return Request"
              manualPlaceholder="RETURN:… or paste the code"
              manualHint={
                <>
                  Paste the code from the student's screen, or use{' '}
                  <span className="font-semibold">Find Return Request</span> below to search by
                  request, loan, student or tool instead.
                </>
              }
            />
          </SectionCard>

          <div className="space-y-4">
            {looking && (
              <div className="card flex items-center gap-3 p-5">
                <Spinner className="h-5 w-5" />
                <p className="text-sm font-semibold">Looking up the return request…</p>
              </div>
            )}

            {!looking && lookupError && (
              <SectionCard title="Scan result">
                <div className="flex flex-col items-center py-4 text-center">
                  <span className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-red-500/10">
                    <XCircle className="h-6 w-6 text-red-500" />
                  </span>
                  <p className="text-sm font-bold">Invalid QR</p>
                  <p className="muted mt-1.5 max-w-xs text-sm">{lookupError}</p>
                  <button
                    type="button"
                    onClick={() => setLookupError(null)}
                    className="btn btn-outline mt-4"
                  >
                    Try again
                  </button>
                </div>
              </SectionCard>
            )}

            {!looking && !lookupError && (
              <SectionCard
                title="Can't scan the QR?"
                description="Find the request by its ID, the loan, the student, or the tool"
              >
                <button
                  type="button"
                  onClick={() => setManualOpen(true)}
                  className="btn btn-outline w-full"
                >
                  <Search className="h-4 w-4" />
                  Find Return Request
                </button>
              </SectionCard>
            )}
          </div>
        </div>
      )}

      <ManualSearchModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onPick={(txn) => {
          setManualOpen(false)
          resolve(txn)
        }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Manual fallback — the same "Find Return Request" the QR flow keeps
 * available. Reads from the live transactions the return desk already uses;
 * writes nothing of its own, only hands the picked request to the same
 * detail/decision view the scanner opens.
 * ------------------------------------------------------------------ */

function ManualSearchModal({ open, onClose, onPick }) {
  const { transactions } = useTransactions()
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 200)

  const openRequests = useMemo(
    () =>
      transactions.filter(
        (t) => ACTIVE_TXN_STATUSES.includes(t.status) && txnService.returnRequested(t),
      ),
    [transactions],
  )

  const results = useMemo(
    () =>
      openRequests.filter((t) =>
        matchesQuery(t, debounced, ['id', 'toolId', 'toolName', 'userId', 'userName']),
      ),
    [openRequests, debounced],
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Find Return Request"
      description="Search by Return Request ID, Loan ID, Student ID, student name or tool name"
      size="md"
    >
      <div className="space-y-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search return requests…"
        />
        {results.length === 0 ? (
          <p className="muted py-6 text-center text-sm">
            {openRequests.length === 0
              ? 'No return requests are open right now.'
              : 'No open request matches that search.'}
          </p>
        ) : (
          <ul className="max-h-[360px] divide-y overflow-y-auto">
            {results.map((txn) => (
              <li key={txn.id}>
                <button
                  type="button"
                  onClick={() => onPick(txn)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{txn.toolName}</span>
                    <span className="subtle block truncate text-xs">
                      <span className="mono">{txn.id}</span> · {txn.userName}
                    </span>
                  </span>
                  <TxnStatusBadge status={txn.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 * Return request detail — the same screen whether it arrived by scan or by
 * manual search. Physical inspection happens here: staff pick one of three
 * outcomes, each backed by its own `transactions.js` function.
 * ------------------------------------------------------------------ */

function ReturnRequestDetail({ request, actor, onClose, onUpdated }) {
  const toast = useToast()
  const [issueOpen, setIssueOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Already decided — a rescanned or reopened request. Nothing to inspect;
  // just say what happened and who did it.
  if (txnService.returnDecided(request)) {
    return (
      <AlreadyProcessed request={request} onClose={onClose} />
    )
  }

  // Closed some other way (say, confirmed on the manual return desk while
  // this page was open) since it was scanned.
  if (!ACTIVE_TXN_STATUSES.includes(request.status)) {
    return (
      <SectionCard title="Return already processed">
        <EmptyState
          icon={CheckCircle2}
          title="This tool has already been returned."
          description="The loan was closed through another screen. No further action is needed here."
          action={
            <button type="button" onClick={onClose} className="btn btn-outline">
              Scan another
            </button>
          }
        />
      </SectionCard>
    )
  }

  const accept = async () => {
    setBusy(true)
    try {
      const updated = await txnService.acceptReturn(
        { transactionId: request.id, condition: CONDITION.GOOD },
        actor,
      )
      toast.success(`${request.toolName} accepted and returned to the available pool.`, {
        title: 'Return accepted',
      })
      onUpdated(updated)
    } catch (err) {
      toast.error(err.message ?? 'Unable to accept the return.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SectionCard title="Return Request" description={`Scanned ${formatDateTime(request.returnRequestedAt)}`}>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="subtle text-[11px] font-bold uppercase tracking-wider">Student</p>
              <p className="mt-0.5 text-sm font-bold">{request.userName}</p>
              <p className="subtle text-xs">{request.userId}</p>
            </div>
            <RoleBadge role={request.userRole} />
          </div>

          <dl className="grid grid-cols-2 gap-3">
            <DetailItem label="Tool" className="col-span-2">
              <Link to={`/tools/${request.toolId}`} className="hover:underline">
                {request.toolName}
              </Link>
            </DetailItem>
            <DetailItem label="Quantity">1</DetailItem>
            <DetailItem label="Request">
              <span className="mono">{request.id}</span>
            </DetailItem>
            <DetailItem label="Borrowed" mono>
              {formatDate(request.borrowDate)}
            </DetailItem>
            <DetailItem label="Status">
              <TxnStatusBadge status={request.status} />
            </DetailItem>
          </dl>

          {request.returnRequestCondition && (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2.5" style={{ background: 'rgb(var(--surface-2))' }}>
              <p className="text-xs">
                Reported by the student as{' '}
                <ConditionBadge condition={request.returnRequestCondition} />
              </p>
            </div>
          )}

          {request.status === 'Overdue' && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-500/30 dark:bg-red-500/10">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <p className="text-xs font-medium leading-relaxed text-red-800 dark:text-red-200">
                This loan is overdue. Accepting the return still records it as a late return.
              </p>
            </div>
          )}

          <p className="subtle text-xs leading-relaxed">
            Inspect the physical tool before deciding. Accept if it is in good order, Accept with
            Issue if it has a problem, or Reject if what is presented does not match this request.
          </p>

          <div className="grid gap-2 sm:grid-cols-3">
            <button type="button" onClick={accept} className="btn btn-success" disabled={busy}>
              {busy ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
              Accept Return
            </button>
            <button
              type="button"
              onClick={() => setIssueOpen(true)}
              className="btn btn-outline"
              disabled={busy}
            >
              <AlertTriangle className="h-4 w-4" />
              Accept with Issue
            </button>
            <button
              type="button"
              onClick={() => setRejectOpen(true)}
              className="btn btn-outline text-red-600 dark:text-red-400"
              disabled={busy}
            >
              <XCircle className="h-4 w-4" />
              Reject Return
            </button>
          </div>

          <button type="button" onClick={onClose} className="btn btn-ghost w-full">
            Scan another
          </button>
        </div>
      </SectionCard>

      <AcceptWithIssueModal
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        request={request}
        actor={actor}
        onDone={(updated) => {
          setIssueOpen(false)
          onUpdated(updated)
        }}
      />
      <RejectReturnModal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        request={request}
        actor={actor}
        onDone={(updated) => {
          setRejectOpen(false)
          onUpdated(updated)
        }}
      />
    </>
  )
}

function AcceptWithIssueModal({ open, onClose, request, actor, onDone }) {
  const toast = useToast()
  const [issueType, setIssueType] = useState(RETURN_ISSUE_TYPES[0])
  const [condition, setCondition] = useState(CONDITION.DAMAGED)
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    setErrors({})
    try {
      const updated = await txnService.acceptReturnWithIssue(
        { transactionId: request.id, issueType, condition, description, notes },
        actor,
      )
      toast.warning(`${request.toolName} accepted with an issue and pulled from circulation.`, {
        title: 'Accepted with issue',
      })
      onDone(updated)
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.errors)
      else toast.error(err.message ?? 'Unable to record the issue.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="Accept with Issue"
      description={request?.toolName}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={submit} disabled={saving}>
            {saving && <Spinner />}
            Confirm
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <SelectField
          label="Issue type"
          required
          value={issueType}
          onChange={(e) => setIssueType(e.target.value)}
          options={RETURN_ISSUE_TYPES}
          error={errors.issueType}
        />
        <SelectField
          label="Condition"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          options={RETURN_CONDITIONS}
          error={errors.condition}
        />
        <TextAreaField
          label="Damage description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is wrong with the tool"
          rows={3}
        />
        <TextAreaField
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional — anything else worth recording"
          rows={2}
        />
        <p className="subtle text-xs leading-relaxed">
          The tool is pulled from circulation and the loan is closed as returned with this issue on
          record.
        </p>
      </div>
    </Modal>
  )
}

function RejectReturnModal({ open, onClose, request, actor, onDone }) {
  const toast = useToast()
  const [reason, setReason] = useState(RETURN_REJECTION_REASONS[0])
  const [detail, setDetail] = useState('')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    setErrors({})
    const fullReason = reason === 'Other' && detail.trim() ? detail.trim() : reason
    try {
      const updated = await txnService.rejectReturn(
        { transactionId: request.id, reason: fullReason },
        actor,
      )
      toast.info(`Return rejected for ${request.toolName}. The loan stays open.`, {
        title: 'Return rejected',
      })
      onDone(updated)
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.errors)
      else toast.error(err.message ?? 'Unable to reject the return.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="Reject Return"
      description={request?.toolName}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={submit} disabled={saving}>
            {saving && <Spinner />}
            Confirm rejection
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <SelectField
          label="Reason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          options={RETURN_REJECTION_REASONS}
          error={errors.reason}
        />
        {reason === 'Other' && (
          <TextAreaField
            label="Describe why"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={2}
          />
        )}
        <p className="subtle text-xs leading-relaxed">
          The loan stays open and stays assigned to the student. They can see this reason and ask
          again once it is sorted out.
        </p>
      </div>
    </Modal>
  )
}

/** A rescanned or reopened request that has already been decided. */
function AlreadyProcessed({ request, onClose }) {
  const label =
    request.returnDecision === 'accepted_with_issue'
      ? 'Accepted with issue'
      : request.returnDecision === 'rejected'
        ? 'Rejected'
        : 'Accepted'
  return (
    <SectionCard title="Return Already Processed">
      <div className="flex flex-col items-center py-4 text-center">
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-emerald-500/10">
          <Undo2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
        </span>
        <p className="text-sm font-bold">{label}</p>
        <p className="muted mt-1.5 max-w-sm text-sm">
          This return request for <strong>{request.toolName}</strong> was
          {request.returnDecision === 'rejected' ? ' decided ' : ' completed '}
          on {formatDateTime(request.returnProcessedAt)}.
        </p>
        {request.returnProcessedByName && (
          <p className="subtle mt-2 text-xs">
            Processed by <span className="font-semibold">{request.returnProcessedByName}</span>
          </p>
        )}
        {request.returnRejectionReason && (
          <p className="subtle mt-1 text-xs">Reason: {request.returnRejectionReason}</p>
        )}
        <button type="button" onClick={onClose} className={cx('btn btn-outline mt-4')}>
          Scan another
        </button>
      </div>
    </SectionCard>
  )
}
