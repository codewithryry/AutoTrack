import { useEffect, useState } from 'react'
import { Check, Megaphone, Plus, X } from 'lucide-react'
import { AnnouncementEditor } from './AnnouncementsManager'
import { Badge, Modal } from './ui'
import { useApp } from '../context/AppContext'
import { useMediaQuery } from '../hooks'
import { useAnnouncements } from '../hooks/useAnnouncements'
import {
  ANNOUNCEMENT_PRIORITY,
  ANNOUNCEMENTS_PREVIEW,
  onOpenNotificationCenter,
  openNotificationCenter,
} from '../services/announcements'
import { cx } from '../utils/helpers'
import { PERM } from '../utils/permissions'
import { timeAgo } from '../utils/dates'

/**
 * The announcements panel: a floating panel in the top-right on a desktop,
 * the app's bottom sheet (`Modal`) on a phone. It opens from the header
 * button, the dashboard banner, or on its own once per session while
 * something is unread. Admin and Instructor can post from it.
 *
 * Development builds only for now — see `services/announcements.js`.
 */

const PRIORITY_BADGE = {
  [ANNOUNCEMENT_PRIORITY.IMPORTANT]:
    'bg-orange-500/12 text-orange-700 dark:text-orange-300',
  [ANNOUNCEMENT_PRIORITY.URGENT]: 'bg-red-500/12 text-red-700 dark:text-red-300',
}

const AUTO_OPEN_KEY = 'stms.notification-center-shown'
const MAX_RECENT = 10

const usePhone = () => useMediaQuery('(max-width: 639px)')

const SectionLabel = ({ children }) => (
  <h3 className="subtle mb-2 text-[10px] font-bold uppercase tracking-[0.14em]">{children}</h3>
)

function IconWell({ icon: Icon, tone = 'info' }) {
  return (
    <span
      className={cx(
        'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
        tone === 'info' ? 'bg-blue-500/12' : 'bg-amberline-500/12',
      )}
    >
      <Icon
        className={cx(
          'h-5 w-5',
          tone === 'info'
            ? 'text-blue-600 dark:text-blue-400'
            : 'text-amberline-600 dark:text-amberline-400',
        )}
      />
    </span>
  )
}

function AnnouncementItem({ announcement, read, onMarkRead }) {
  const priorityClass = PRIORITY_BADGE[announcement.priority]
  return (
    <li className={cx('tile p-3.5', read && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <IconWell icon={Megaphone} tone="accent" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {!read && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-label="Unread" />
            )}
            <p className="min-w-0 text-sm font-bold">{announcement.title}</p>
            {priorityClass && <Badge className={priorityClass}>{announcement.priority}</Badge>}
          </div>
          <p className="muted mt-0.5 whitespace-pre-line text-xs leading-relaxed">
            {announcement.message}
          </p>
          <p className="subtle mt-1 text-[11px]">
            {timeAgo(announcement.createdAt)} · {announcement.authorName}
          </p>
        </div>
      </div>
      {!read && (
        <div className="mt-2.5 flex justify-end">
          <button type="button" onClick={onMarkRead} className="btn btn-ghost btn-sm">
            <Check className="h-3.5 w-3.5" />
            Mark as read
          </button>
        </div>
      )}
    </li>
  )
}

/** The list itself, shared by the desktop panel and the phone sheet. */
function CenterContent({ state }) {
  const { published, readIds, markRead } = state
  const recent = published.slice(0, MAX_RECENT)

  return (
    <div className="space-y-4">
      <section>
        <SectionLabel>Announcements</SectionLabel>
        {recent.length ? (
          <ul className="space-y-2">
            {recent.map((row) => (
              <AnnouncementItem
                key={row.id}
                announcement={row}
                read={readIds.includes(row.id)}
                onMarkRead={() => markRead(row.id)}
              />
            ))}
          </ul>
        ) : (
          <p className="muted text-xs">No announcements yet.</p>
        )}
      </section>
    </div>
  )
}

export default function NotificationCenter() {
  const { isAuthenticated, can } = useApp()
  const isPhone = usePhone()
  const state = useAnnouncements()
  const [open, setOpen] = useState(false)
  // Admin and Instructor post from here as well as from Settings.
  const canPost = can(PERM.ANNOUNCEMENT_MANAGE)
  const [editing, setEditing] = useState(null)

  useEffect(() => onOpenNotificationCenter(() => setOpen((v) => !v)), [])

  // Escape closes the desktop panel; the phone sheet handles its own.
  useEffect(() => {
    if (!open || isPhone) return
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, isPhone])

  // Once per session, on a desktop, while something is unread. A phone gets the
  // dashboard banner instead, so nothing covers the page there.
  useEffect(() => {
    if (!isAuthenticated || isPhone || !state.unreadCount) return
    try {
      if (sessionStorage.getItem(AUTO_OPEN_KEY)) return
      sessionStorage.setItem(AUTO_OPEN_KEY, '1')
    } catch {
      return
    }
    setOpen(true)
  }, [isAuthenticated, isPhone, state.unreadCount])

  if (!ANNOUNCEMENTS_PREVIEW || !isAuthenticated) return null

  const close = () => setOpen(false)
  const description = state.unreadCount
    ? `${state.unreadCount} unread`
    : 'You’re all caught up'

  const newButton = canPost && (
    <button
      type="button"
      onClick={() => setEditing({ id: null })}
      className="btn btn-primary btn-sm w-full"
    >
      <Plus className="h-3.5 w-3.5" />
      New announcement
    </button>
  )
  const editor = <AnnouncementEditor editing={editing} onClose={() => setEditing(null)} />

  if (isPhone) {
    return (
      <>
        <Modal
          open={open && !editing}
          onClose={close}
          title="Announcements"
          description={description}
          centered
        >
          {newButton && <div className="mb-4">{newButton}</div>}
          <CenterContent state={state} />
        </Modal>
        {editor}
      </>
    )
  }

  return (
    <>
      {open && (
        <div
          className="fixed right-4 top-[4.75rem] z-40 w-[min(24rem,calc(100vw-2rem))]"
          role="region"
          aria-label="Announcements"
        >
          <div className="card flex max-h-[min(36rem,calc(100dvh-6rem))] flex-col overflow-hidden shadow-panel animate-slide-up">
            <header className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold">Announcements</h2>
                <p className="muted mt-0.5 text-xs" aria-live="polite">{description}</p>
              </div>
              <button
                type="button"
                onClick={close}
                className="btn btn-ghost btn-icon -mr-1 shrink-0"
                aria-label="Close announcements"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
              {newButton && <div className="mb-4">{newButton}</div>}
              <CenterContent state={state} />
            </div>
          </div>
        </div>
      )}
      {editor}
    </>
  )
}

/** Header control that opens the centre, with the unread count. */
export function NotificationCenterButton({ className }) {
  const { unreadCount } = useAnnouncements()
  if (!ANNOUNCEMENTS_PREVIEW) return null
  return (
    <button
      type="button"
      onClick={openNotificationCenter}
      aria-label={`Announcements${unreadCount ? `, ${unreadCount} unread` : ''}`}
      title="Announcements"
      className={cx(
        'relative grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors',
        'hover:bg-black/5 dark:hover:bg-white/5',
        className,
      )}
    >
      <Megaphone className="h-5 w-5" />
      {unreadCount > 0 && (
        <span
          className="absolute right-1.5 top-1.5 grid h-3.5 min-w-[14px] place-items-center
                     rounded-full bg-red-500 px-1 text-[9px] font-bold text-white"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  )
}

/**
 * The phone's dashboard banner: a one-line summary of what is unread that
 * opens the sheet. Nothing is shown once everything is read.
 */
export function NotificationBanner() {
  const { unread, unreadCount } = useAnnouncements()
  if (!ANNOUNCEMENTS_PREVIEW || !unreadCount) return null

  const summary = unread[0]?.title

  return (
    <div className="card mb-4 flex items-center gap-3 p-3.5 animate-slide-up" role="status">
      <IconWell icon={Megaphone} tone="accent" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">
          {unreadCount} new announcement{unreadCount === 1 ? '' : 's'}
        </p>
        <p className="muted mt-0.5 truncate text-xs">{summary}</p>
      </div>
      <button type="button" onClick={openNotificationCenter} className="btn btn-primary btn-sm shrink-0">
        View
      </button>
    </div>
  )
}
