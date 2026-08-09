import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCheck,
  Clock,
  HardHat,
  Info,
  ShieldAlert,
  Trash2,
  Undo2,
} from 'lucide-react'
import {
  ConfirmDialog,
  EmptyState,
  PageHeader,
  SectionCard,
  SkeletonRows,
} from '../components/ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useNotifications } from '../hooks'
import * as notificationService from '../services/notifications'
import { NOTIF_TYPE } from '../utils/constants'
import { PERM } from '../utils/permissions'
import { cx } from '../utils/helpers'
import { formatDateTime, timeAgo } from '../utils/dates'

const TYPE_STYLES = {
  [NOTIF_TYPE.OVERDUE]: {
    icon: AlertTriangle,
    label: 'Overdue',
    chip: 'bg-red-500/12 text-red-600 dark:text-red-400',
    accent: 'bg-red-500',
  },
  [NOTIF_TYPE.DUE_SOON]: {
    icon: Clock,
    label: 'Due soon',
    chip: 'bg-orange-500/12 text-orange-600 dark:text-orange-400',
    accent: 'bg-orange-500',
  },
  [NOTIF_TYPE.RETURNED]: {
    icon: Undo2,
    label: 'Returned',
    chip: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    accent: 'bg-emerald-500',
  },
  [NOTIF_TYPE.BORROWED]: {
    icon: Bell,
    label: 'Borrowed',
    chip: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
    accent: 'bg-blue-500',
  },
  [NOTIF_TYPE.DAMAGED]: {
    icon: ShieldAlert,
    label: 'Damaged',
    chip: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
    accent: 'bg-rose-500',
  },
  [NOTIF_TYPE.MAINTENANCE]: {
    icon: HardHat,
    label: 'Maintenance',
    chip: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
    accent: 'bg-violet-500',
  },
  [NOTIF_TYPE.SYSTEM]: {
    icon: Info,
    label: 'System',
    chip: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
    accent: 'bg-slate-400',
  },
}

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: NOTIF_TYPE.OVERDUE, label: 'Overdue' },
  { value: NOTIF_TYPE.DUE_SOON, label: 'Due soon' },
  { value: NOTIF_TYPE.RETURNED, label: 'Returns' },
  { value: NOTIF_TYPE.DAMAGED, label: 'Damage' },
  { value: NOTIF_TYPE.MAINTENANCE, label: 'Maintenance' },
]

export default function NotificationsPage() {
  const { can } = useApp()
  const toast = useToast()
  const { notifications, unread, loading } = useNotifications()

  const [filter, setFilter] = useState('all')
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  const filtered = useMemo(() => {
    if (filter === 'all') return notifications
    if (filter === 'unread') return notifications.filter((n) => !n.read)
    return notifications.filter((n) => n.type === filter)
  }, [notifications, filter])

  const counts = useMemo(() => {
    const map = { all: notifications.length, unread }
    for (const n of notifications) map[n.type] = (map[n.type] ?? 0) + 1
    return map
  }, [notifications, unread])

  const markAllRead = async () => {
    const ids = notifications.filter((n) => !n.read).map((n) => n.id)
    if (!ids.length) return
    setBusy(true)
    try {
      await notificationService.markAllRead(ids)
      toast.success(`${ids.length} notification${ids.length === 1 ? '' : 's'} marked as read.`)
    } catch (err) {
      toast.error(err.message ?? 'Unable to update the notifications.')
    } finally {
      setBusy(false)
    }
  }

  const toggleRead = async (notification) => {
    try {
      await notificationService.markRead(notification.id, !notification.read)
    } catch (err) {
      toast.error(err.message ?? 'Unable to update the notification.')
    }
  }

  const removeOne = async (notification) => {
    try {
      await notificationService.remove(notification.id)
      toast.success('Notification deleted.')
    } catch (err) {
      toast.error(err.message ?? 'Unable to delete the notification.')
    }
  }

  const requestClearAll = () =>
    setConfirm({
      title: 'Clear all notifications?',
      message: `All ${notifications.length} notifications will be permanently removed. Tool and transaction records are not affected.`,
      confirmLabel: 'Clear all',
      onConfirm: async () => {
        setBusy(true)
        try {
          await notificationService.clearAll()
          toast.success('Notification centre cleared.')
          setConfirm(null)
        } catch (err) {
          toast.error(err.message ?? 'Unable to clear the notifications.')
        } finally {
          setBusy(false)
        }
      },
    })

  return (
    <>
      <PageHeader
        title="Notifications"
        description={
          unread
            ? `${unread} unread alert${unread === 1 ? '' : 's'} from the laboratory.`
            : 'You are up to date with the laboratory.'
        }
        icon={Bell}
      >
        <button
          type="button"
          onClick={markAllRead}
          className="btn btn-outline"
          disabled={!unread || busy}
        >
          <CheckCheck className="h-4 w-4" />
          <span className="hidden sm:inline">Mark all read</span>
        </button>
        {can(PERM.DATA_MANAGE) && (
          <button
            type="button"
            onClick={requestClearAll}
            className="btn btn-outline"
            disabled={!notifications.length || busy}
          >
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline">Clear all</span>
          </button>
        )}
      </PageHeader>

      {/* -------------------------------- filters -------------------------------- */}
      <div className="no-scrollbar -mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map((option) => {
          const active = filter === option.value
          const count = counts[option.value] ?? 0
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={cx(
                'btn btn-sm shrink-0',
                active ? 'btn-dark' : 'btn-outline',
              )}
              aria-pressed={active}
            >
              {option.label}
              {count > 0 && (
                <span
                  className={cx(
                    'mono ml-0.5 rounded px-1 text-[10px] font-bold',
                    active ? 'bg-white/15' : 'bg-black/5 dark:bg-white/10',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* --------------------------------- list --------------------------------- */}
      <SectionCard bodyClassName="p-0">
        {loading && !notifications.length ? (
          <SkeletonRows rows={5} columns={2} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title={
              filter === 'unread' ? 'No unread notifications.' : 'No notifications to show.'
            }
            description={
              filter === 'all'
                ? 'Overdue tools, returns and maintenance alerts will appear here.'
                : 'Nothing matches this filter right now.'
            }
          />
        ) : (
          <ul className="divide-y">
            {filtered.map((notification) => {
              const style = TYPE_STYLES[notification.type] ?? TYPE_STYLES[NOTIF_TYPE.SYSTEM]
              const Icon = style.icon
              return (
                <li
                  key={notification.id}
                  className={cx(
                    'relative flex items-start gap-3 px-4 py-3.5 transition-colors',
                    !notification.read && 'bg-amberline-400/[0.06]',
                  )}
                >
                  {!notification.read && (
                    <span className={cx('absolute inset-y-0 left-0 w-1', style.accent)} />
                  )}

                  <span
                    className={cx(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                      style.chip,
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p
                        className={cx(
                          'text-sm leading-tight',
                          notification.read ? 'font-semibold' : 'font-extrabold',
                        )}
                      >
                        {notification.title}
                      </p>
                      {!notification.read && (
                        <span className="h-1.5 w-1.5 rounded-full bg-amberline-500" />
                      )}
                    </div>
                    <p className="muted mt-0.5 text-sm leading-snug">{notification.message}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px]">
                      <span className="subtle" title={formatDateTime(notification.createdAt)}>
                        {timeAgo(notification.createdAt)}
                      </span>
                      {notification.link && (
                        <>
                          <span className="subtle">·</span>
                          <Link
                            to={notification.link}
                            className="font-bold text-amberline-700 hover:underline dark:text-amberline-400"
                          >
                            View tool
                          </Link>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => toggleRead(notification)}
                      className="btn btn-ghost btn-icon"
                      aria-label={notification.read ? 'Mark as unread' : 'Mark as read'}
                      title={notification.read ? 'Mark as unread' : 'Mark as read'}
                    >
                      {notification.read ? (
                        <Bell className="h-4 w-4" />
                      ) : (
                        <CheckCheck className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeOne(notification)}
                      className="btn btn-ghost btn-icon text-red-600 dark:text-red-400"
                      aria-label="Delete notification"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm?.onConfirm?.()}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        loading={busy}
      />
    </>
  )
}
