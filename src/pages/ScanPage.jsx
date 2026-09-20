import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  QrCode,
  ScanLine,
  Wrench,
  XCircle,
} from 'lucide-react'
import QRScanner from '../components/QRScanner'
import ToolScanResult from '../components/ToolScanResult'
import ToolFound from '../components/ToolFound'
import Walkthrough, { usePageTour } from '../components/Walkthrough'
import {
  PageHeader,
  SectionCard,
  Spinner,
} from '../components/ui'
import { useScanResult } from '../hooks/useScanResult'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import * as toolService from '../services/tools'
import * as txnService from '../services/transactions'
import { isStudent, PERM } from '../utils/permissions'
import { parseQRPayload } from '../utils/qrPayload'

/**
 * Scanner workflow.
 *
 * Scan → resolve the tool → show its live status → offer the one action that
 * makes sense for that status. Borrowing and returning happen on their own
 * pages so the confirmation step is never skipped by a mis-scan.
 */
/**
 * First-run walkthrough for the scanner — the primary workflow of the app, and
 * the one a student meets first at the tool crib. Every step points at an
 * element that is really on this page; `Walkthrough` drops any step whose target
 * is absent, so the sequence stays honest.
 *
 * A student is shown their own wording: they scan to borrow or hand a tool back,
 * where staff issue and receive it on someone else's behalf.
 */
const scanTour = (student) =>
  student
    ? [
        {
          title: 'Scan to borrow or hand back',
          text: 'Every tool carries a QR label. Scanning it pulls up the tool and offers the one action that makes sense — borrow it, or return it.',
        },
        {
          target: 'scan-camera',
          title: 'Point the camera at the label',
          text: 'Tap Start camera, then hold the label inside the frame. It reads automatically — there is no shutter button.',
        },
        {
          target: 'scan-manual',
          title: 'No camera? Type the ID',
          text: 'If the label is scuffed or the camera will not start, type the Tool ID printed on the label here.',
        },
        {
          target: 'scan-guide',
          title: 'What happens next',
          text: 'You will see the tool, its condition and whether it is free, then a Borrow or Return button. Nothing is recorded until you confirm.',
        },
      ]
    : [
        {
          title: 'Borrow and return with one scan',
          text: 'Every tool carries a QR label. Scanning it pulls up the live record and offers the one action that makes sense — issue it, or take it back.',
        },
        {
          target: 'scan-camera',
          title: 'Point the camera at the label',
          text: 'Tap Start camera, then hold the tool’s QR label inside the frame. It reads automatically — there is no shutter button to press.',
        },
        {
          target: 'scan-manual',
          title: 'No camera? Type the ID',
          text: 'If the label is damaged or the camera is unavailable, enter the Tool ID printed on the label here instead.',
        },
        {
          target: 'scan-guide',
          title: 'What happens next',
          text: 'Once a tool is identified you will see its status, condition and current holder, followed by a Borrow or Return button. The inventory updates the moment you confirm.',
        },
      ]

export default function ScanPage() {
  const { can, user } = useApp()
  const toast = useToast()
  const navigate = useNavigate()

  // Survives the unmount that opening the tool's page causes, so pressing
  // back returns to the tool that was scanned rather than an empty scanner.
  const { result, setResult, clearResult } = useScanResult()
  const [looking, setLooking] = useState(false)

  // Once per account on this device, remembered separately from every other page.
  const tour = usePageTour('scan', user?.id)
  const tourSteps = useMemo(() => scanTour(isStudent(user)), [user])

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
        // Both lookups are keyed by the id on the label, so they run together
        // rather than one after the other — a scan resolves in one round trip
        // instead of two. A code that turns out to be unknown simply discards
        // the loan lookup, which found nothing anyway.
        // A student only ever sees a loan record that is their own; for anyone
        // else's the tool is simply reported as unavailable.
        const [tool, loan] = await Promise.all([
          toolService.findByQR(parsed.toolId),
          txnService.activeLoanContext(parsed.toolId, user).catch(() => null),
        ])
        if (!tool) {
          const message = `Tool not found. Please check the QR code. (${parsed.toolId})`
          setResult({ error: message, raw: parsed.toolId })
          toast.error('Tool not found. Please check the QR code.')
          return
        }
        setResult({ tool, loan })
        toast.success(`${tool.name} identified.`, { title: tool.id })

        // Best-effort audit line: staff scanned a tool that has an open,
        // undecided return request waiting on them — the same moment the
        // decision panel appears below. Never awaited into the render path
        // and never a reason a scan fails.
        const activeLoan = loan?.transaction
        if (
          activeLoan &&
          can(PERM.BORROW_FOR_OTHERS) &&
          txnService.returnRequested(activeLoan) &&
          !txnService.returnDecided(activeLoan)
        ) {
          txnService.logReturnQrScan(activeLoan, user).catch(() => {})
        }
      } catch (err) {
        setResult({ error: err.message ?? 'Unable to read that code.' })
        toast.error(err.message ?? 'Unable to read that code.')
      } finally {
        setLooking(false)
      }
    },
    [toast, user, can],
  )

  const reset = () => clearResult()

  // The phone's state switch: a resolved tool replaces the camera rather than
  // sharing the screen with it.
  const found = !looking && !!result?.tool

  return (
    <>
      {/* The student's shell already names this page and the camera panel below
          says what to do, so the introduction is dropped for them entirely.
          Staff keep the heading exactly as it was. */}
      {/* The shell's top bar already names this page on a phone, and what the
          scanner is for is said once, in "How it works" below — so the H1 and
          its subtitle are the desktop's alone. */}
      <PageHeader title="Scan a tool" icon={QrCode} hideTitleMobile hideTitle={isStudent(user)} />

      {/* Two states, not one layout with something pinned over it.
          ------------------------------------------------------------------
          The previous version kept the camera at full size and floated the
          result above it, so the scanner and the result competed for the same
          screen and the result got whatever was left. On a phone they are now
          different states: while nothing is scanned the camera is the whole
          page, and the moment a tool resolves the camera is *unmounted* and the
          result takes the space it had.

          Unmounting rather than hiding matters twice over: `QRScanner`'s
          cleanup calls `stop(true)`, so the camera stream is released instead
          of running behind a result nobody is looking at — which on a 2 GB
          phone is the most expensive thing on the screen.

          From `lg` neither state applies: a desktop has room for both at once,
          so the scanner stays on the left and the result fills the right. */}

      {/* ---------------------------- the phone ---------------------------- */}
      <div className="lg:hidden">
        {found ? (
          <ToolFound
            tool={result.tool}
            loan={result.loan}
            can={can}
            user={user}
            onNavigate={navigate}
            onReset={reset}
          />
        ) : (
          <div className="space-y-4">
            <SectionCard>
              <QRScanner onDetected={handleDetected} disabled={looking} />
            </SectionCard>
            {looking && <LookingUp />}
            {!looking && result?.error && (
              <NotFound result={result} onReset={reset} can={can} />
            )}
            {!looking && !result && (
              <div data-tour="scan-guide">
                <ScanHint student={isStudent(user)} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* --------------------------- the desktop --------------------------- */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-2">
        <SectionCard>
          <QRScanner onDetected={handleDetected} disabled={looking} />
        </SectionCard>

        <div className="space-y-4">
          {looking && <LookingUp />}
          {!looking && !result && (
            <div data-tour="scan-guide">
              <ScanHint student={isStudent(user)} />
            </div>
          )}
          {!looking && result?.error && (
            <NotFound result={result} onReset={reset} can={can} />
          )}
          {!looking && result?.tool && (
            <ToolScanResult
              tool={result.tool}
              loan={result.loan}
              can={can}
              user={user}
              onNavigate={navigate}
              onReset={reset}
            />
          )}
        </div>
      </div>

      <Walkthrough steps={tourSteps} open={tour.open} onClose={tour.close} compact={isStudent(user)} />
    </>
  )
}

/** The moment between a code being read and its record arriving. */
function LookingUp() {
  return (
    <div className="card flex items-center gap-3 p-5">
      <Spinner className="h-5 w-5" />
      <p className="text-sm font-semibold">Looking up the tool record…</p>
    </div>
  )
}

/**
 * A code that read cleanly but matches no tool.
 *
 * Both ways out are offered rather than leaving the person on a dead end: scan
 * again, or go and look the tool up by hand.
 */
function NotFound({ result, onReset, can }) {
  return (
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
          <button type="button" onClick={onReset} className="btn btn-outline">
            Scan again
          </button>
          {can(PERM.TOOL_VIEW) && (
            <Link to="/tools" className="btn btn-primary">
              Browse inventory
            </Link>
          )}
        </div>
      </div>
    </SectionCard>
  )
}

function ScanHint({ student }) {
  return (
    <SectionCard
      title="How it works"
      description="Point the camera at the QR label to borrow, return or inspect a tool. It works offline once the app is installed."
    >
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
          // What actually happens next depends on who is scanning: a student
          // asks for the tool and the crib decides, staff issue or receive it
          // at the counter. Neither is confirmed from this page.
          student
            ? {
                icon: ArrowRight,
                title: 'Request it, or hand it back',
                text: 'A free tool opens a request for staff to approve — approving issues it to you. One you are holding opens the return instead.',
              }
            : {
                icon: ArrowRight,
                title: 'Issue or receive',
                text: 'A free tool opens the borrow desk; one that is out opens the return, and the inventory updates the moment it is confirmed.',
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

/**
 * The counter's view of a scan.
 *
 * Where a student's panel answers "can I take this?", an instructor's answers
 * "what is this tool doing, who has it, and what do I do about it?" — so the
 * status leads, the live transaction and its borrower come next, and the only
 * buttons rendered are the ones this instructor's permissions already allow.
 * The lookup, the routes and the guards are the same ones used everywhere else.
 */
