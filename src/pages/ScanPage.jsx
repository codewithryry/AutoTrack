import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  HardHat,
  History,
  MapPin,
  QrCode,
  RotateCcw,
  ScanLine,
  Undo2,
  Wrench,
  XCircle,
} from 'lucide-react'
import QRScanner from '../components/QRScanner'
import {
  ConditionBadge,
  DetailItem,
  PageHeader,
  SectionCard,
  Spinner,
  StatusBadge,
} from '../components/ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import * as toolService from '../services/tools'
import * as txnService from '../services/transactions'
import { PERM } from '../utils/permissions'
import { NON_BORROWABLE_REASON } from '../utils/constants'
import { parseQRPayload } from '../utils/qr'
import { cx } from '../utils/helpers'
import { dueLabel, formatDate } from '../utils/dates'

/**
 * Scanner workflow.
 *
 * Scan → resolve the tool → show its live status → offer the one action that
 * makes sense for that status. Borrowing and returning happen on their own
 * pages so the confirmation step is never skipped by a mis-scan.
 */
export default function ScanPage() {
  const { can } = useApp()
  const toast = useToast()
  const navigate = useNavigate()

  const [result, setResult] = useState(null) // { tool, loan } | { error }
  const [looking, setLooking] = useState(false)

  const handleDetected = useCallback(
    async (raw) => {
      setLooking(true)
      const parsed = parseQRPayload(raw)

      if (!parsed.ok) {
        setResult({ error: parsed.error, raw })
        toast.error(parsed.error)
        setLooking(false)
        return
      }

      try {
        const tool = await toolService.findByQR(parsed.toolId)
        if (!tool) {
          const message = `Tool not found. Please check the QR code. (${parsed.toolId})`
          setResult({ error: message, raw: parsed.toolId })
          toast.error('Tool not found. Please check the QR code.')
          return
        }
        const loan = await txnService.activeLoanContext(tool.id)
        setResult({ tool, loan })
        toast.success(`${tool.name} identified.`, { title: tool.id })
      } catch (err) {
        setResult({ error: err.message ?? 'Unable to read that code.' })
        toast.error(err.message ?? 'Unable to read that code.')
      } finally {
        setLooking(false)
      }
    },
    [toast],
  )

  const reset = () => setResult(null)

  return (
    <>
      <PageHeader
        title="Scan a tool"
        description="Point the camera at the QR label to borrow, return or inspect a tool."
        icon={QrCode}
      >
        {result && (
          <button type="button" onClick={reset} className="btn btn-outline">
            <RotateCcw className="h-4 w-4" />
            Scan another
          </button>
        )}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Camera" description="Works offline once the app is installed">
          <QRScanner onDetected={handleDetected} disabled={looking} />
        </SectionCard>

        <div className="space-y-4">
          {looking && (
            <div className="card flex items-center gap-3 p-5">
              <Spinner className="h-5 w-5" />
              <p className="text-sm font-semibold">Looking up the tool record…</p>
            </div>
          )}

          {!looking && !result && <ScanHint />}

          {!looking && result?.error && (
            <SectionCard title="Scan result">
              <div className="flex flex-col items-center py-4 text-center">
                <span className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-red-500/10">
                  <XCircle className="h-6 w-6 text-red-500" />
                </span>
                <p className="text-sm font-bold">Tool not found</p>
                <p className="muted mt-1.5 max-w-xs text-sm">{result.error}</p>
                {result.raw && (
                  <p className="subtle mono mt-2 break-all text-xs">Scanned: {result.raw}</p>
                )}
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={reset} className="btn btn-outline">
                    Try again
                  </button>
                  {can(PERM.TOOL_VIEW) && (
                    <Link to="/tools" className="btn btn-primary">
                      Browse inventory
                    </Link>
                  )}
                </div>
              </div>
            </SectionCard>
          )}

          {!looking && result?.tool && (
            <ScanResult
              tool={result.tool}
              loan={result.loan}
              can={can}
              onNavigate={navigate}
              onReset={reset}
            />
          )}
        </div>
      </div>
    </>
  )
}

function ScanHint() {
  return (
    <SectionCard title="How it works">
      <ol className="space-y-3.5">
        {[
          {
            icon: ScanLine,
            title: 'Scan the label',
            text: 'Every tool carries a printed QR code with its Tool ID.',
          },
          {
            icon: Wrench,
            title: 'Check the record',
            text: 'The tool’s status, condition and current holder appear instantly.',
          },
          {
            icon: ArrowRight,
            title: 'Borrow or return',
            text: 'Confirm the transaction and the inventory updates immediately.',
          },
        ].map(({ icon: Icon, title, text }, index) => (
          <li key={title} className="flex gap-3">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-extrabold"
              style={{ background: 'rgb(var(--surface-3))' }}
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-bold">
                <Icon className="h-3.5 w-3.5 opacity-60" />
                {title}
              </p>
              <p className="muted mt-0.5 text-xs leading-relaxed">{text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div
        className="mt-4 rounded-lg border px-3.5 py-3"
        style={{ background: 'rgb(var(--surface-2))' }}
      >
        <p className="subtle text-xs leading-relaxed">
          No camera? Use <strong>Enter Tool ID</strong> below the viewfinder to type the code
          printed on the label.
        </p>
      </div>
    </SectionCard>
  )
}

function ScanResult({ tool, loan, can, onNavigate, onReset }) {
  const eligibility = toolService.borrowEligibility(tool)
  const activeLoan = loan?.transaction
  const canReturn = !!activeLoan && can(PERM.RETURN)
  const canBorrow = eligibility.ok && can(PERM.BORROW)

  const tone = activeLoan
    ? activeLoan.status === 'Overdue'
      ? 'danger'
      : 'info'
    : eligibility.ok
      ? 'success'
      : 'warning'

  const TONE_BAR = {
    success: 'bg-emerald-500',
    info: 'bg-blue-500',
    warning: 'bg-orange-500',
    danger: 'bg-red-500',
  }

  return (
    <section className="card relative overflow-hidden">
      <span className={cx('absolute inset-x-0 top-0 h-1', TONE_BAR[tone])} />

      <div className="p-4 pt-5 sm:p-5 sm:pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={`/tools/${tool.id}`}
              className="block truncate text-lg font-extrabold leading-tight hover:underline"
            >
              {tool.name}
            </Link>
            <p className="subtle mono mt-0.5 text-sm">{tool.id}</p>
          </div>
          <span
            className={cx(
              'grid h-11 w-11 shrink-0 place-items-center rounded-xl',
              tone === 'success'
                ? 'bg-emerald-500/12'
                : tone === 'danger'
                  ? 'bg-red-500/12'
                  : tone === 'warning'
                    ? 'bg-orange-500/12'
                    : 'bg-blue-500/12',
            )}
          >
            {tone === 'success' ? (
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            ) : tone === 'danger' ? (
              <AlertTriangle className="h-6 w-6 text-red-500" />
            ) : tone === 'warning' ? (
              <HardHat className="h-6 w-6 text-orange-500" />
            ) : (
              <Undo2 className="h-6 w-6 text-blue-500" />
            )}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={tool.status} />
          <ConditionBadge condition={tool.condition} />
          <span
            className="badge border-transparent"
            style={{ background: 'rgb(var(--surface-3))', color: 'rgb(var(--text-muted))' }}
          >
            {tool.category}
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4">
          <DetailItem label="Location">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="truncate">{tool.location}</span>
            </span>
          </DetailItem>
          <DetailItem label="Brand / model">
            {[tool.brand, tool.model].filter(Boolean).join(' · ') || '—'}
          </DetailItem>
        </dl>

        {/* current holder */}
        {activeLoan && (
          <div
            className="mt-4 rounded-lg border p-3.5"
            style={{ background: 'rgb(var(--surface-2))' }}
          >
            <p className="subtle text-[11px] font-bold uppercase tracking-wider">
              Currently borrowed by
            </p>
            <p className="mt-1 text-sm font-bold">{activeLoan.userName}</p>
            <p className="muted mt-0.5 text-xs">
              Since {formatDate(activeLoan.borrowDate)} · due {formatDate(activeLoan.dueDate)}
            </p>
            <p
              className={cx(
                'mt-1 text-xs font-bold',
                activeLoan.status === 'Overdue'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-blue-600 dark:text-blue-400',
              )}
            >
              {dueLabel(activeLoan.dueDate)}
            </p>
          </div>
        )}

        {/* blocked reason */}
        {!activeLoan && !eligibility.ok && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-orange-200 bg-orange-50 px-3.5 py-3 dark:border-orange-500/30 dark:bg-orange-500/10">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
            <p className="text-sm font-medium leading-snug text-orange-800 dark:text-orange-200">
              {NON_BORROWABLE_REASON[tool.status] ?? eligibility.reason}
            </p>
          </div>
        )}

        {/* actions */}
        <div className="mt-5 space-y-2">
          {canReturn && (
            <button
              type="button"
              onClick={() => onNavigate(`/return?tool=${tool.id}`)}
              className="btn btn-success btn-lg w-full"
            >
              <Undo2 className="h-4 w-4" />
              Return tool
            </button>
          )}
          {canBorrow && (
            <button
              type="button"
              onClick={() => onNavigate(`/borrow?tool=${tool.id}`)}
              className="btn btn-primary btn-lg w-full"
            >
              <ArrowRight className="h-4 w-4" />
              Borrow tool
            </button>
          )}
          {activeLoan && !canReturn && (
            <p className="subtle text-center text-xs">
              Only {activeLoan.userName} or a laboratory instructor can return this tool.
            </p>
          )}

          <div className="flex gap-2">
            <Link to={`/tools/${tool.id}`} className="btn btn-outline flex-1">
              <Wrench className="h-4 w-4" />
              Tool details
            </Link>
            <Link to={`/tools/${tool.id}/history`} className="btn btn-outline flex-1">
              <History className="h-4 w-4" />
              History
            </Link>
          </div>

          <button type="button" onClick={onReset} className="btn btn-ghost w-full">
            <RotateCcw className="h-4 w-4" />
            Scan another tool
          </button>
        </div>
      </div>
    </section>
  )
}
