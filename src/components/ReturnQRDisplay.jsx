import { useEffect, useRef, useState } from 'react'
import { drawReturnQRToCanvas } from '../utils/qr'
import { ReturnDecisionBadge } from './ui'

/** Renders a return request's QR onto a canvas — the same drawing code the tool QR uses. */
function ReturnQRCanvas({ token, size = 200, className }) {
  const canvasRef = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    drawReturnQRToCanvas(canvasRef.current, token, { size }).catch((err) => {
      console.error('[qr] return QR render failed', err)
      if (!cancelled) setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [token, size])

  if (failed) {
    return (
      <div
        className="grid place-items-center rounded-lg border border-dashed p-4 text-center"
        style={{ width: size, height: size }}
      >
        <p className="subtle text-xs">QR code could not be rendered.</p>
      </div>
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size }}
      aria-label="Return request QR code"
      role="img"
    />
  )
}

/**
 * The card a student sees once a return request exists — the flagship of the
 * return workflow. Carries only what the task spec asked for: the student's
 * own name and id, the tool, the quantity (always 1 — loans are one tool
 * each), the code, the request id and its status. No condition report or
 * notes here; those already have a place on the loan record itself.
 */
export function ReturnQRCard({ transaction, studentName, studentId }) {
  if (!transaction?.returnQrToken) return null
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
        <ReturnQRCanvas token={transaction.returnQrToken} size={200} />
      </div>

      <p className="mono mt-3 text-sm font-bold tracking-wide">{transaction.id}</p>
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
        Show this code to laboratory staff at the crib. They will scan it to confirm the return —
        keep the tool with you until they do.
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
