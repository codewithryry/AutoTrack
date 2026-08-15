import { useMemo, useState } from 'react'
import { NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ClipboardList, MessageSquare, Trash2, Users } from 'lucide-react'
import ChatThread from '../components/ChatThread'
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  SearchInput,
  SkeletonRows,
  Spinner,
} from '../components/ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useInbox, useMediaQuery, usePresence, useUsers } from '../hooks'
import * as messageService from '../services/messages'
import { isBroadcast } from '../services/messages'
import { dropCache } from '../hooks/asyncCache'
import { cx, initials } from '../utils/helpers'
import { timeAgo } from '../utils/dates'
import { CONVERSATION_KIND } from '../utils/constants'
import { isAdmin, isStaff } from '../utils/permissions'

/**
 * The inbox, and the thread beside it.
 *
 * One page serves `/messages` and `/messages/:id`: a desktop shows the list and
 * the open thread side by side, a phone shows one or the other, so a
 * conversation on a phone is a full screen rather than half of a two-pane
 * layout squeezed into it.
 *
 * Every thread here is one the account is a participant of — `useInbox` reads
 * what the policies return and nothing more.
 */
export default function MessagesPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useApp()
  const toast = useToast()
  const { conversations, loading, error, reload, setData } = useInbox()
  const { online } = usePresence()
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  const [search, setSearch] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  /**
   * Clear messaging entirely — an administrator's action, and one that deletes
   * for everybody: the rows leave the database, so an instructor's and a
   * student's inbox lose the same threads.
   */
  const clearAll = async () => {
    setClearing(true)
    try {
      const removed = await messageService.removeAll(user)
      if (user?.id) dropCache(`inbox:${user.id}`)
      setData([])
      setConfirmClear(false)
      navigate('/messages', { replace: true })
      toast.success(
        removed === 1 ? '1 conversation deleted.' : `${removed} conversations deleted.`,
      )
      reload()
    } catch (err) {
      toast.error(err.message ?? 'The conversations could not be deleted.')
    } finally {
      setClearing(false)
    }
  }

  // Composing is a URL state rather than a button's: the raised slot in the
  // bottom bar opens it with `?new=1`, the same way the tools page is opened
  // on its create dialog.
  const [params, setParams] = useSearchParams()
  const composing = params.get('new') === '1'
  const closeCompose = () => setParams({}, { replace: true })

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return conversations
    return conversations.filter((c) =>
      // `others` is derived by the service, but a row read back from the
      // offline cache may predate it — a missing list must not take the page
      // down with it.
      [c.subject, c.lastMessagePreview, ...(c.others ?? []).map((o) => o.userName)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    )
  }, [conversations, search])

  // The two standing rooms sit at the top of the list and stay there: they are
  // the same for everybody and never move down as other threads get busier.
  const pinnedFirst = useMemo(() => {
    const rank = (c) => (isBroadcast(c) ? 0 : 1)
    return [...filtered].sort((a, b) => rank(a) - rank(b))
  }, [filtered])

  // On a desktop the pane is never empty when there is something to show.
  const activeId = id ?? (isDesktop ? (pinnedFirst[0]?.id ?? null) : null)
  const showList = isDesktop || !id

  const list = (
    /* The viewport, less the top bar, this page's own top padding, the search
       box above the list, and the floating bottom bar with its inset — so the
       last row stops clear of the bar instead of scrolling under it. */
    <div
      className="flex min-h-0 flex-col lg:h-auto"
      style={{ height: 'calc(100dvh - 12.5rem - max(var(--sab), 1rem))' }}
    >
      {/* Search first, and no card around the list: the page is the inbox, so
          a heading naming it and a border around it were both saying the same
          thing twice. */}
      <div className="flex shrink-0 items-center gap-2 pb-3">
        <div className="min-w-0 flex-1">
          <SearchInput value={search} onChange={setSearch} placeholder="Search conversations…" />
        </div>
        {/* Clearing messaging is an administrator's action, beside the search
            rather than inside a thread — it is about the inbox, not about one
            conversation in it. */}
        {isAdmin(user) && conversations.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="btn btn-outline btn-icon shrink-0 text-red-600 dark:text-red-400"
            aria-label="Delete all conversations"
            title="Delete all conversations"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {error ? (
        <ErrorState
          title="Your messages could not be loaded."
          description={error.message}
          onRetry={reload}
        />
      ) : loading && !conversations.length ? (
        <SkeletonRows rows={5} columns={2} />
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center">
          <EmptyState
            icon={MessageSquare}
            title={search ? 'No conversation matches.' : 'No conversations yet.'}
            description={
              search
                ? 'Try a different name or tool.'
                : 'A thread is opened for every tool request, and staff can start one with you.'
            }
          />
        </div>
      ) : (
        <ul className="card min-h-0 flex-1 overflow-y-auto p-0">
          {pinnedFirst.map((conversation) => {
            const others = conversation.others ?? []
            const partner = others.length === 1 ? others[0] : null
            const label =
              conversation.subject || others.map((o) => o.userName).join(', ') || 'Conversation'
            return (
              <li key={conversation.id}>
                <NavLink
                  to={`/messages/${conversation.id}`}
                  className={cx(
                    'flex min-h-[64px] items-center gap-3 border-b px-3 py-2.5 text-left transition-colors',
                    'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
                    conversation.id === activeId && 'bg-black/[0.04] dark:bg-white/[0.05]',
                  )}
                >
                  <span className="relative shrink-0">
                    <span
                      className="grid h-10 w-10 place-items-center rounded-full text-xs font-extrabold
                                 ring-1 ring-black/5 dark:ring-white/10"
                      style={{ background: 'rgb(var(--rail))', color: 'rgb(var(--accent))' }}
                    >
                      {conversation.kind === CONVERSATION_KIND.REQUEST ? (
                        <ClipboardList className="h-4 w-4" />
                      ) : isBroadcast(conversation) ? (
                        <Users className="h-4 w-4" />
                      ) : (
                        initials(label)
                      )}
                    </span>
                    {partner && online.includes(partner.userId) && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2"
                        style={{ '--tw-ring-color': 'rgb(var(--surface))' }}
                        aria-label="Online"
                      />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-bold">{label}</span>
                      {conversation.lastMessageAt && (
                        <span className="subtle shrink-0 text-[10px] font-semibold">
                          {timeAgo(conversation.lastMessageAt)}
                        </span>
                      )}
                    </span>
                    <span className="muted mt-0.5 block truncate text-xs">
                      {conversation.lastMessagePreview || 'No messages yet'}
                    </span>
                  </span>

                  {conversation.unread > 0 && (
                    <span
                      className="grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full
                                 bg-red-500 px-1.5 text-[10px] font-bold text-white"
                    >
                      {conversation.unread > 99 ? '99+' : conversation.unread}
                    </span>
                  )}
                </NavLink>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  return (
    <>
      {/* No page header at any width: the shell's top bar names the page, and
          the list's own "Conversations" heading names the pane. */}
      {/* A phone shows one pane at a time; a desktop shows the list beside the
          thread, both sized to the viewport so only the messages scroll. The
          list is given the phone's height too, so an empty inbox is a full
          screen with the mascot on it rather than a thin strip. */}
      <div className="grid gap-4 lg:h-[calc(100dvh-9.5rem)] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {showList && list}

        {activeId ? (
          <ChatThread
            key={activeId}
            conversationId={activeId}
            online={online}
            onBack={() => navigate('/messages')}
            /* A deleted thread leaves the list at once and the pane closes; the
               re-read the write raises behind it confirms what is already
               drawn. */
            onDeleted={(deletedId) => {
              setData((rows) => (rows ?? []).filter((row) => row.id !== deletedId))
              navigate('/messages', { replace: true })
            }}
            /* An open thread has no bottom bar under it, so it runs to the
               bottom of the screen: the viewport less the top bar, this page's
               top padding and the safe-area inset. */
            className="lg:h-auto"
            style={{ height: 'calc(100dvh - 5.5rem - var(--sab))' }}
          />
        ) : (
          isDesktop && (
            <div className="card hidden lg:block">
              <EmptyState
                icon={MessageSquare}
                title="No conversation open."
                description="Choose a thread on the left to read it."
              />
            </div>
          )
        )}
      </div>

      <ComposeDialog open={composing} onClose={closeCompose} />

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearAll}
        loading={clearing}
        title="Delete every conversation?"
        message="Every thread and every message in the laboratory will be removed — for administrators, instructors and students alike. The general and staff rooms stay, emptied. This cannot be undone."
        confirmLabel="Delete everything"
        confirmPhrase="DELETE"
      />
    </>
  )
}

/**
 * Start a 1-to-1 thread.
 *
 * Staff only, because the directory is: a student reaches the crib through the
 * thread on their request, and through any thread staff open with them.
 * `openDirectConversation` reuses an existing thread rather than making a
 * second one.
 */
function ComposeDialog({ open, onClose }) {
  const { user } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const { users, loading } = useUsers()
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(null)

  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase()
    return users
      .filter((u) => u.id !== user?.id && u.status === 'Active')
      // The pairing rule the service enforces, shown rather than discovered:
      // staff talk to anyone, a student talks to the crib. Two students have no
      // thread to open, so they are not offered one.
      .filter((u) => isStaff(user) || isStaff(u))
      .filter((u) => !term || `${u.fullName} ${u.role}`.toLowerCase().includes(term))
  }, [users, user, search])

  const start = async (other) => {
    setBusy(other.id)
    try {
      const conversation = await messageService.openDirectConversation(other.id, user)
      onClose()
      navigate(`/messages/${conversation.id}`)
    } catch (err) {
      toast.error(err.message ?? 'That conversation could not be opened.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New conversation" size="sm">
      <SearchInput value={search} onChange={setSearch} placeholder="Search people…" />
      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {loading ? (
          <SkeletonRows rows={4} columns={2} />
        ) : candidates.length === 0 ? (
          <EmptyState icon={MessageSquare} compact title="Nobody to message." />
        ) : (
          candidates.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => start(person)}
              disabled={!!busy}
              className="flex min-h-[52px] w-full items-center gap-3 border-b px-1 text-left last:border-b-0
                         disabled:opacity-60"
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-extrabold"
                style={{ background: 'rgb(var(--rail))', color: 'rgb(var(--accent))' }}
              >
                {initials(person.fullName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{person.fullName}</span>
                <span className="subtle block truncate text-xs">{person.role}</span>
              </span>
              {busy === person.id && <Spinner />}
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}
