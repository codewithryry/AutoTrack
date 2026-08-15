import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  ClipboardList,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  Trash2,
  Users,
  Send,
  X,
} from 'lucide-react'
import { ConfirmDialog, EmptyState, ErrorState, Skeleton } from './ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useConversation } from '../hooks'
import { dropCache } from '../hooks/asyncCache'
import * as messageService from '../services/messages'
import { cx, initials } from '../utils/helpers'
import { formatDate, formatTime, timeAgo } from '../utils/dates'
import { CONVERSATION_KIND } from '../utils/constants'

/**
 * One conversation, drawn the same way on a phone and beside the inbox on a
 * desktop.
 *
 * It reads through `useConversation`, which subscribes to this thread's rows, so
 * a message somebody else sends arrives on its own and is marked read simply by
 * having the thread open. Sending, uploading and validating an attachment are
 * the message service's — nothing about a conversation is decided here.
 */
export default function ChatThread({
  conversationId,
  onBack,
  onDeleted,
  className,
  style,
  online = [],
}) {
  const { user } = useApp()
  const toast = useToast()
  const { conversation, messages, participants, loading, error, reload } =
    useConversation(conversationId)

  const [body, setBody] = useState('')
  const [file, setFile] = useState(null)
  const [sending, setSending] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const fileRef = useRef(null)
  const endRef = useRef(null)

  // The newest line is what the thread is opened for, so it is what is shown.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [conversationId, messages.length])

  const others = useMemo(
    () => participants.filter((p) => p.userId !== user?.id),
    [participants, user?.id],
  )

  const title =
    conversation?.subject || others.map((p) => p.userName).join(', ') || 'Conversation'

  // Presence is only meaningful for a 1-to-1 thread; a request thread carries the
  // whole crib, so it names the request instead.
  const partner = others.length === 1 ? others[0] : null
  const partnerOnline = partner ? online.includes(partner.userId) : false

  const pickFile = (event) => {
    const chosen = event.target.files?.[0] ?? null
    if (!chosen) return
    const invalid = messageService.validateAttachment(chosen)
    if (invalid) {
      toast.error(invalid)
      event.target.value = ''
      return
    }
    setFile(chosen)
  }

  const clearFile = () => {
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const submit = async (event) => {
    event.preventDefault()
    if (sending) return
    const text = body.trim()
    if (!text && !file) return

    setSending(true)
    try {
      const attachment = file ? await messageService.uploadAttachment(file, user) : null
      await messageService.send({ conversationId, body: text, attachment }, user)
      setBody('')
      clearFile()
    } catch (err) {
      toast.error(err.message ?? 'That message could not be sent.')
    } finally {
      setSending(false)
    }
  }

  /**
   * Delete the thread, and leave nothing of it behind: the records go through
   * the message service, this thread's cached result is dropped so the inbox
   * cannot render it back from memory, and the page is told to move on.
   */
  const remove = async () => {
    setDeleting(true)
    try {
      await messageService.remove(conversationId, user)
      dropCache(`conversation:${conversationId}`)
      if (user?.id) dropCache(`inbox:${user.id}`)
      setConfirmDelete(false)
      toast.success('Conversation deleted.')
      onDeleted?.(conversationId)
    } catch (err) {
      toast.error(err.message ?? 'That conversation could not be deleted.')
    } finally {
      setDeleting(false)
    }
  }

  // Anybody in the thread may remove it — the people in a conversation own it.
  // The standing rooms are the exception: they have to go on existing.
  const canDelete =
    !!conversation &&
    !messageService.isBroadcast(conversation) &&
    participants.some((p) => p.userId === user?.id)

  if (error) {
    return (
      <div className={cx('card', className)} style={style}>
        <ErrorState
          title="This conversation could not be opened."
          description={error.message}
          onRetry={reload}
        />
      </div>
    )
  }

  if (loading && !conversation) {
    return (
      <div className={cx('card p-4', className)} style={style}>
        <Skeleton className="h-10 w-2/3 rounded-lg" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-14 w-3/4 rounded-2xl" />
          <Skeleton className="ml-auto h-14 w-2/3 rounded-2xl" />
          <Skeleton className="h-14 w-1/2 rounded-2xl" />
        </div>
      </div>
    )
  }

  if (!conversation) {
    return (
      <div className={cx('card', className)} style={style}>
        <EmptyState
          icon={MessageSquare}
          title="Conversation not found."
          description="It may have been removed, or you are no longer part of it."
        />
      </div>
    )
  }

  return (
    <section className={cx('card flex min-h-0 flex-col overflow-hidden', className)} style={style}>
      {/* ------------------------------- header ------------------------------- */}
      <header
        className="flex shrink-0 items-center gap-3 border-b px-3 py-2.5 sm:px-4"
        style={{ background: 'rgb(var(--surface-2))' }}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="btn btn-ghost btn-icon -ml-1 shrink-0 lg:hidden"
            aria-label="Back to messages"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-extrabold
                     ring-1 ring-black/5 dark:ring-white/10"
          style={{ background: 'rgb(var(--rail))', color: 'rgb(var(--accent))' }}
        >
          {conversation.kind === CONVERSATION_KIND.REQUEST ? (
            <ClipboardList className="h-4 w-4" />
          ) : messageService.isBroadcast(conversation) ? (
            <Users className="h-4 w-4" />
          ) : (
            initials(partner?.userName ?? title)
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{title}</p>
          <p className="subtle truncate text-[11px]">
            {messageService.isBroadcast(conversation)
              ? conversation.kind === CONVERSATION_KIND.STAFF
                ? 'Instructors and administrators'
                : 'Everyone in the laboratory'
              : conversation.kind === CONVERSATION_KIND.REQUEST
              ? `Request thread · ${others.length + 1} participant${others.length ? 's' : ''}`
              : partner
                ? partnerOnline
                  ? 'Online'
                  : 'Offline'
                : `${others.length + 1} participants`}
          </p>
        </div>
        {conversation.requestId && (
          <Link
            to={`/requests/${conversation.requestId}`}
            className="btn btn-outline btn-sm shrink-0"
          >
            <ClipboardList className="h-4 w-4" />
            <span className="hidden sm:inline">Request</span>
          </Link>
        )}
        {/* Removing a thread is an administrator's action, the same audience the
            delete policies on the tables allow. */}
        {canDelete && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="btn btn-ghost btn-icon shrink-0 text-red-600 dark:text-red-400"
            aria-label="Delete conversation"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </header>

      {/* ------------------------------ messages ------------------------------ */}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-center">
            <EmptyState
              icon={MessageSquare}
              title="No messages yet."
              description="Write the first message below."
              compact
            />
          </div>
        ) : (
          messages.map((message, index) => {
            const mine = message.senderId === user?.id
            const previous = messages[index - 1]
            const newDay =
              !previous || formatDate(previous.createdAt) !== formatDate(message.createdAt)
            return (
              <div key={message.id}>
                {newDay && (
                  <p className="subtle my-3 text-center text-[11px] font-bold uppercase tracking-wider">
                    {formatDate(message.createdAt)}
                  </p>
                )}
                <Bubble message={message} mine={mine} />
              </div>
            )
          })
        )}
        <div ref={endRef} />
      </div>

      {/* ------------------------------ composer ------------------------------ */}
      <form
        onSubmit={submit}
        className="shrink-0 border-t px-3 py-2.5 sm:px-4"
        style={{ background: 'rgb(var(--surface-2))' }}
      >
        {file && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border px-3 py-2">
            <FileText className="h-4 w-4 shrink-0 opacity-60" />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{file.name}</span>
            <button
              type="button"
              onClick={clearFile}
              className="btn btn-ghost btn-icon -mr-1 h-8 w-8 shrink-0"
              aria-label="Remove attachment"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={messageService.ATTACHMENT_ACCEPT}
            onChange={pickFile}
            className="hidden"
            id="chat-attachment"
          />
          <label
            htmlFor="chat-attachment"
            className="btn btn-ghost btn-icon h-11 w-11 shrink-0 cursor-pointer"
            aria-label="Attach a file"
          >
            <Paperclip className="h-5 w-5" />
          </label>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends on a desktop keyboard; a phone keyboard's return key
              // inserts a line, which is what the shift modifier does here too.
              if (event.key === 'Enter' && !event.shiftKey && window.innerWidth >= 1024) {
                submit(event)
              }
            }}
            rows={1}
            placeholder="Write a message…"
            className="input max-h-32 min-h-[44px] flex-1 resize-none py-2.5"
            aria-label="Message"
          />
          <button
            type="submit"
            className="btn btn-primary btn-icon h-11 w-11 shrink-0"
            disabled={sending || (!body.trim() && !file)}
            aria-label="Send message"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        loading={deleting}
        title="Delete this conversation?"
        message={`“${title}” and every message in it will be removed for everyone. This cannot be undone.`}
        confirmLabel="Delete conversation"
      />
    </section>
  )
}

/** One message. Mine on the right in the accent, everyone else's on the left. */
function Bubble({ message, mine }) {
  return (
    <div className={cx('flex py-0.5', mine ? 'justify-end' : 'justify-start')}>
      <div className={cx('max-w-[85%] sm:max-w-[75%]', mine && 'items-end')}>
        {!mine && (
          <p className="subtle mb-0.5 px-1 text-[11px] font-bold">{message.senderName}</p>
        )}
        <div
          className={cx(
            'rounded-2xl px-3 py-2 text-sm leading-relaxed',
            mine ? 'rounded-br-sm' : 'rounded-bl-sm border',
          )}
          style={
            mine
              ? { background: 'rgb(var(--accent))', color: 'rgb(var(--accent-contrast))' }
              : { background: 'rgb(var(--surface-2))' }
          }
        >
          {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
          {message.attachmentUrl && (
            <Attachment message={message} className={message.body ? 'mt-2' : undefined} />
          )}
        </div>
        <p
          className={cx('subtle mt-0.5 px-1 text-[10px]', mine ? 'text-right' : 'text-left')}
          title={timeAgo(message.createdAt)}
        >
          {formatTime(message.createdAt)}
        </p>
      </div>
    </div>
  )
}

/**
 * An attachment link, minted on demand.
 *
 * The bucket is private, so the object path stored on the message is exchanged
 * for a signed link when the message is drawn rather than kept anywhere.
 */
function Attachment({ message, className }) {
  const [href, setHref] = useState(null)

  useEffect(() => {
    let live = true
    messageService
      .attachmentLink(message.attachmentUrl)
      .then((url) => live && setHref(url))
      .catch(() => live && setHref(null))
    return () => {
      live = false
    }
  }, [message.attachmentUrl])

  const label = message.attachmentName ?? 'Attachment'

  return (
    <a
      href={href ?? undefined}
      target="_blank"
      rel="noreferrer noopener"
      className={cx(
        'flex min-h-[40px] items-center gap-2 rounded-xl bg-black/10 px-2.5 py-2 text-xs font-semibold',
        !href && 'pointer-events-none opacity-70',
        className,
      )}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </a>
  )
}
