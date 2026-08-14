import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { DetailItem, Modal, TxnStatusBadge, ConditionBadge } from './ui'
import { LocationTrail } from './LocationCapture'
import { dueLabel, formatDate, formatDateTime } from '../utils/dates'
import { ACTIVE_TXN_STATUSES } from '../utils/constants'

/** Read-only transaction record, opened from any transaction list. */
export default function TransactionDetail({ transaction, open, onClose, footer, extra }) {
  if (!transaction) return null
  const active = ACTIVE_TXN_STATUSES.includes(transaction.status)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Transaction record"
      description={transaction.id}
      size="md"
      footer={
        footer ?? (
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Close
          </button>
        )
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <TxnStatusBadge status={transaction.status} />
          {active && (
            <span className="subtle text-xs font-semibold">{dueLabel(transaction.dueDate)}</span>
          )}
        </div>

        <div
          className="rounded-lg border p-3.5"
          style={{ background: 'rgb(var(--surface-2))' }}
        >
          <p className="subtle text-[11px] font-bold uppercase tracking-wider">Tool</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{transaction.toolName}</p>
              <p className="subtle mono text-xs">
                {transaction.toolId} · {transaction.toolCategory}
              </p>
            </div>
            <Link to={`/tools/${transaction.toolId}`} className="btn btn-outline btn-sm shrink-0">
              View
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4">
          <DetailItem label="Borrower">{transaction.userName}</DetailItem>
          <DetailItem label="Role">{transaction.userRole}</DetailItem>
          <DetailItem label="Borrow date" mono>
            {formatDate(transaction.borrowDate)}
          </DetailItem>
          <DetailItem label="Due date" mono>
            {formatDate(transaction.dueDate)}
          </DetailItem>
          <DetailItem label="Return date" mono>
            {transaction.returnDate ? formatDateTime(transaction.returnDate) : 'Not returned'}
          </DetailItem>
          <DetailItem label="Condition on return">
            {transaction.conditionIn ? (
              <ConditionBadge condition={transaction.conditionIn} />
            ) : (
              '—'
            )}
          </DetailItem>
          <DetailItem label="Condition when issued">
            {transaction.conditionOut ? (
              <ConditionBadge condition={transaction.conditionOut} />
            ) : (
              '—'
            )}
          </DetailItem>
          <DetailItem label="Issued by">{transaction.issuedByName ?? '—'}</DetailItem>
          {transaction.receivedByName && (
            <DetailItem label="Received by">{transaction.receivedByName}</DetailItem>
          )}
        </dl>

        {transaction.purpose && (
          <DetailItem label="Purpose">
            <span className="muted font-normal">{transaction.purpose}</span>
          </DetailItem>
        )}
        {transaction.notes && (
          <DetailItem label="Notes">
            <span className="muted whitespace-pre-wrap font-normal">{transaction.notes}</span>
          </DetailItem>
        )}

        {/* Borrow point, usage checkpoints and return point — each labelled with
            what it means, and none of them presented as the tool's whereabouts
            for the whole loan. Visible to whoever may already read this record,
            so a student sees their own and staff see any; no role check is added
            here because none is needed. */}
        <div className="border-t pt-4">
          <LocationTrail transaction={transaction} />
        </div>

        {extra && <div className="border-t pt-4">{extra}</div>}
      </div>
    </Modal>
  )
}
