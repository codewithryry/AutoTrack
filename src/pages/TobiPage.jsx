import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { History, Minimize2, SquarePen, Trash2, X } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useExitTransition } from '../hooks/useExitTransition'
import { useTobi } from '../hooks/useTobi'
import { TobiConversation, tobiIconButton } from '../components/TobiChat'
import { cx } from '../utils/helpers'
import { timeAgo } from '../utils/dates'

/**
 * TOBI, full page — what the floating card's maximise button opens.
 *
 * The same conversation as the card (one store, `useTobi`), laid straight on
 * the page rather than in a card, with the recent chats saved on this device:
 * a column beside the chat from `lg`, a drawer sliding over it on a phone. The
 * shell's top bar already names the page, so the toolbar here carries only the
 * controls. Minimise goes back to the page TOBI was opened from, and the shell
 * drops the bottom bar here so the composer has the bottom of the screen.
 */
export default function TobiPage() {
  const { user } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const { conversations, activeId, actions, conversation } = useTobi(user?.id)
  const [historyOpen, setHistoryOpen] = useState(false)
  const drawer = useExitTransition(historyOpen, 200)
  const saved = conversations.filter((c) => c.messages.length)

  const minimise = () => {
    if (location.state?.from) navigate(-1)
    else navigate('/dashboard')
  }

  const historyList = (
    <div className="flex min-h-0 flex-1 flex-col">
      {saved.length === 0 ? (
        <p className="subtle px-3 text-sm">No saved chats yet.</p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
          {saved.map((c) => (
            <li key={c.id} className="group flex items-center">
              <button
                type="button"
                onClick={() => {
                  actions?.openConversation(c.id)
                  setHistoryOpen(false)
                }}
                className={cx(
                  'min-w-0 flex-1 rounded-xl px-2.5 py-2 text-left transition',
                  c.id === activeId ? 'bg-black/5 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5',
                )}
              >
                <span className="block truncate text-sm font-semibold">{c.title || 'New chat'}</span>
                <span className="subtle block text-[11px]">{timeAgo(new Date(c.updatedAt))}</span>
              </button>
              <button
                type="button"
                onClick={() => actions?.deleteConversation(c.id)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full opacity-60 transition hover:bg-red-500/10 hover:text-red-600 hover:opacity-100 lg:opacity-0 lg:group-hover:opacity-60"
                aria-label={`Delete chat "${c.title || 'New chat'}"`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="subtle mt-auto px-3 pb-1 pt-2 text-[10px] leading-snug">
        Saved on this device only, and cleared when you sign out.
      </p>
    </div>
  )

  return (
    <div className="tobi-page grid h-[calc(100dvh_-_5.5rem_-_var(--sab))] lg:h-[calc(100dvh_-_6.5rem)] lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-6">
      {/* Recent chats — a column from lg. */}
      <aside className="hidden min-h-0 flex-col lg:flex">
        <button
          type="button"
          onClick={() => actions?.newConversation()}
          className="mb-4 flex items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-sm font-bold shadow-card
                     transition hover:-translate-y-0.5 hover:shadow-panel"
          style={{ background: 'rgb(var(--surface))' }}
        >
          <SquarePen className="h-4 w-4 text-amberline-500" />
          New chat
        </button>
        <p className="subtle px-3 pb-2 text-[11px] font-bold uppercase tracking-wider">Recent chats</p>
        {historyList}
      </aside>

      <section className="relative flex min-h-0 flex-col lg:border-l lg:pl-6" aria-label="TOBI">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={cx(tobiIconButton, 'lg:hidden')}
            onClick={() => setHistoryOpen(true)}
            aria-label="Recent chats"
            aria-expanded={historyOpen}
          >
            <History className="h-5 w-5" />
          </button>
          {/* The chat's topic, once TOBI has named it. */}
          <p className="min-w-0 flex-1 truncate px-1 text-center text-sm font-bold lg:text-left">
            {conversation?.messages.length ? conversation.title || 'New chat' : ''}
          </p>
          <button
            type="button"
            className={cx(tobiIconButton, 'lg:hidden')}
            onClick={() => actions?.newConversation()}
            aria-label="New conversation"
            title="New conversation"
          >
            <SquarePen className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            className={tobiIconButton}
            onClick={minimise}
            aria-label="Exit full screen"
            title="Exit full screen"
          >
            <Minimize2 className="h-[18px] w-[18px]" />
          </button>
        </div>

        <TobiConversation variant="page" />

        {/* Recent chats on a phone: a drawer sliding over the conversation. */}
        {drawer.rendered && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <button
              type="button"
              data-state={drawer.state}
              className="tobi-scrim absolute inset-0 bg-slate-950/25"
              aria-label="Close recent chats"
              onClick={() => setHistoryOpen(false)}
            />
            <div
              data-state={drawer.state}
              className="tobi-drawer relative flex w-[82%] max-w-xs flex-col rounded-r-3xl pb-3 shadow-panel"
              style={{
                background: 'rgb(var(--surface))',
                paddingTop: 'max(var(--sat), 0.75rem)',
                paddingBottom: 'max(var(--sab), 0.75rem)',
              }}
            >
              <div className="flex items-center justify-between pb-1 pl-3 pr-2">
                <p className="subtle text-[11px] font-bold uppercase tracking-wider">Recent chats</p>
                <button
                  type="button"
                  className={tobiIconButton}
                  onClick={() => setHistoryOpen(false)}
                  aria-label="Close recent chats"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {historyList}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
