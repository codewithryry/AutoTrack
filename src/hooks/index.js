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
import { PERM, can } from '../utils/permissions'
import { visibleTransactions } from '../utils/permissions'

export { useAsyncData }

/* --------------------------- domain data --------------------------- */

export function useTools() {
  const { data, loading, error, reload } = useAsyncData(() => toolService.listAll(), [], {
    initial: [],
  })
  return { tools: data ?? [], loading, error, reload }
}

export function useTool(id) {
  const { data, loading, error, reload } = useAsyncData(
    () => (id ? toolService.getById(id) : Promise.resolve(null)),
    [id],
  )
  return { tool: data, loading, error, reload }
}

export function useUsers() {
  const { data, loading, error, reload } = useAsyncData(() => userService.listAll(), [], {
    initial: [],
  })
  return { users: data ?? [], loading, error, reload }
}

/** Transactions filtered to what the signed-in role is allowed to see. */
export function useTransactions() {
  const { user } = useApp()
  const { data, loading, error, reload } = useAsyncData(() => txnService.listAll(), [], {
    initial: [],
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
    { initial: [] },
  )
  return { transactions: data ?? [], loading, error, reload }
}

export function useToolActivity(toolId) {
  const { data, loading, error, reload } = useAsyncData(
    () => (toolId ? activityService.listForTool(toolId) : Promise.resolve([])),
    [toolId],
    { initial: [] },
  )
  return { entries: data ?? [], loading, error, reload }
}

export function useActivity(limit = 12) {
  const { data, loading, error, reload } = useAsyncData(
    () => activityService.listRecent(limit),
    [limit],
    { initial: [] },
  )
  return { entries: data ?? [], loading, error, reload }
}

export function useNotifications() {
  const { user } = useApp()
  const seeAll = can(user, PERM.TXN_VIEW_ALL)
  const { data, loading, error, reload } = useAsyncData(
    () => notificationService.listFor(user, { seeAll }),
    [user?.id, seeAll],
    { initial: [] },
  )
  const notifications = data ?? []
  const unread = notifications.filter((n) => !n.read).length
  return { notifications, unread, loading, error, reload }
}

export function useMaintenance() {
  const { data, loading, error, reload } = useAsyncData(() => maintenanceService.listAll(), [], {
    initial: [],
  })
  return { records: data ?? [], loading, error, reload }
}

export function useToolMaintenance(toolId) {
  const { data, loading, error, reload } = useAsyncData(
    () => (toolId ? maintenanceService.listForTool(toolId) : Promise.resolve([])),
    [toolId],
    { initial: [] },
  )
  return { records: data ?? [], loading, error, reload }
}

export function useUpcomingMaintenance(withinDays = 30) {
  const { data, loading, reload } = useAsyncData(
    () => maintenanceService.upcoming(withinDays),
    [withinDays],
    { initial: [] },
  )
  return { upcoming: data ?? [], loading, reload }
}

export function useDashboard() {
  const { settings } = useApp()
  const { data, loading, error, reload } = useAsyncData(
    async () => {
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
      return { stats, recent, mostBorrowed, activeUsers, overdue, activity, upcoming }
    },
    [settings.dueSoonThresholdDays],
  )
  return { dashboard: data, loading, error, reload }
}

export function useReport(range) {
  const { data, loading, error, reload } = useAsyncData(
    () => reportService.fullReport(range),
    [range?.from, range?.to],
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
