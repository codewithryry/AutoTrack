import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAsyncData } from './useAsyncData'
import * as toolService from '../services/tools'
import * as txnService from '../services/transactions'
import * as userService from '../services/users'
import * as notificationService from '../services/notifications'
import * as maintenanceService from '../services/maintenance'
import * as activityService from '../services/activity'
import * as reportService from '../services/reports'
import * as requestService from '../services/requests'
import * as reservationService from '../services/reservations'
import * as messageService from '../services/messages'
import * as presenceService from '../services/presence'
import * as db from '../services/db'
import { useApp } from '../context/AppContext'
import { PERM, can, isStaff, visibleTransactions } from '../utils/permissions'

export { useAsyncData }

/**
 * Data hooks.
 *
 * Each one wraps a service call in `useAsyncData`, which re-runs whenever the
 * app's revision counter ticks. Change notifications from the data layer
 * drive that counter, so these hooks are effectively live: a borrow anywhere —
 * including in another tab or on another machine — refreshes them without any
 * manual reload.
 *
 * Hooks whose data a role cannot read do not fire a request at all; they resolve
 * empty, which keeps the console free of permission errors the user can do
 * nothing about.
 */

/* --------------------------- domain data --------------------------- */

export function useTools() {
  const { data, loading, error, reload } = useAsyncData(() => toolService.listAll(), [], {
    initial: [],
    cacheKey: 'tools',
  })
  useLiveCollection(db.COLLECTIONS.tools)
  return { tools: data ?? [], loading, error, reload }
}

export function useTool(id) {
  const { data, loading, error, reload } = useAsyncData(
    () => (id ? toolService.getById(id) : Promise.resolve(null)),
    [id],
    { cacheKey: id ? `tool:${id}` : null },
  )
  useLiveCollection(db.COLLECTIONS.tools)
  return { tool: data, loading, error, reload }
}

/**
 * The user directory.
 *
 * Staff read all of it; a student reads their own profile and the crib's —
 * enough to start a conversation with an instructor or an administrator, and
 * no more. The scoping in `db.js` and the policies decide that, not this hook.
 * `allowed` still reports the management permission, which is what the user
 * directory page is gated on.
 */
export function useUsers() {
  const { user } = useApp()
  const allowed = can(user, PERM.USER_VIEW)
  const { data, loading, error, reload } = useAsyncData(() => userService.listAll(), [], {
    initial: [],
    cacheKey: 'users',
  })
  useLiveCollection(db.COLLECTIONS.users)
  return { users: data ?? [], loading, error, reload, allowed }
}

/** Transactions filtered to what the signed-in role is allowed to see. */
export function useTransactions() {
  const { user } = useApp()
  const { data, loading, error, reload } = useAsyncData(() => txnService.listAll(), [], {
    initial: [],
    cacheKey: 'transactions',
  })
  useLiveCollection(db.COLLECTIONS.transactions)
  const transactions = useMemo(
    () => visibleTransactions(user, data ?? []),
    [user, data],
  )
  return { transactions, loading, error, reload }
}

/**
 * One tool's loans, filtered to what the signed-in role may see.
 *
 * The read is already scoped twice over — the policies return a student only
 * their own rows, and the data layer sends the same `user_id` filter — so this
 * is the same belt-and-braces `useTransactions` applies: it keeps a list honest
 * that a stale or mixed cache could otherwise widen, and it means a student's
 * borrowing history on a tool page can never name another borrower.
 */
export function useToolTransactions(toolId) {
  const { user } = useApp()
  const { data, loading, error, reload } = useAsyncData(
    () => (toolId ? txnService.listForTool(toolId) : Promise.resolve([])),
    [toolId],
    { initial: [], cacheKey: toolId ? `tool-transactions:${toolId}` : null },
  )
  useLiveCollection(db.COLLECTIONS.transactions)
  const transactions = useMemo(() => visibleTransactions(user, data ?? []), [user, data])
  return { transactions, loading, error, reload }
}

/** The tool timeline. Only staff may read the activity log. */
export function useToolActivity(toolId) {
  const { user } = useApp()
  const allowed = isStaff(user)
  const { data, loading, error, reload } = useAsyncData(
    () => (toolId && allowed ? activityService.listForTool(toolId) : Promise.resolve([])),
    [toolId, allowed],
    { initial: [], cacheKey: toolId ? `tool-activity:${toolId}` : null },
  )
  return { entries: data ?? [], loading, error, reload, allowed }
}

export function useActivity(limit = 12) {
  const { user } = useApp()
  const allowed = isStaff(user)
  const { data, loading, error, reload } = useAsyncData(
    () => (allowed ? activityService.listRecent(limit) : Promise.resolve([])),
    [limit, allowed],
    { initial: [], cacheKey: `activity:${limit}` },
  )
  return { entries: data ?? [], loading, error, reload, allowed }
}

export function useNotifications() {
  const { user } = useApp()
  // The whole-inbox view is an administrator's: an instructor's stream is the
  // laboratory-wide operational alerts plus anything addressed to them, which is
  // what `listFor` returns without the flag. Badge, counts and read state are
  // computed over that list exactly as before.
  //
  // An administrator's centre is now the same shape: the laboratory-wide
  // operational stream plus anything addressed to them. Reading every student's
  // personal copy alongside the broadcast about the very same handover is what
  // put each borrow and each return in the list twice. Nothing is hidden that
  // concerns them, and the records themselves are on Transactions.
  const seeAll = false
  const { data, loading, error, reload } = useAsyncData(
    () => notificationService.listFor(user, { seeAll }),
    [user?.id, seeAll],
    { initial: [], cacheKey: 'notifications' },
  )
  useLiveCollection(db.COLLECTIONS.notifications)
  const notifications = data ?? []
  const unread = notifications.filter((n) => !n.read).length
  return { notifications, unread, loading, error, reload }
}

export function useMaintenance() {
  const { user } = useApp()
  const allowed = can(user, PERM.MAINTENANCE_VIEW)
  const { data, loading, error, reload } = useAsyncData(
    () => (allowed ? maintenanceService.listAll() : Promise.resolve([])),
    [allowed],
    { initial: [], cacheKey: 'maintenance' },
  )
  useLiveCollection(allowed ? db.COLLECTIONS.maintenance : null)
  return { records: data ?? [], loading, error, reload, allowed }
}

export function useToolMaintenance(toolId) {
  const { user } = useApp()
  const allowed = can(user, PERM.MAINTENANCE_VIEW)
  const { data, loading, error, reload } = useAsyncData(
    () => (toolId && allowed ? maintenanceService.listForTool(toolId) : Promise.resolve([])),
    [toolId, allowed],
    { initial: [], cacheKey: toolId ? `tool-maintenance:${toolId}` : null },
  )
  return { records: data ?? [], loading, error, reload, allowed }
}

export function useUpcomingMaintenance(withinDays = 30) {
  const { data, loading, reload } = useAsyncData(
    () => maintenanceService.upcoming(withinDays),
    [withinDays],
    { initial: [], cacheKey: `upcoming-maintenance:${withinDays}` },
  )
  return { upcoming: data ?? [], loading, reload }
}

/**
 * Dashboard data for the signed-in role.
 *
 * Staff get the laboratory-wide picture; a student gets their own loans and the
 * available-tool count. Both are computed from the stored records — nothing on the
 * dashboard is hardcoded.
 */
export function useDashboard() {
  const { settings, user } = useApp()
  const staff = isStaff(user)
  const uid = user?.id ?? null

  const { data, loading, error, reload } = useAsyncData(
    async () => {
      if (!uid) return null

      if (!staff) {
        const student = await reportService.studentDashboard(uid, {
          dueSoonThresholdDays: settings.dueSoonThresholdDays,
        })
        return { scope: 'student', student }
      }

      const [stats, recent, mostBorrowed, activeUsers, overdue, activity, upcoming] =
        await Promise.all([
          reportService.dashboardStats({
            dueSoonThresholdDays: settings.dueSoonThresholdDays,
          }),
          reportService.recentTransactions(6),
          reportService.mostBorrowedTools(5),
          reportService.mostActiveUsers(5),
          reportService.overdueSummary(),
          activityService.listRecent(8),
          maintenanceService.upcoming(30),
        ])
      return {
        scope: 'staff',
        stats,
        recent,
        mostBorrowed,
        activeUsers,
        overdue,
        activity,
        upcoming,
      }
    },
    [settings.dueSoonThresholdDays, staff, uid],
    { cacheKey: uid ? `dashboard:${uid}` : null },
  )
  // The dashboard is a reading of three collections, so it follows all three:
  // a borrow, a return or a tool going out of service anywhere re-computes it
  // in place, with the page and its scroll left where they are.
  useLiveCollection(db.COLLECTIONS.transactions)
  useLiveCollection(db.COLLECTIONS.tools)
  useLiveCollection(db.COLLECTIONS.toolRequests)
  return { dashboard: data, loading, error, reload }
}

export function useReport(range) {
  const { data, loading, error, reload } = useAsyncData(
    () => reportService.fullReport(range),
    [range?.from, range?.to],
    { cacheKey: `report:${range?.from ?? ''}:${range?.to ?? ''}` },
  )
  return { report: data, loading, error, reload }
}

/* --------------------------- UI helpers --------------------------- */

/** Debounced value — used to keep search inputs snappy on large tables. */
export function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const listener = (event) => setMatches(event.matches)
    setMatches(media.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [query])
  return matches
}

export const useIsMobile = () => useMediaQuery('(max-width: 767px)')

/** Simple open/close state with stable callbacks. */
export function useDisclosure(initial = false) {
  const [isOpen, setIsOpen] = useState(initial)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((v) => !v), [])
  return { isOpen, open, close, toggle, setIsOpen }
}

/** Persist a small preference (list filters, view mode) across reloads. */
export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored ? JSON.parse(stored) : initialValue
    } catch {
      return initialValue
    }
  })

  const update = useCallback(
    (next) => {
      setValue((current) => {
        const resolved = typeof next === 'function' ? next(current) : next
        try {
          localStorage.setItem(key, JSON.stringify(resolved))
        } catch {
          /* storage unavailable — keep it in memory only */
        }
        return resolved
      })
    },
    [key],
  )

  return [value, update]
}

/* ------------------------------------------------------------------ *
 * Requests, reservations and messaging
 *
 * The same `useAsyncData` shape as everything above, with one addition: the
 * tables behind a conversation are subscribed to, because a message someone
 * else sends has no local write to raise the usual change signal. The
 * subscription only re-emits that signal — the data still arrives through the
 * ordinary read, so the cache, the offline path and the policies all apply
 * exactly as they do everywhere else.
 * ------------------------------------------------------------------ */

/** Tool requests, filtered to what the signed-in role may see. */
export function useRequests() {
  const { user } = useApp()
  const { data, loading, error, reload } = useAsyncData(() => requestService.listAll(), [], {
    initial: [],
    cacheKey: 'tool-requests',
  })
  useLiveCollection(db.COLLECTIONS.toolRequests)
  const requests = useMemo(
    () => requestService.visibleRequests(user, data ?? []),
    [user, data],
  )
  return { requests, loading, error, reload }
}

export function useRequest(id) {
  const { data, loading, error, reload } = useAsyncData(
    () => (id ? requestService.getById(id) : Promise.resolve(null)),
    [id],
    { cacheKey: id ? `tool-request:${id}` : null },
  )
  useLiveCollection(db.COLLECTIONS.toolRequests)
  return { request: data, loading, error, reload }
}

/** Reservations, filtered the same way. */
export function useReservations() {
  const { user } = useApp()
  const { data, loading, error, reload } = useAsyncData(
    () => reservationService.listAll(),
    [],
    { initial: [], cacheKey: 'reservations' },
  )
  useLiveCollection(db.COLLECTIONS.reservations)
  const reservations = useMemo(
    () => reservationService.visibleReservations(user, data ?? []),
    [user, data],
  )
  return { reservations, loading, error, reload }
}

/**
 * The inbox read, shared between the hooks that ask for it at the same moment.
 *
 * The shell's message badge and the dashboard both mount `useInbox`, and the
 * read behind it is the heaviest in the app — every thread, participant and
 * message the account may see. Two mounts in the same frame now wait on one
 * request instead of making the same one twice. The promise is released as soon
 * as it settles, so a reload after a write is always a fresh read.
 */
let inboxRead = { key: null, promise: null }

function readInbox(user) {
  const key = user?.id ?? null
  if (inboxRead.key === key && inboxRead.promise) return inboxRead.promise
  const promise = messageService.inboxFor(user).finally(() => {
    if (inboxRead.promise === promise) inboxRead = { key: null, promise: null }
  })
  inboxRead = { key, promise }
  return promise
}

/** The threads this account is in, each with its unread count. */
export function useInbox() {
  const { user } = useApp()
  const { data, loading, error, reload, setData } = useAsyncData(
    () => readInbox(user),
    [user?.id],
    { initial: [], cacheKey: user?.id ? `inbox:${user.id}` : null },
  )
  useLiveCollection(db.COLLECTIONS.messages)
  useLiveCollection(db.COLLECTIONS.conversations)
  const conversations = data ?? []
  const unread = conversations.reduce((total, row) => total + (row.unread ?? 0), 0)
  // `setData` is exposed so a thread deleted on this page leaves the list on the
  // same frame, rather than on the re-read the write raises behind it.
  return { conversations, unread, loading, error, reload, setData }
}

/**
 * One thread: its messages, the people in it, and marking it read.
 *
 * Reading is a side effect of having the thread open, so it is stamped when the
 * messages settle rather than on a button.
 */
export function useConversation(conversationId) {
  const { user } = useApp()

  const { data, loading, error, reload } = useAsyncData(
    () =>
      conversationId
        ? Promise.all([
            messageService.getConversation(conversationId),
            messageService.listMessages(conversationId),
            messageService.participantsOf(conversationId),
          ]).then(([conversation, messages, participants]) => ({
            conversation,
            messages,
            participants,
          }))
        : Promise.resolve(null),
    [conversationId],
    { cacheKey: conversationId ? `conversation:${conversationId}` : null },
  )

  // Only this thread's rows, so an unrelated message elsewhere does not make
  // an open conversation re-read.
  useLiveCollection(db.COLLECTIONS.messages, {
    column: 'conversation_id',
    value: conversationId,
  })

  const messages = data?.messages ?? []

  useEffect(() => {
    if (!conversationId || !user?.id || !messages.length) return
    void messageService.markRead(conversationId, user)
  }, [conversationId, user, messages.length])

  return {
    conversation: data?.conversation ?? null,
    messages,
    participants: data?.participants ?? [],
    loading,
    error,
    reload,
  }
}

/**
 * Subscribe a collection to changes made by anyone.
 *
 * The subscription raises the data layer's own change signal, which is what
 * every `useAsyncData` already listens to — so this hook returns nothing and
 * simply keeps the screens above it honest.
 */
export function useLiveCollection(collection, filter) {
  const { isAuthenticated } = useApp()
  const column = filter?.column
  const value = filter?.value

  useEffect(() => {
    if (!isAuthenticated || !collection) return
    if (column && !value) return
    return db.watchCollection(
      collection,
      undefined,
      column ? { column, value } : undefined,
    )
  }, [isAuthenticated, collection, column, value])
}

/**
 * Who is online right now.
 *
 * Presence is a property of the connection, so this joins while the hook is
 * mounted and leaves when it unmounts.
 */
export function usePresence() {
  const { user } = useApp()
  const [online, setOnline] = useState([])

  // Keyed on the identity's fields rather than the object: the context hands
  // back a new `user` on every refresh, and rejoining the channel each time
  // would make presence flicker between "here" and "gone".
  const { id, fullName, role } = user ?? {}
  useEffect(() => {
    if (!id) {
      setOnline([])
      return
    }
    return presenceService.join({ id, fullName, role }, setOnline)
  }, [id, fullName, role])

  return { online, isOnline: (other) => presenceService.isOnline(other, { online }) }
}
