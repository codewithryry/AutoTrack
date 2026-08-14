import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAsyncData } from './useAsyncData'
import * as toolService from '../services/tools'
import * as txnService from '../services/transactions'
import * as userService from '../services/users'
import * as notificationService from '../services/notifications'
import * as maintenanceService from '../services/maintenance'
import * as activityService from '../services/activity'
import * as reportService from '../services/reports'
import { useApp } from '../context/AppContext'
import { PERM, can, isAdmin, isStaff, visibleTransactions } from '../utils/permissions'

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
  return { tools: data ?? [], loading, error, reload }
}

export function useTool(id) {
  const { data, loading, error, reload } = useAsyncData(
    () => (id ? toolService.getById(id) : Promise.resolve(null)),
    [id],
    { cacheKey: id ? `tool:${id}` : null },
  )
  return { tool: data, loading, error, reload }
}

/** The user directory. Empty for a student, who may only read their own profile. */
export function useUsers() {
  const { user } = useApp()
  const allowed = can(user, PERM.USER_VIEW)
  const { data, loading, error, reload } = useAsyncData(
    () => (allowed ? userService.listAll() : Promise.resolve([])),
    [allowed],
    { initial: [], cacheKey: 'users' },
  )
  return { users: data ?? [], loading, error, reload, allowed }
}

/** Transactions filtered to what the signed-in role is allowed to see. */
export function useTransactions() {
  const { user } = useApp()
  const { data, loading, error, reload } = useAsyncData(() => txnService.listAll(), [], {
    initial: [],
    cacheKey: 'transactions',
  })
  const transactions = useMemo(
    () => visibleTransactions(user, data ?? []),
    [user, data],
  )
  return { transactions, loading, error, reload }
}

export function useToolTransactions(toolId) {
  const { data, loading, error, reload } = useAsyncData(
    () => (toolId ? txnService.listForTool(toolId) : Promise.resolve([])),
    [toolId],
    { initial: [], cacheKey: toolId ? `tool-transactions:${toolId}` : null },
  )
  return { transactions: data ?? [], loading, error, reload }
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
  const seeAll = isAdmin(user)
  const { data, loading, error, reload } = useAsyncData(
    () => notificationService.listFor(user, { seeAll }),
    [user?.id, seeAll],
    { initial: [], cacheKey: 'notifications' },
  )
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
