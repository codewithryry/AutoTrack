import { useState } from 'react'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { ConditionBadge, Modal, SelectField, Spinner, TextAreaField } from './ui'
import { useToast } from '../context/ToastContext'
import * as txnService from '../services/transactions'
import { ValidationError } from '../services/tools'
import {
  CONDITION,
  RETURN_CONDITIONS,
  RETURN_ISSUE_TYPES,
  RETURN_REJECTION_REASONS,
} from '../utils/constants'

/**
 * Inspect and decide a return request — Accept, Accept with Issue, or Reject.
 *
 * The physical-inspection step of the universal scanner: a tool scan already
 * resolved the loan, and this renders only when that loan has an open,
 * undecided return request (`returnRequested(activeLoan) &&
 * !returnDecided(activeLoan)`) and the viewer works the counter
 * (`PERM.BORROW_FOR_OTHERS`). Shared by `ToolFound` (mobile) and
 * `ToolScanResult` (desktop) so the decision itself — the buttons, the two
 * follow-up forms, the service calls — exists in exactly one place rather
 * than once per layout. Neither caller needs its own copy of
 * `acceptReturn`/`acceptReturnWithIssue`/`rejectReturn`.
 */
export default function ReturnDecisionPanel({ activeLoan, actor, onDecided }) {
  const toast = useToast()
  const [issueOpen, setIssueOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const accept = async () => {
    setBusy(true)
    try {
      const updated = await txnService.acceptReturn(
        { transactionId: activeLoan.id, condition: CONDITION.GOOD },
        actor,
      )
      toast.success(`${activeLoan.toolName} accepted and returned to the available pool.`, {
        title: 'Return accepted',
      })
      onDecided(updated)
    } catch (err) {
      toast.error(err.message ?? 'Unable to accept the return.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-[13px] font-bold">Return requested</p>
      {activeLoan.returnRequestCondition && (
        <p className="mt-1 flex items-center gap-1.5 text-xs">
          <span className="subtle">Reported by the student as</span>
          <ConditionBadge condition={activeLoan.returnRequestCondition} />
        </p>
      )}
      <p className="subtle mt-1.5 text-xs leading-relaxed">
        Inspect the physical tool before deciding. Accept if it is in good order, Accept with Issue
        if it has a problem, or Reject if what is presented does not match this loan.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <button type="button" onClick={accept} className="btn btn-success btn-sm" disabled={busy}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Accept
        </button>
        <button
          type="button"
          onClick={() => setIssueOpen(true)}
          className="btn btn-outline btn-sm"
          disabled={busy}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Accept with issue
        </button>
        <button
          type="button"
          onClick={() => setRejectOpen(true)}
          className="btn btn-outline btn-sm text-red-600 dark:text-red-400"
          disabled={busy}
        >
          <XCircle className="h-3.5 w-3.5" />
          Reject
        </button>
      </div>

      <AcceptWithIssueModal
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        loan={activeLoan}
        actor={actor}
        onDone={(updated) => {
          setIssueOpen(false)
          onDecided(updated)
        }}
      />
      <RejectReturnModal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        loan={activeLoan}
        actor={actor}
        onDone={(updated) => {
          setRejectOpen(false)
          onDecided(updated)
        }}
      />
    </div>
  )
}

function AcceptWithIssueModal({ open, onClose, loan, actor, onDone }) {
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
        { transactionId: loan.id, issueType, condition, description, notes },
        actor,
      )
      toast.warning(`${loan.toolName} accepted with an issue and pulled from circulation.`, {
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
      description={loan?.toolName}
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

function RejectReturnModal({ open, onClose, loan, actor, onDone }) {
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
        { transactionId: loan.id, reason: fullReason },
        actor,
      )
      toast.info(`Return rejected for ${loan.toolName}. The loan stays open.`, {
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
      description={loan?.toolName}
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

/** Already decided — a rescanned tool whose return request has been closed out. */
export function ReturnDecidedNotice({ activeLoan }) {
  const label =
    activeLoan.returnDecision === 'accepted_with_issue'
      ? 'Accepted with issue'
      : activeLoan.returnDecision === 'rejected'
        ? 'Rejected'
        : 'Accepted'
  return (
    <div>
      <p className="text-[13px] font-bold">Return already processed — {label}</p>
      {activeLoan.returnProcessedByName && (
        <p className="subtle mt-1 text-xs">
          Processed by <span className="font-semibold">{activeLoan.returnProcessedByName}</span>
        </p>
      )}
      {activeLoan.returnRejectionReason && (
        <p className="subtle mt-0.5 text-xs">Reason: {activeLoan.returnRejectionReason}</p>
      )}
    </div>
  )
}
