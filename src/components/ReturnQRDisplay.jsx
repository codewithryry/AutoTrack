import { QRCanvas } from './QRCodeDisplay'
import { ReturnDecisionBadge } from './ui'

/**
 * The card a student sees once a return request exists.
 *
 * One tool, one QR, one scanner: the code shown here is the same Tool QR
 * printed on the tool's own label and shown on its inventory/detail pages —
 * `QRCanvas` keyed by `transaction.toolId`, the exact component those other
 * screens already use. It does not encode the return request at all; staff
 * scan it at `/scan` like any other tool, and the universal scan result reads
 * the loan's own `returnRequestedAt`/`returnDecision` columns to offer
 * Accept / Accept with Issue / Reject right there. There is no separate
 * "return QR" identity to keep in step with the tool's — because there
 * isn't one.
 */
export function ReturnQRCard({ transaction, studentName, studentId }) {
  if (!transaction) return null
  return (
    <div className="card flex flex-col items-center p-5 text-center">
      <p className="subtle text-[11px] font-bold uppercase tracking-[0.16em]">Return request</p>

      <div className="mt-3 w-full max-w-[220px] space-y-1.5 text-left">
        <Row label="Student" value={studentName} />
        {studentId && <Row label="Student ID" value={studentId} mono />}
        <Row label="Tool" value={transaction.toolName} />
        <Row label="Quantity" value="1" />
      </div>

      <div className="mt-4 rounded-xl bg-white p-3 shadow-card ring-1 ring-black/5">
        <QRCanvas toolId={transaction.toolId} size={200} />
      </div>

      <p className="mono mt-3 text-sm font-bold tracking-wide">{transaction.toolId}</p>
      <div className="mt-1.5">
        {transaction.returnDecision ? (
          <ReturnDecisionBadge decision={transaction.returnDecision} />
        ) : (
          <span className="badge border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
            Return Requested
          </span>
        )}
      </div>

      <p className="subtle mt-3 max-w-[240px] text-xs leading-relaxed">
        This is the tool's own QR label. Show it to laboratory staff — they scan it from{' '}
        <strong>Scan</strong> like any other tool, and your return request appears there ready to
        confirm. Keep the tool with you until they do.
      </p>
    </div>
  )
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="subtle">{label}</span>
      <span className={mono ? 'mono font-semibold' : 'font-semibold'}>{value}</span>
    </div>
  )
}
