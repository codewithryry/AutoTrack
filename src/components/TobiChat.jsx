import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowUp,
  AudioLines,
  Ban,
  Check,
  ChevronRight,
  ClipboardPlus,
  Flag,
  Maximize2,
  Mic,
  RotateCcw,
  SquarePen,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useExitTransition } from '../hooks/useExitTransition'
import { useTobi } from '../hooks/useTobi'
import { canListen, canSpeak, useVoice } from '../hooks/useVoice'
import * as maintenanceService from '../services/maintenance'
import * as requestService from '../services/requests'
import * as txnService from '../services/transactions'
import { CONDITION, MAINTENANCE_TYPES, RETURN_CONDITIONS, ROLE } from '../utils/constants'
import { fromDateInput } from '../utils/dates'
import { cx } from '../utils/helpers'

/**
 * TOBI's conversation.
 *
 * `TobiConversation` is the conversation itself — messages, the composer and
 * voice — and is drawn two ways: inside `TobiChat`, the floating glass card
 * over any page, and on `/tobi`, the full page the card's maximise button
 * opens. Both read the same store (`useTobi`), so moving between them keeps the
 * chat exactly where it was.
 *
 * Everything TOBI knows comes from `/api/tobi`, which decides what this account
 * may see; this file only renders what comes back. What TOBI can help *do* —
 * request a tool, return one, report a problem, and (staff) approve or reject a
 * request — arrives as a proposal, shown as a confirmation card that runs the
 * app's own workflow on Continue: `requests.create()`, `requestReturn()`,
 * `reportProblem()`, `requests.approve()` / `reject()` / `decideBatch()`.
 */

const SUGGESTIONS = {
  [ROLE.STUDENT]: [
    'Show my borrowed tools',
    'Do I have overdue tools?',
    'Where is my tool?',
    'May kailangan ba akong ibalik today?',
  ],
  [ROLE.INSTRUCTOR]: [
    'Show overdue tools',
    'Who has borrowed tools?',
    'Check tool availability',
    'Any pending requests?',
  ],
  [ROLE.ADMIN]: [
    'Show overdue tools',
    'Check inventory',
    'Show active loans',
    'Accounts waiting for approval',
  ],
}

/** A first suggestion about the page that is open, where there is an obvious one. */
function pageSuggestion(pathname, role) {
  if (pathname === '/tools/map') {
    return role === ROLE.STUDENT ? 'Where was my tool last recorded?' : 'Where are the borrowed tools?'
  }
  if (/^\/tools\/[\w-]+(\/history)?$/.test(pathname)) return 'May history ba nito?'
  if (pathname.startsWith('/requests')) {
    return role === ROLE.STUDENT ? 'May update ba sa request ko?' : 'Any pending requests?'
  }
  if (pathname === '/maintenance' || pathname === '/problem-reports') return 'Show open problem reports'
  return null
}

export const greetingFor = (user) => {
  const firstName = user?.firstName || user?.fullName?.split(' ')[0] || ''
  return `${firstName ? `Hi ${firstName}, what` : 'What'} would you like to do today?`
}

const softFill = { background: 'rgb(var(--surface) / 0.85)', color: 'rgb(var(--text))' }
export const tobiIconButton =
  'grid h-9 w-9 shrink-0 place-items-center rounded-full opacity-70 transition ' +
  'hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10'

/** Plain text with "- " bullets and **bold** — all TOBI is asked to write. */
function RichText({ text }) {
  const inline = (line, key) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    )
  const blocks = []
  let list = null
  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (bullet) {
      if (!list) {
        list = []
        blocks.push({ type: 'list', items: list, key: i })
      }
      list.push(inline(bullet[1], i))
      return
    }
    list = null
    if (line.trim()) blocks.push({ type: 'p', content: inline(line, i), key: i })
  })
  return (
    <div className="space-y-1.5">
      {blocks.map((block) =>
        block.type === 'list' ? (
          <ul key={block.key} className="list-disc space-y-1 pl-4">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={block.key}>{block.content}</p>
        ),
      )}
    </div>
  )
}

function ReturnRequestCard({ action, user, onResolved }) {
  const [condition, setCondition] = useState(CONDITION.GOOD)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (action.state === 'done' || action.state === 'cancelled') {
    return (
      <p className="subtle mt-2 text-xs font-semibold">
        {action.state === 'done' ? 'Return request sent.' : 'Return request cancelled.'}
      </p>
    )
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      // The app's own workflow: permission, ownership and state are checked
      // there and again by the database, exactly as on the Return page.
      await txnService.requestReturn({ transactionId: action.transactionId, condition, notes: '' }, user)
      onResolved(
        'done',
        `Done — I sent a return request for ${action.toolName} (reported ${condition}). Hand it to the counter; staff will confirm when they receive it.`,
      )
    } catch (err) {
      setError(err?.message || 'The return request could not be sent.')
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 rounded-2xl border p-3" style={{ background: 'rgb(var(--surface))', color: 'rgb(var(--text))' }}>
      <p className="flex items-start gap-2 text-[13px] font-semibold leading-snug">
        <Undo2 className="mt-0.5 h-4 w-4 shrink-0 text-amberline-500" />
        You&apos;re about to submit a return request for {action.toolName}. Continue?
      </p>
      <label className="subtle mt-2.5 block text-[11px] font-bold uppercase tracking-wider">
        Condition
        <select
          className="input mt-1 w-full"
          value={condition}
          onChange={(event) => setCondition(event.target.value)}
          disabled={busy}
        >
          {RETURN_CONDITIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-primary btn-sm flex-1" onClick={submit} disabled={busy}>
          {busy ? 'Sending…' : 'Continue'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onResolved('cancelled')} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** The frame every confirmation card shares: what will happen, the fields, Continue / Cancel. */
function ConfirmCard({ icon: Icon, title, children, busy, error, confirmLabel = 'Continue', onConfirm, onCancel }) {
  return (
    <div className="mt-2 rounded-2xl border p-3" style={{ background: 'rgb(var(--surface))', color: 'rgb(var(--text))' }}>
      <p className="flex items-start gap-2 text-[13px] font-semibold leading-snug">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amberline-500" />
        <span>{title}</span>
      </p>
      {children}
      {error && <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-primary btn-sm flex-1" onClick={onConfirm} disabled={busy}>
          {busy ? 'Sending…' : confirmLabel}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}

const cardLabel = 'subtle mt-2.5 block text-[11px] font-bold uppercase tracking-wider'

/** The first message of a validation error, or the error's own. */
const errorText = (err, fallback) =>
  (err?.errors && Object.values(err.errors).find(Boolean)) || err?.message || fallback

function ResolvedNote({ action, done, cancelled }) {
  return <p className="subtle mt-2 text-xs font-semibold">{action.state === 'done' ? done : cancelled}</p>
}

/** "Request a hammer" — runs the same `requests.create()` the New request form does. */
function ToolRequestCard({ action, user, onResolved }) {
  const { settings } = useApp()
  const maxDays = settings?.maxBorrowDays ?? 30
  const [form, setForm] = useState({ neededFrom: action.neededFrom, neededTo: action.neededTo, purpose: action.purpose ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (action.state !== 'open') {
    return <ResolvedNote action={action} done="Request sent." cancelled="Request cancelled." />
  }
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const saved = await requestService.create(
        {
          toolId: action.toolId,
          neededFrom: fromDateInput(form.neededFrom),
          neededTo: fromDateInput(form.neededTo),
          purpose: form.purpose.trim(),
        },
        user,
        { maxDays },
      )
      onResolved(
        'done',
        `Done — request ${saved?.id ?? ''} for ${action.toolName} was sent to the laboratory staff. You'll be notified when they decide it.`,
        [{ label: 'Requests', to: '/requests' }],
      )
    } catch (err) {
      setError(errorText(err, 'The request could not be sent.'))
      setBusy(false)
    }
  }

  return (
    <ConfirmCard
      icon={ClipboardPlus}
      title={`Request ${action.toolName}${action.toolStatus && action.toolStatus !== 'Available' ? ` (currently ${action.toolStatus.toLowerCase()})` : ''}?`}
      busy={busy}
      error={error}
      confirmLabel="Send request"
      onConfirm={submit}
      onCancel={() => onResolved('cancelled')}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className={cardLabel}>
          From
          <input type="date" className="input mt-1 w-full" value={form.neededFrom} onChange={set('neededFrom')} disabled={busy} />
        </label>
        <label className={cardLabel}>
          Until
          <input type="date" className="input mt-1 w-full" value={form.neededTo} onChange={set('neededTo')} disabled={busy} />
        </label>
      </div>
      <label className={cardLabel}>
        Purpose
        <input
          className="input mt-1 w-full"
          value={form.purpose}
          onChange={set('purpose')}
          maxLength={300}
          placeholder="What it is for (optional)"
          disabled={busy}
        />
      </label>
    </ConfirmCard>
  )
}

/** "The drill is broken" — files through the same `reportProblem()` the tool page uses. */
function ProblemReportCard({ action, onResolved }) {
  const [form, setForm] = useState({ type: action.problemType, description: action.description ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (action.state !== 'open') {
    return <ResolvedNote action={action} done="Report sent." cancelled="Report cancelled." />
  }
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await maintenanceService.reportProblem({ toolId: action.toolId, type: form.type, description: form.description })
      onResolved('done', `Thanks — your report about ${action.toolName} was sent to the laboratory staff.`)
    } catch (err) {
      setError(errorText(err, 'The report could not be sent.'))
      setBusy(false)
    }
  }

  return (
    <ConfirmCard
      icon={Flag}
      title={`Report a problem with ${action.toolName}?`}
      busy={busy}
      error={error}
      confirmLabel="Send report"
      onConfirm={submit}
      onCancel={() => onResolved('cancelled')}
    >
      <label className={cardLabel}>
        Type
        <select className="input mt-1 w-full" value={form.type} onChange={set('type')} disabled={busy}>
          {MAINTENANCE_TYPES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className={cardLabel}>
        What's wrong
        <textarea
          className="input mt-1 w-full resize-none"
          rows={3}
          value={form.description}
          onChange={set('description')}
          maxLength={500}
          disabled={busy}
        />
      </label>
    </ConfirmCard>
  )
}

/** Staff: approve or reject — the same `requests` decisions the Requests page makes. */
function RequestDecisionCard({ action, user, onResolved }) {
  const [note, setNote] = useState(action.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const approve = action.decision === 'approve'

  if (action.state !== 'open') {
    return (
      <ResolvedNote
        action={action}
        done={approve ? 'Request approved.' : 'Request rejected.'}
        cancelled="Nothing was changed."
      />
    )
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      if (action.batchId) {
        // A batch is decided as one, exactly as on the Requests page.
        const request = await requestService.getById(action.requestId)
        await requestService.decideBatch(request, user, { approved: approve, note })
      } else if (approve) {
        await requestService.approve(action.requestId, user, { note })
      } else {
        await requestService.reject(action.requestId, user, { note })
      }
      onResolved(
        'done',
        `Done — ${action.requester}'s request for ${action.toolName} was ${approve ? 'approved' : 'rejected'}.`,
        [{ label: 'Requests', to: '/requests' }],
      )
    } catch (err) {
      setError(errorText(err, 'The request could not be decided.'))
      setBusy(false)
    }
  }

  return (
    <ConfirmCard
      icon={approve ? Check : Ban}
      title={`${approve ? 'Approve' : 'Reject'} ${action.requester}'s request for ${action.toolName}?`}
      busy={busy}
      error={error}
      confirmLabel={approve ? 'Approve' : 'Reject'}
      onConfirm={submit}
      onCancel={() => onResolved('cancelled')}
    >
      <label className={cardLabel}>
        Note {approve ? '(optional)' : 'for the requester'}
        <input className="input mt-1 w-full" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} disabled={busy} />
      </label>
    </ConfirmCard>
  )
}

/** The card for one proposed action. */
function ActionCard({ action, user, onResolved }) {
  switch (action.type) {
    case 'return_request':
      return <ReturnRequestCard action={action} user={user} onResolved={onResolved} />
    case 'tool_request':
      return <ToolRequestCard action={action} user={user} onResolved={onResolved} />
    case 'problem_report':
      return <ProblemReportCard action={action} onResolved={onResolved} />
    case 'request_decision':
      return <RequestDecisionCard action={action} user={user} onResolved={onResolved} />
    default:
      return null
  }
}

/**
 * Messages, composer and voice. `variant` is 'card' (inside the floating card)
 * or 'page' (the full `/tobi` page). `onLeave` runs before a link navigates, so
 * the card can close itself.
 */
export function TobiConversation({ variant = 'card', onLeave, autoFocus = true }) {
  const { user, online } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const tobi = useTobi(user?.id)
  const { messages, pending, failure, busy, actions, usage } = tobi
  // The server decides; this only mirrors what it last said, so the composer
  // can say why it is closed instead of letting a doomed request go out.
  const limitReached = !!usage && usage.remaining <= 0
  const canAsk = online && !limitReached
  const voice = useVoice()
  const [draft, setDraft] = useState('')
  const [voiceMode, setVoiceMode] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const voiceModeRef = useRef(false)
  const spokenRef = useRef(null)

  const started = messages.length > 0 || pending || !!failure
  const isPage = variant === 'page'
  const path = location.pathname === '/tobi' ? (location.state?.from ?? '/tobi') : location.pathname

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending, failure])

  useEffect(() => {
    actions?.loadUsage()
  }, [actions])

  // "Open Tool Map": go there as soon as TOBI answers — no button to press.
  // Marked first so it is followed exactly once; an old one (the chat was
  // closed before the answer came) is dropped rather than jumping later.
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last?.navigateTo || last.navigated) return
    actions?.markNavigated(last.id)
    if (Date.now() - (last.at ?? 0) > 15_000) return
    onLeave?.()
    navigate(last.navigateTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  // The field grows with what is typed (up to its max height), then scrolls.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft, isPage, started])

  useEffect(() => {
    if (!autoFocus) return undefined
    const focus = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(focus)
  }, [autoFocus])

  const ask = (text) => {
    if (!text.trim() || busy || limitReached) return
    actions?.ask(text, path)
    setDraft('')
  }

  /* -------------------------------- voice -------------------------------- */

  const listenAndAsk = async () => {
    const heard = await voice.listen()
    if (!voiceModeRef.current) return
    if (!heard) {
      // Silence ends the conversation rather than listening forever.
      endVoice()
      return
    }
    ask(heard)
  }

  const startVoice = () => {
    voiceModeRef.current = true
    setVoiceMode(true)
    // Only replies from here on are read aloud.
    spokenRef.current = messages[messages.length - 1]?.id ?? null
    listenAndAsk()
  }

  const endVoice = () => {
    voiceModeRef.current = false
    setVoiceMode(false)
    voice.stop()
  }

  // In a voice conversation each new reply is read aloud, then TOBI listens again.
  useEffect(() => {
    if (!voiceMode) return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || last.id === spokenRef.current) return
    spokenRef.current = last.id
    voice.speak(last.content).then(() => {
      if (voiceModeRef.current) listenAndAsk()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, voiceMode])

  // A failed answer ends the voice turn; the error and Retry are on screen.
  // So does the daily limit — there is nothing left to listen for.
  useEffect(() => {
    if (voiceMode && (failure || limitReached)) endVoice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failure, limitReached])

  useEffect(() => () => (voiceModeRef.current = false), [])

  const dictate = async () => {
    if (voice.status === 'listening') return voice.stop()
    const heard = await voice.listen()
    if (heard) setDraft((current) => (current ? `${current} ${heard}` : heard))
    inputRef.current?.focus()
  }

  const role = user?.role
  const contextual = pageSuggestion(path, role)
  const suggestions = [...(contextual ? [contextual] : []), ...(SUGGESTIONS[role] ?? [])].slice(0, 4)
  const column = isPage ? 'mx-auto w-full max-w-3xl' : ''

  const field = (
    <textarea
      ref={inputRef}
      rows={started || isPage ? 1 : 2}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          ask(draft)
        }
      }}
      maxLength={1000}
      placeholder={
        voice.status === 'listening'
          ? 'Listening…'
          : limitReached
            ? 'Daily TOBI limit reached — back tomorrow'
            : online
              ? 'Ask TOBI about your tools…'
              : 'Offline — TOBI needs a connection'
      }
      disabled={!canAsk}
      aria-label="Message TOBI"
      className={cx(
        'block max-h-40 w-full resize-none bg-transparent outline-none placeholder:opacity-50',
        isPage ? 'min-w-0 flex-1 py-2 !text-[15px] leading-6' : 'py-1.5',
        !isPage && (started ? '!text-base' : '!text-xl font-medium'),
      )}
    />
  )

  const roundButton = 'grid h-9 w-9 shrink-0 place-items-center rounded-full transition disabled:opacity-40'
  const controls = (
    <>
      {canListen && (
        <button
          type="button"
          onClick={dictate}
          disabled={!canAsk}
          aria-label={voice.status === 'listening' ? 'Stop dictation' : 'Dictate a message'}
          aria-pressed={voice.status === 'listening'}
          className={cx(
            roundButton,
            voice.status === 'listening' ? 'bg-red-500 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10',
          )}
        >
          <Mic className="h-[18px] w-[18px]" />
        </button>
      )}
      {/* An empty composer offers a voice conversation, like the assistants
          people already use; typing turns it into Send. */}
      {!draft.trim() && canListen && canSpeak ? (
        <button
          type="button"
          onClick={startVoice}
          disabled={busy || !canAsk}
          aria-label="Start a voice conversation"
          title="Voice chat"
          className={roundButton}
          style={{ background: 'rgb(var(--accent))', color: 'rgb(var(--accent-contrast))' }}
        >
          <AudioLines className="h-[18px] w-[18px]" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!draft.trim() || busy || !canAsk}
          aria-label="Send"
          className={roundButton}
          style={{ background: 'rgb(var(--accent))', color: 'rgb(var(--accent-contrast))' }}
        >
          <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} />
        </button>
      )}
    </>
  )

  return (
    <>
      {/* ---------------------------- conversation --------------------------- */}
      {(started || isPage) && (
        <div
          ref={scrollRef}
          className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain', isPage ? 'px-4 py-4' : 'px-4 py-2')}
          aria-live="polite"
        >
          {/* The full page opens on a greeting and the role's suggestions as
              cards, centred in the space the conversation will fill. */}
          {isPage && !started && (
            <div className={cx(column, 'flex min-h-full flex-col items-center justify-center py-4 text-center')}>
              <span className="tobi-glow liquid-glass-orb grid h-16 w-16 place-items-center rounded-full sm:h-20 sm:w-20">
                <Sparkles className="h-8 w-8 sm:h-10 sm:w-10" />
              </span>
              <p className="mt-4 text-xl font-extrabold tracking-tight sm:text-[26px] sm:leading-tight">
                {greetingFor(user)}
              </p>
              <p className="subtle mx-auto mt-2 max-w-md text-sm">
                {role === ROLE.STUDENT
                  ? 'Ask about your borrowed tools, due dates, requests, or where your tool was last recorded.'
                  : 'Ask about loans, overdue tools, availability, requests, locations or problem reports.'}
              </p>
              <div className="mt-6 grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-2">
                {suggestions.map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => ask(text)}
                    disabled={busy || !canAsk}
                    className="group flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-left text-[13px] font-semibold
                               transition hover:-translate-y-0.5 hover:shadow-card disabled:opacity-50"
                    style={{ background: 'rgb(var(--surface))', color: 'rgb(var(--text))' }}
                  >
                    <span className="min-w-0 flex-1">{text}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 opacity-40 transition group-hover:translate-x-0.5 group-hover:opacity-80" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <ol className={cx(column, 'space-y-3')}>
            {messages.map((message) =>
              message.role === 'user' ? (
                <li key={message.id} className="flex justify-end">
                  <p
                    className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm"
                    style={{ background: 'rgb(var(--accent))', color: 'rgb(var(--accent-contrast))' }}
                  >
                    {message.content}
                  </p>
                </li>
              ) : (
                <li key={message.id} className="flex">
                  <div className="min-w-0 max-w-[88%]">
                    <div className="rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm leading-relaxed" style={softFill}>
                      <RichText text={message.content} />
                    </div>
                    {message.actions?.map((action, i) => (
                      <ActionCard
                        key={`${message.id}-a${i}`}
                        action={action}
                        user={user}
                        onResolved={(state, followUp, links) =>
                          actions?.resolveAction(message.id, i, state, followUp, links)
                        }
                      />
                    ))}
                    {message.links?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {message.links.map((link) => (
                          <button
                            key={link.to}
                            type="button"
                            onClick={() => {
                              onLeave?.()
                              navigate(link.to)
                            }}
                            className="inline-flex items-center gap-0.5 rounded-full px-2.5 py-1 text-xs font-bold transition hover:brightness-95"
                            style={softFill}
                          >
                            Open {link.label}
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ),
            )}

            {pending && (
              <li className="flex items-center gap-2" aria-label="TOBI is thinking">
                <span className="flex items-center gap-1 rounded-2xl rounded-tl-md px-3.5 py-3" style={softFill}>
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-50 motion-reduce:animate-none"
                      style={{ animationDelay: `${dot * 150}ms` }}
                    />
                  ))}
                </span>
              </li>
            )}

            {failure && !pending && (
              <li className="flex justify-center">
                <div className="flex max-w-[95%] items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  <span className="min-w-0">{failure.message}</span>
                  {failure.retryable && (
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-white"
                      onClick={() => actions?.retry(path)}
                    >
                      <RotateCcw className="h-3 w-3" /> Retry
                    </button>
                  )}
                </div>
              </li>
            )}
          </ol>
        </div>
      )}

      {/* ------------------------ voice conversation ------------------------- */}
      {voiceMode ? (
        <div className={cx(column, 'flex flex-col items-center px-4 pb-4 pt-3 text-center')} role="status">
          <span
            className={cx(
              'liquid-glass-orb grid h-16 w-16 place-items-center rounded-full transition-transform',
              voice.status === 'listening' && 'scale-110 animate-pulse motion-reduce:animate-none',
            )}
          >
            <AudioLines className="h-7 w-7" />
          </span>
          <p className="mt-2.5 text-sm font-bold">
            {voice.status === 'listening'
              ? 'Listening…'
              : pending
                ? 'Thinking…'
                : voice.status === 'speaking'
                  ? 'Speaking…'
                  : 'Voice chat'}
          </p>
          <p className="subtle mt-0.5 min-h-[1.25rem] max-w-full truncate text-xs">
            {voice.interim || (voice.status === 'listening' ? 'Say something to TOBI' : '')}
          </p>
          <div className="mt-2 flex gap-2">
            {voice.status === 'speaking' && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={voice.skip}>
                Skip
              </button>
            )}
            <button type="button" className="btn btn-outline btn-sm" onClick={endVoice}>
              <X className="h-4 w-4" /> End voice chat
            </button>
          </div>
        </div>
      ) : (
        /* ------------------------------ composer ----------------------------- */
        <form
          className={cx(column, isPage ? 'px-3 pb-3 pt-2 sm:px-4' : 'px-4 pb-3.5 pt-1')}
          onSubmit={(event) => {
            event.preventDefault()
            ask(draft)
          }}
        >
          {isPage ? (
            // The full page: one slim row — the field, then the mic and Send —
            // growing only as far as the text needs.
            <div
              className="flex items-end gap-1 rounded-[24px] border py-1.5 pl-4 pr-1.5 shadow-card transition-shadow focus-within:shadow-panel"
              style={{ background: 'rgb(var(--surface))' }}
            >
              {field}
              {controls}
            </div>
          ) : (
            <>
              {field}
              <div className="mt-2 flex items-center gap-1.5">
                {!started ? (
                  <div className="no-scrollbar -ml-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto pl-1">
                    {suggestions.map((text) => (
                      <button
                        key={text}
                        type="button"
                        onClick={() => ask(text)}
                        disabled={busy || !canAsk}
                        className="shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition hover:brightness-95 disabled:opacity-50"
                        style={softFill}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="flex-1" />
                )}
                {controls}
              </div>
            </>
          )}
          {voice.interim && voice.status === 'listening' && (
            <p className="subtle mt-1 truncate px-2 text-xs">{voice.interim}</p>
          )}
          {voice.error && <p className="mt-1.5 px-2 text-xs font-semibold text-red-600 dark:text-red-400">{voice.error}</p>}
          {/* The line every assistant carries. Usage is not counted out here;
              reaching the limit shows in the composer and in TOBI's reply. */}
          <p className="subtle mt-1.5 text-center text-[10.5px] leading-snug">
            TOBI can make mistakes. Check important info.
          </p>
        </form>
      )}
    </>
  )
}

/** The floating glass card over any page, anchored where the bottom bar sits. */
export default function TobiChat({ open, onClose, originRef }) {
  const { user } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const { messages, pending, failure, actions, conversation } = useTobi(user?.id)
  const started = messages.length > 0 || pending || !!failure
  // Mounted a moment longer than `open`, so closing can play out.
  const { rendered, state } = useExitTransition(open, 220)
  const cardRef = useRef(null)

  // The card grows out of the button it was opened from and folds back into
  // it: its transform origin is that button's centre, measured in the card's
  // own box before the first paint. Without a button (a direct open), the
  // stylesheet's corner origin stands.
  useLayoutEffect(() => {
    if (!rendered) return
    const card = cardRef.current
    const button = originRef?.current
    if (!card || !button) return
    // The card's own position from its offsets — unlike its bounding box,
    // these ignore the entrance transform already scaling it. Its parent is the
    // fixed full-screen layer at 0,0, so they are viewport coordinates.
    const from = button.getBoundingClientRect()
    const x = from.left + from.width / 2 - card.offsetLeft
    const y = from.top + from.height / 2 - card.offsetTop
    card.style.transformOrigin = `${x}px ${y}px`
  }, [rendered, originRef])

  useEffect(() => {
    if (!open) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!rendered) return null

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="Close TOBI"
        data-state={state}
        className="tobi-scrim absolute inset-0 bg-slate-950/25"
        onClick={onClose}
      />
      {/* Compact while empty, growing with the conversation up to most of the
          screen. Maximise opens the same chat as a full page at /tobi. */}
      <section
        role="dialog"
        aria-modal="true"
        aria-label="TOBI, the Tool Track assistant"
        ref={cardRef}
        data-state={state}
        // Phone: across the screen above the bottom bar. From sm: a 28rem card
        // centred at the bottom — of the content area on a desktop, beside the
        // 248px rail, not of the whole window.
        className="tobi-card liquid-glass absolute inset-x-3 mx-auto flex max-h-[min(78dvh,640px)] flex-col
                   overflow-hidden rounded-[28px] sm:inset-x-0 sm:w-[28rem] lg:left-[248px] lg:max-h-[min(72dvh,620px)]"
        style={{ bottom: 'max(var(--sab), 1rem)' }}
      >
        <header className="tobi-item flex items-center gap-1 pb-1 pl-5 pr-2 pt-3">
          <p className="min-w-0 flex-1 truncate text-[15px] font-bold">
            {started ? conversation?.title || 'New chat' : greetingFor(user)}
          </p>
          {messages.length > 0 && (
            <button
              type="button"
              className={tobiIconButton}
              onClick={() => actions?.newConversation()}
              aria-label="New conversation"
              title="New conversation"
            >
              <SquarePen className="h-[18px] w-[18px]" />
            </button>
          )}
          <button
            type="button"
            className={tobiIconButton}
            onClick={() => {
              onClose()
              navigate('/tobi', { state: { from: location.pathname } })
            }}
            aria-label="Open TOBI full screen"
            title="Full screen"
          >
            <Maximize2 className="h-[18px] w-[18px]" />
          </button>
          <button type="button" className={tobiIconButton} onClick={onClose} aria-label="Close TOBI">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="tobi-item flex min-h-0 flex-1 flex-col">
          <TobiConversation variant="card" onLeave={onClose} />
        </div>
      </section>
    </div>
  )
}
