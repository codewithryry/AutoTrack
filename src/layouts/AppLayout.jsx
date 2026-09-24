import { createContext, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  CircleUserRound,
  ChevronDown,
  LogOut,
  Menu,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react'
import { AppearanceToggleButton } from '../components/AccountSettings'
import ErrorBoundary from '../components/ErrorBoundary'
import Avatar from '../components/Avatar'
import TobiChat from '../components/TobiChat'
import { PageLoading } from '../components/ui'

import {
  ACCOUNT_NAV,
  accountNavLabel,
  assistantContextFor,
  EXTRA_PAGES,
  forRole,
  hasNestedNavMatch,
  INSTRUCTOR_EXTRA_PAGES,
  INSTRUCTOR_QUICK_ACTIONS,
  instructorRailItems,
  mobileNavForRole,
  NAV_ITEMS,
  studentRailItems,
  visibleNavItems,
} from '../components/navigation'
import { useApp } from '../context/AppContext'
import { TOAST_VARIANTS, useToastFeed } from '../context/ToastContext'
import {
  useInbox,
  useNotifications,
  usePresence,
  useProblemReports,
  useRequests,
  useTransactions,
  useUsers,
} from '../hooks'
import { cx } from '../utils/helpers'
import * as txnService from '../services/transactions'
import { pendingAccounts } from '../services/users'
import {
  ACTIVE_TXN_STATUSES,
  APP_NAME,
  REQUEST_STATUS,
  ROLE,
} from '../utils/constants'
import { PERM } from '../utils/permissions'

/**
 * Application shell.
 *
 * Desktop gets a fixed dark rail plus a sticky top bar; mobile gets a slide-in
 * drawer (staff only — a student's bottom bar already carries every route they
 * may reach) and a floating glass bottom bar with Scan in its centre, and TOBI,
 * the assistant — or the open page's own "+" — in a named pill beside it.
 */
/**
 * A page that stands alone inside the shell.
 *
 * The restricted-area notice and the 404 are dead ends: there is nothing on them
 * to navigate from, so they take the whole viewport with no rail, no top bar and
 * no bottom bar. They ask for that themselves through this context rather than
 * the layout keeping a list of routes — the guard that renders the notice is not
 * a route at all.
 *
 * The chrome is dropped in a layout effect, before the browser paints, so the
 * bars never appear and disappear.
 */
const ShellChromeContext = createContext(null)

export function useStandalonePage() {
  const chrome = useContext(ShellChromeContext)
  useLayoutEffect(() => {
    chrome?.setBare(true)
    return () => chrome?.setBare(false)
  }, [chrome])
}

export default function AppLayout() {
  const { user, logout, can, online, settings } = useApp()
  const { unread } = useNotifications()
  // Messages are reached from the bar at every width and for every role: a
  // conversation is not a place laboratory work happens, so it stays out of the
  // bottom bar, and this is the one control that carries its unread count.
  const { unread: unreadMessages } = useInbox()
  // Requests carry a count too: staff see how many are waiting on a decision,
  // a student how many of their own are still open. `useRequests` already
  // returns only what the role may read, so one expression serves both.
  const { requests } = useRequests()
  // Open loans, for the half of the Requests queue that is returns waiting to
  // be confirmed. Scoped by role like every other read.
  const { transactions } = useTransactions()
  // The directory, for the Users badge below. Read through the same live hook
  // the Users page itself uses, so both share one cache entry and one
  // subscription — approving or rejecting an account ticks the revision counter
  // and the badge follows the page without anything extra here.
  const { users } = useUsers()
  // Reports still awaiting attention — `Scheduled` and untouched — for the
  // Report Problems sidebar badge. Empty for a student: `useProblemReports`
  // reads through `useMaintenance()`, which resolves empty for any role
  // without `MAINTENANCE_VIEW`.
  const { openCount: reportCount } = useProblemReports()
  // Presence is announced for as long as the app is open, not only while the
  // inbox is on screen — otherwise a signed-in account reads as offline to
  // everyone until it happens to be looking at its own messages. The channel is
  // shared, so the inbox's own `usePresence` joins the same one.
  usePresence()
  const location = useLocation()
  const navigate = useNavigate()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // TOBI's conversation sheet. The conversation itself outlives it — see
  // `TobiChat`, which keeps it for the browser session.
  const [tobiOpen, setTobiOpen] = useState(false)
  const closeTobi = useCallback(() => setTobiOpen(false), [])
  // The button TOBI was opened from, so its card grows out of that spot and
  // folds back into it.
  const tobiOrigin = useRef(null)
  const openTobi = (event) => {
    tobiOrigin.current = event?.currentTarget ?? null
    setTobiOpen(true)
  }
  // Anything outside the shell — the dashboard mascot's "Ask TOBI" — opens the
  // same card with a `tobi:open` event, growing out of the bar's TOBI button.
  useEffect(() => {
    const onOpen = () => {
      tobiOrigin.current = document.querySelector('.tobi-launcher')
      setTobiOpen(true)
    }
    window.addEventListener('tobi:open', onOpen)
    return () => window.removeEventListener('tobi:open', onOpen)
  }, [])
  const menuRef = useRef(null)

  const isStudent = user?.role === ROLE.STUDENT
  // The tool-crib role. Every branch keyed off this leaves the Admin and Student
  // shells on exactly the path they were on before.
  const isInstructor = user?.role === ROLE.INSTRUCTOR
  const isAdmin = user?.role === ROLE.ADMIN
  // Staff share one mobile shell: four destinations in the bar, the rest behind
  // the Menu slot's drawer. A student's bar still carries everything they have.
  const hasDrawer = isAdmin || isInstructor

  // The Requests count is a queue of decisions to make, so it is staff only:
  // a student raises the requests rather than answering them, and a badge on
  // their own asks would be a number with nothing to do about it.
  //
  // Both halves of that queue count: asks still to be decided, and tools a
  // borrower has handed in and is waiting to have received. Requests is the one
  // page either is answered on, so its badge is the sum.
  const requestCount = isStudent
    ? 0
    : requests.filter((request) => request.status === REQUEST_STATUS.PENDING).length +
      transactions.filter(
        (txn) => ACTIVE_TXN_STATUSES.includes(txn.status) && txnService.returnRequested(txn),
      ).length

  // The Users count is the accounts sitting at `Pending` — a self-registered
  // instructor waiting to be verified is the one that puts a number here — and
  // it is read with `pendingAccounts()`, the same helper the Users page and the
  // dashboard already count with, off the live directory. Administrator only:
  // approving an account is theirs to do, and a badge nobody else can act on is
  // a number with nothing behind it. Separate from `requestCount` above, which
  // is untouched.
  const userCount = isAdmin ? pendingAccounts(users).length : 0

  // One navigation definition, filtered by the authenticated user's stored
  // role — the sidebar, the drawer and the bottom bar all read from it.
  // Each item carries the name this role sees (a student's Dashboard is Home).
  const navItems = visibleNavItems(user?.role, can).map((item) => forRole(item, user?.role))
  const allowed = new Set(navItems.map((item) => item.to))
  // An instructor's rail is the same permitted set, reordered for the crib and
  // with the counter actions lifted into their own block; every other role gets
  // the list untouched.
  //
  // Notifications is dropped from the rail for every role: the bell in the top
  // bar is the route to it, carrying the same unread badge, and a second entry
  // in the list was one destination reached two ways. The nav item itself
  // stays — the route, its guard and the bar's page-title lookup all read
  // `NAV_ITEMS`, and the mobile bottom bar is built separately.
  const railItems = (
    isInstructor
      ? instructorRailItems(navItems)
      : isStudent
        ? studentRailItems(navItems)
        : navItems
  ).filter((item) => item.to !== '/notifications')
  const quickActions = isInstructor
    ? INSTRUCTOR_QUICK_ACTIONS.filter((a) => !a.permission || can(a.permission))
    : []
  // On the service log itself, an instructor's raised bottom-bar slot carries
  // that page's action rather than Scan — the existing scheduler, opened by the
  // same `?schedule=1` parameter the page already honours. Null everywhere else,
  // so the bar is back to normal the moment they navigate away.
  const scheduleSlot =
    isInstructor && location.pathname === '/maintenance' && can(PERM.MAINTENANCE_MANAGE)
      ? {
          to: '/maintenance?schedule=1',
          label: 'Schedule',
          ariaLabel: 'Schedule maintenance',
          icon: Plus,
        }
      : null

  // On the inbox the raised slot carries "New chat" rather than Scan — the
  // same compose dialog the list header used to open, reached through
  // `?new=1`, which is the parameter the page already honours. Null everywhere
  // else, so Scan is back the moment they leave.
  const messageSlot =
    location.pathname === '/messages' && can(PERM.MESSAGE_SEND)
      ? {
          to: '/messages?new=1',
          label: 'New chat',
          ariaLabel: 'Start a conversation',
          icon: Plus,
        }
      : null

  // On the requests list a student's raised slot carries "New request" rather
  // than Scan — the same `/requests/new` form the page's own button opens. Null
  // everywhere else, so Scan is back the moment they leave.
  const requestSlot =
    isStudent && location.pathname === '/requests' && can(PERM.REQUEST_CREATE)
      ? {
          to: '/requests/new',
          label: 'New request',
          ariaLabel: 'Raise a new request',
          icon: Plus,
        }
      : null

  // An administrator's raised slot is a contextual "+": on Tools, Users and
  // Maintenance it opens that page's own create form — the existing dialogs,
  // reached through the parameters those pages already honour. Everywhere else
  // there is nothing to add, so the button is rendered disabled.
  // `/tools` and everything under it — the tool page and its history — so the
  // bar does not change shape as an administrator moves between the inventory
  // and one tool's record. `/tools?new=1` is the parameter `ToolsPage` already
  // honours, so this opens the existing dialog rather than a second form.
  const onToolsRoute =
    location.pathname === '/tools' || location.pathname.startsWith('/tools/')

  const adminAddSlot = !isAdmin
    ? null
    : onToolsRoute && can(PERM.TOOL_CREATE)
      ? { to: '/tools?new=1', label: 'Add tool', ariaLabel: 'Add a tool' }
      : location.pathname === '/users' && can(PERM.USER_CREATE)
        ? { to: '/users?new=1', label: 'Add user', ariaLabel: 'Add a user' }
        : location.pathname === '/maintenance' && can(PERM.MAINTENANCE_MANAGE)
          ? { to: '/maintenance?schedule=1', label: 'Schedule', ariaLabel: 'Schedule maintenance' }
          : null

  // An open conversation takes the whole phone screen: the bar would sit over
  // the composer, and the thread has its own back control. The desktop is
  // unaffected — the bar is mobile-only.
  const onThread = location.pathname.startsWith('/messages/')
  // TOBI's full page is laid out the same way: the composer owns the bottom of
  // the screen, so there is no bar under it and no room kept for one.
  const onTobiPage = location.pathname === '/tobi'
  const fullBleed = onThread || onTobiPage

  // What each bottom-bar slot counts: alerts, unread messages, and requests
  // that are still waiting on somebody.
  const barBadge = (to) =>
    to === '/notifications'
      ? unread
      : to === '/messages'
        ? unreadMessages
        : to === '/requests'
          ? requestCount
          : 0

  const mobileItems = mobileNavForRole(user?.role)
    .map((to) => forRole(NAV_ITEMS.find((item) => item.to === to), user?.role))
    .filter((item) => item && allowed.has(item.to))

  // A bottom-bar destination's own sections — Inventory and Tool Map. The bar's
  // five slots are fixed, so a nested item the role may see is reached as a tab
  // beside its parent instead: same items, same permission filter. Only where
  // the parent is in this role's bar (so a staff shell, which reaches Tool Map
  // from its drawer, is unchanged), and only on the parent page and its tabs —
  // not on a tool's own record under `/tools/:id`.
  const sectionParent = mobileItems.find((item) => location.pathname.startsWith(`${item.to}/`) || location.pathname === item.to)
  const sectionTabs = sectionParent
    ? navItems.filter((item) => item.to.startsWith(`${sectionParent.to}/`))
    : []
  const showSectionTabs =
    sectionTabs.length > 0 &&
    (location.pathname === sectionParent.to ||
      sectionTabs.some((item) => location.pathname === item.to))

  // The staff drawer follows the desktop rail: the same items, in the same
  // order, minus the ones reached another way — the bottom bar's own four,
  // Notifications (the bell in the top bar) and Settings (the account menu
  // beside it, which carries the row on a phone). Same routes and the same
  // permission filter as the rail, and both staff roles are built the one way.
  // `ADMIN_DRAWER_NAV` is no longer read.
  const mobileRoutes = new Set(mobileItems.map((item) => item.to))
  const DRAWER_EXCLUDED = new Set(['/notifications', '/settings'])
  // Their account and Settings close the drawer's grid: on a phone that is
  // where staff find them, and the account dropdown keeps only Sign out.
  const drawerItems = [
    ...railItems.filter((item) => !mobileRoutes.has(item.to) && !DRAWER_EXCLUDED.has(item.to)),
    { to: '/profile', label: 'Account', icon: CircleUserRound },
    ...(can(PERM.SETTINGS_VIEW) ? [{ to: '/settings', label: 'Settings', icon: SettingsIcon }] : []),
  ]
  // The drawer's sections, in reading order. A page not named here lands in
  // "More" so nothing the rail carries is ever left out.
  const DRAWER_SECTIONS = [
    { title: 'Tools', routes: ['/tools', '/tools/map', '/maintenance', '/problem-reports'] },
    { title: 'People', routes: ['/messages', '/users'] },
    { title: 'Insights', routes: ['/reports', '/logs', '/activity'] },
    { title: 'Account', routes: ['/profile', '/settings'] },
  ]
  const drawerGroups = (() => {
    const placed = new Set()
    const groups = DRAWER_SECTIONS.map((section) => {
      const items = section.routes
        .map((to) => drawerItems.find((item) => item.to === to))
        .filter(Boolean)
      items.forEach((item) => placed.add(item.to))
      return { title: section.title, items }
    })
    const rest = drawerItems.filter((item) => !placed.has(item.to))
    // Anything unplaced goes just before Account.
    if (rest.length) groups.splice(groups.length - 1, 0, { title: 'More', items: rest })
    return groups.filter((group) => group.items.length)
  })()

  // The pages the bar reaches, fetched once the app is idle, so switching tabs
  // never waits on a download and never flashes the loading state. The same
  // modules `App.jsx` loads lazily — one chunk each, shared.
  useEffect(() => {
    const warm = () => {
      for (const load of [
        () => import('../pages/DashboardPage'),
        () => import('../pages/ToolsPage'),
        () => import('../pages/ToolMapPage'),
        () => import('../pages/ScanPage'),
        () => import('../pages/TransactionsPage'),
        () => import('../pages/RequestsPage'),
        () => import('../pages/MessagesPage'),
        () => import('../pages/ReturnPage'),
        () => import('../pages/NotificationsPage'),
        () => import('../pages/TobiPage'),
      ]) {
        load().catch(() => {})
      }
    }
    const idle = window.requestIdleCallback
    const handle = idle ? idle(warm, { timeout: 4000 }) : setTimeout(warm, 2500)
    return () => (idle ? window.cancelIdleCallback(handle) : clearTimeout(handle))
  }, [])

  // Close transient UI whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false)
    setMenuOpen(false)
    setTobiOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [drawerOpen])

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const onKey = (event) => event.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const currentPage =
    location.pathname === ACCOUNT_NAV.to
      ? { ...ACCOUNT_NAV, label: accountNavLabel(user?.role) }
      : (forRole(NAV_ITEMS.find((item) => location.pathname === item.to), user?.role) ??
        forRole(NAV_ITEMS.find((item) => location.pathname.startsWith(`${item.to}/`)), user?.role) ??
        // An instructor works from routes that were never rail items — Borrow and
        // Return, which they reach from the hero and the scan result — so the bar can
        // still name the page instead of falling back to the product name.
        EXTRA_PAGES.find((page) => location.pathname === page.to) ??
        (isInstructor
          ? (INSTRUCTOR_EXTRA_PAGES.find((page) => location.pathname === page.to) ?? null)
          : null))

  // A student on a page their bar does not carry — their account, Settings,
  // Notifications, Requests, Return, Tool Map — gets that page in the bar for
  // as long as they are on it, at the end after Transactions and marked as the
  // current one, so
  // the bar never reads as nothing selected. It is gone again on the next page
  // the bar does carry.
  const studentBarExtra = (() => {
    if (onThread || !currentPage?.icon) return null
    const carried = mobileItems.some(
      (item) =>
        location.pathname === item.to ||
        (location.pathname.startsWith(`${item.to}/`) && !hasNestedNavMatch(item.to, location.pathname)),
    )
    return carried ? null : { to: currentPage.to, label: currentPage.label, icon: currentPage.icon }
  })()
  const barItems = studentBarExtra ? [...mobileItems, studentBarExtra] : mobileItems
  // Six slots instead of five: the icons give up a little room to the name.
  const barIconSlot = studentBarExtra ? 'w-9 shrink-0' : 'w-10 shrink-0'

  // The role's Scan item — the centre slot of the bar, where the config lists it.
  const scanItem = mobileItems.find((item) => item.primary) ?? null
  // The open page's own action, where it has one — the same parameters those
  // pages already honour: an administrator's Add on Tools, Users and
  // Maintenance, an instructor's Schedule on the service log, New chat on the
  // inbox, a student's New request on Requests. TOBI's orb beside the bar
  // carries it while the page is open; Scan in the centre never changes, and
  // leaving the page turns the orb back into TOBI.
  const pageAction =
    (isAdmin && adminAddSlot ? { ...adminAddSlot, icon: Plus } : null) ??
    scheduleSlot ??
    messageSlot ??
    requestSlot
  // What TOBI offers on this page — "Ask TOBI about requests" and so on.
  const assistantLabel = assistantContextFor(location.pathname, user?.role)

  // The pressed tab's name and the action's word are always shown, whole. What
  // gives on a narrow screen is the room around them: each step tightens the
  // slots, the pills' padding and the gap beside the bar. The step is worked
  // out below from the bar's own measurements.
  const BAR_DENSITY = [
    { tab: studentBarExtra ? 36 : 40, scan: 60, tabPad: 12, scanPad: 14, actionPad: 16, rowGap: 8 },
    { tab: 32, scan: 56, tabPad: 9, scanPad: 10, actionPad: 12, rowGap: 6 },
    { tab: 28, scan: 54, tabPad: 7, scanPad: 8, actionPad: 10, rowGap: 4 },
    { tab: 26, scan: 52, tabPad: 5, scanPad: 6, actionPad: 8, rowGap: 3 },
  ]
  const [barLevel, setBarLevel] = useState(0)
  const density = BAR_DENSITY[Math.min(barLevel, BAR_DENSITY.length - 1)]

  // Scan, always, in the bar's centre slot: the system's headline feature, so
  // it is a large accent circle that rises out of the bar, icon only — the QR
  // glyph says what it is. On its own page it gains a ring rather than a name.
  const renderScanButton = () => {
    const ScanIcon = scanItem.icon
    return (
      <NavLink
        key={scanItem.to}
        to={scanItem.to}
        end
        aria-label={scanItem.label}
        className={({ isActive }) =>
          cx(
            'relative z-10 grid shrink-0 place-items-center rounded-full',
            // Taller than the bar: the negative margins let it rise above the
            // bar's top edge without making the bar itself any taller.
            '-mb-2 -mt-6 transition-transform active:scale-95 motion-reduce:transition-none',
            isActive && 'ring-4 ring-white/80 dark:ring-white/25',
          )
        }
        style={{
          background: 'radial-gradient(120% 120% at 30% 20%, rgb(255 222 120), rgb(var(--accent)) 60%)',
          color: 'rgb(var(--accent-contrast))',
          width: `${density.scan}px`,
          height: `${density.scan}px`,
          boxShadow:
            'inset 0 1.5px 0 rgb(255 255 255 / 0.7), 0 10px 22px -8px rgb(180 120 0 / 0.65), 0 2px 6px rgb(15 23 42 / 0.18)',
        }}
        data-bar-slot="scan"
      >
        <ScanIcon className="h-7 w-7" strokeWidth={2.2} />
      </NavLink>
    )
  }

  // TOBI, the amber glass button beside the bar, for every role. On a page with
  // its own action it is that action, named (a "+" with New request, New chat,
  // Add tool, Add user or Schedule). Everywhere else it is TOBI's icon alone,
  // which opens the conversation; what it offers on this page is its
  // accessible name.
  const orbClass =
    'liquid-glass-orb flex h-[52px] shrink-0 items-center justify-center gap-1.5 rounded-full ' +
    'whitespace-nowrap text-xs font-extrabold tracking-tight transition-all active:scale-95 ' +
    'motion-reduce:transition-none'
  const renderAssistant = () => {
    if (pageAction) {
      const ActionIcon = pageAction.icon
      return (
        <Link
          to={pageAction.to}
          aria-label={pageAction.ariaLabel ?? pageAction.label}
          className={orbClass}
          style={{ paddingInline: `${density.actionPad}px` }}
        >
          <ActionIcon className="h-5 w-5 shrink-0" strokeWidth={2.4} />
          <span data-bar-action-word="">{pageAction.label}</span>
        </Link>
      )
    }
    return (
      <button
        type="button"
        onClick={openTobi}
        aria-label={assistantLabel}
        aria-haspopup="dialog"
        aria-expanded={tobiOpen}
        // While its card is open the button steps aside — the card is it,
        // grown — and comes back as the card folds into it.
        className={cx(orbClass, 'tobi-launcher w-[52px]')}
      >
        <Sparkles className="h-6 w-6 shrink-0" strokeWidth={2.2} />
      </button>
    )
  }

  // Which way the page moved along the bottom bar — later tab slides in from the
  // right, earlier from the left, anything else just rises. Worked out while
  // rendering the new route, from the one before it.
  const barPosition = (path) => {
    const order = barItems.map((item) => item.to)
    let best = -1
    order.forEach((to, i) => {
      if ((path === to || path.startsWith(`${to}/`)) && (best < 0 || to.length > order[best].length)) best = i
    })
    return best
  }
  const routeMotion = useRef({ path: location.pathname, dir: 'none' })
  if (routeMotion.current.path !== location.pathname) {
    const from = barPosition(routeMotion.current.path)
    const to = barPosition(location.pathname)
    routeMotion.current = {
      path: location.pathname,
      dir: from >= 0 && to >= 0 && from !== to ? (to > from ? 'forward' : 'back') : 'none',
    }
  }

  // Keep the bar's lens on the pressed tab. Its position is the tab's own, read
  // as the tabs settle — a ResizeObserver follows the name easing open in one
  // tab and closed in the other — so it glides with them instead of jumping.
  // The first placement is not animated, so it never slides in from the edge.
  const barRef = useRef(null)
  const lensRef = useRef(null)
  useLayoutEffect(() => {
    const bar = barRef.current
    const lens = lensRef.current
    if (!bar || !lens) return undefined
    let first = !lens.dataset.placed
    const place = () => {
      const active = bar.querySelector('[data-bar-tab][aria-current="page"]')
      if (!active) {
        lens.style.opacity = '0'
        return
      }
      if (first) lens.style.transition = 'none'
      lens.style.opacity = '1'
      lens.style.width = `${active.offsetWidth}px`
      lens.style.transform = `translate3d(${active.offsetLeft}px, 0, 0)`
      if (first) {
        first = false
        lens.dataset.placed = '1'
        requestAnimationFrame(() => {
          lens.style.transition = ''
        })
      }
    }
    place()
    const observer = new ResizeObserver(place)
    bar.querySelectorAll('[data-bar-tab]').forEach((tab) => observer.observe(tab))
    observer.observe(bar)
    return () => observer.disconnect()
  }, [location.pathname, barItems.length])

  // Pick the roomiest step at which everything fits, names included. Widths
  // come from the step being tried and from each name's own text width
  // (scrollWidth, which a label still easing open reports whole), never from
  // the bar as it is drawn now, so the answer cannot flip back and forth.
  const barRowRef = useRef(null)
  useLayoutEffect(() => {
    const row = barRowRef.current
    const bar = barRef.current
    if (!row || !bar) return undefined
    const decide = () => {
      const slots = [...bar.children].filter((el) => el !== lensRef.current)
      const style = getComputedStyle(bar)
      const frame =
        parseFloat(style.paddingLeft) +
        parseFloat(style.paddingRight) +
        (parseFloat(style.columnGap) || 0) * Math.max(0, slots.length - 1)
      const word = row.querySelector('[data-bar-action-word]')
      const fits = (step) => {
        let used = frame
        slots.forEach((el) => {
          const isScan = el.dataset.barSlot === 'scan'
          const isTab = isScan || el.dataset.barTab !== undefined
          const min = isScan ? step.scan : step.tab
          if (!isTab) {
            used += el.offsetWidth
            return
          }
          const label = el.getAttribute('aria-current') === 'page' && el.querySelector('.bar-tab-label')
          // Pressed: its padding either side, the icon, the gap and the name.
          const pad = isScan ? step.scanPad : step.tabPad
          used += label ? Math.max(min, pad * 2 + 20 + 6 + label.scrollWidth) : min
        })
        // The amber button: its padding, the "+", the gap and the word — or
        // TOBI's round 52px.
        const action = word ? step.actionPad * 2 + 20 + 6 + word.scrollWidth : 52
        return used + step.rowGap + action <= row.clientWidth
      }
      let next = BAR_DENSITY.findIndex(fits)
      if (next < 0) next = BAR_DENSITY.length - 1
      setBarLevel((prev) => (prev === next ? prev : next))
    }
    decide()
    const observer = new ResizeObserver(decide)
    observer.observe(row)
    return () => observer.disconnect()
  }, [location.pathname, barItems.length, pageAction?.label, hasDrawer])

  // One bottom-bar tab.
  const renderBarItem = (item) => {
    const Icon = item.icon
    if (studentModern) {
      return (
        <NavLink
          key={item.to}
          to={item.to}
          end={hasNestedNavMatch(item.to, location.pathname)}
          aria-label={item.label}
          className={({ isActive }) =>
            cx(
              'bar-tab flex h-11 items-center justify-center rounded-full',
              'text-[11px] font-bold tracking-tight',
              // The current page is a clear glass lens with its name; the
              // accent stays Scan's and TOBI's alone.
              // Every tab keeps its full width — nothing is squeezed into an
              // ellipsis; on a bar too narrow for the name, it is left out.
              'shrink-0',
            )
          }
          // Sized by what it holds: the icon at rest, the icon and its name when
          // pressed. The name's width is what animates (`.bar-tab-label`), so the
          // pill opens smoothly to just its label and the bar spreads the rest
          // evenly — it never swallows the free space.
          data-bar-tab=""
          style={({ isActive }) => ({
            minWidth: `${density.tab}px`,
            paddingInline: isActive ? `${density.tabPad}px` : 0,
            color: isActive ? 'rgb(var(--glass-lens-fg))' : 'rgb(var(--glass-fg) / 0.72)',
          })}
        >
          {({ isActive }) => (
            <>
            <span
              className="relative grid shrink-0 place-items-center"
            >
              <span className="relative">
                <Icon className="h-5 w-5" strokeWidth={2} />
                {barBadge(item.to) > 0 && (
                  <span
                    className="absolute -right-2 -top-1.5 grid h-3.5 min-w-[14px] place-items-center
                               rounded-full bg-red-500 px-1 text-[9px] font-bold text-white"
                  >
                    {barBadge(item.to) > 9 ? '9+' : barBadge(item.to)}
                  </span>
                )}
              </span>
            </span>
            {/* Pressed — the current page — it is named; the rest are icons.
                The name is always there and eases open, rather than popping in. */}
            <span className="bar-tab-label" data-open={isActive || undefined}>
              {item.label}
            </span>
            </>
          )}
        </NavLink>
      )
    }
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={hasNestedNavMatch(item.to, location.pathname)}
        aria-label={item.label}
        className={({ isActive }) =>
          cx(
            'flex flex-1 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px]',
            'font-bold tracking-tight transition-colors',
            isActive ? 'text-amberline-600 dark:text-amberline-400' : 'subtle',
          )
        }
      >
        {({ isActive }) => (
          <>
            {/* The active item is marked by a filled pill behind its
                icon — clearer at a glance than the old hairline, and it
                keeps every item on the same baseline. */}
            <span
              className={cx(
                'relative grid h-8 w-12 place-items-center rounded-xl transition-colors',
                isActive && 'bg-amberline-400/15',
              )}
            >
              {/* One weight for every item, active or not: the filled
                  pill and the colour already mark the current page, and a
                  thicker stroke on top made that one glyph read as a
                  different set of icons from its neighbours. */}
              <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
              {barBadge(item.to) > 0 && (
                <span
                  className="absolute right-1.5 top-0.5 grid h-3.5 min-w-[14px]
                             place-items-center rounded-full bg-red-500 px-1 text-[9px]
                             font-bold text-white"
                >
                  {barBadge(item.to) > 9 ? '9+' : barBadge(item.to)}
                </span>
              )}
            </span>
            <span className="max-w-full truncate px-0.5">{item.label}</span>
          </>
        )}
      </NavLink>
    )
  }

  // The newest live notification, if any. The queue, its messages, variants and
  // timers all stay in `ToastProvider`; the shell only reads the current one.
  const feed = useToastFeed()
  const notice = feed[feed.length - 1] ?? null

  // A notice closes the account menu: the control it belongs to is not on screen
  // while the notice occupies its place.
  useEffect(() => {
    if (notice) setMenuOpen(false)
  }, [notice])

  const handleLogout = async () => {
    // Clears the session and every scoped listener with it.
    await logout()
    navigate('/login', { replace: true })
  }

  const [bare, setBare] = useState(false)

  // The student's phone look, shared by every page they use: the bar in the
  // accent, cards and buttons rounded (`.student-modern`), and — on every page
  // but the dashboard, which draws its own — a short accent band under the bar
  // with the page itself on a sheet over it. All of it is phone-only in CSS,
  // so from `sm` the shell is unchanged; an open thread keeps its own layout.
  // Every role now — the student's look became the app's phone look.
  const studentModern = !bare
  const studentBand = studentModern && location.pathname !== '/dashboard' && !fullBleed
  const chrome = useMemo(() => ({ setBare }), [])

  return (
    <ShellChromeContext.Provider value={chrome}>
    <div className="shell-enter flex min-h-[100dvh] w-full">
      {/* ------------------------------ desktop rail ------------------------------ */}
      {!bare && (
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col lg:flex"
        style={{ background: 'rgb(var(--rail))' }}
      >
        <div className="hazard-stripe h-1 w-full shrink-0" />

        {/* One tile, built the way every other surface in the app is: rounded,
            softly filled, hairline ring. The application's own mark — the same
            `/Logoapp.png` the sign-in screen uses — and the system's name, and
            nothing else. Every role opens on the same block now. */}
        <div className="px-3 pb-4 pt-4">
          <Link
            to="/dashboard"
            className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-3 py-3
                       ring-1 ring-white/10 transition-colors hover:bg-white/[0.09]"
          >
            <img
              src="/Logoapp.png"
              alt=""
              aria-hidden="true"
              loading="eager"
              decoding="async"
              className="h-10 w-10 shrink-0 object-contain"
            />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[14px] font-extrabold tracking-tight text-white">
                {APP_NAME}
              </span>
            </span>
          </Link>
        </div>

        <nav className={cx('min-h-0 flex-1 overflow-y-auto px-3 pb-4', isStudent && 'pt-4')}>
          {/* An instructor stands at a counter: the three things they do to a
              tool come before the places they look at one, so Scan, Borrow and
              Return are a filled action group at the top of the rail rather than
              three rows lost in a list of seven. Scan leads it, in the accent,
              because it is the way both of the others usually start. */}
          {quickActions.length > 0 && <RailQuickActions actions={quickActions} />}
          <SidebarLinks
            items={railItems}
            unread={unread}
            messageUnread={unreadMessages}
            requestCount={requestCount}
            userCount={userCount}
            reportCount={reportCount}
            spacious={isStudent}
          />
        </nav>

        {/* The department's page is reached from a student's account page and
            from nowhere else, so the rail ends with the navigation. */}

        {/* The laboratory's name and the room it is in were signage for a
            visitor; everybody who signs in already knows which laboratory they
            are standing in. Every rail now ends with the navigation, so the
            footer is gone rather than left behind a condition no role meets.
            `settings.labName` and `labLocation` are still set and read on the
            Settings page and on the printed QR labels. */}

        {/* TOBI, pinned under the navigation: the assistant is not one more
            place in the list but something reached from anywhere, so it gets
            its own tile — the amber orb, its name, and what it is for. Opens
            the full page; lit while it is open. */}
        <div className="shrink-0 px-3 pb-4 pt-2">
          <NavLink
            to="/tobi"
            state={{ from: location.pathname }}
            className={({ isActive }) =>
              cx(
                'group flex items-center gap-3 rounded-2xl p-2.5 ring-1 transition-colors',
                isActive
                  ? 'bg-white/[0.10] ring-amberline-400/40'
                  : 'bg-white/[0.04] ring-white/10 hover:bg-white/[0.08]',
              )
            }
          >
            <span className="liquid-glass-orb grid h-10 w-10 shrink-0 place-items-center rounded-full transition-transform group-hover:scale-105">
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-extrabold" style={{ color: 'rgb(var(--rail-text))' }}>
                Ask TOBI
              </span>
              <span className="block truncate text-[11.5px]" style={{ color: 'rgb(var(--rail-muted))' }}>
                Your Tool Track assistant
              </span>
            </span>
          </NavLink>
        </div>
      </aside>
      )}

      {/* ------------------------------ mobile drawer ----------------------------- */}
      {/* Staff only — they have more destinations than a bottom bar holds, and
          they open this from the bar's own Menu slot. A student's bottom bar
          carries every route they have, so they have no drawer to open. */}
      {!bare && drawerOpen && hasDrawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-navy-950/70 animate-fade-in"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          {/* The staff menu as a bottom sheet, the way the rest of the phone
              opens things: a rounded sheet rising from the bar with the
              destinations the bar does not carry laid out as a grid of tiles —
              each an icon on a soft chip with its name under it, the current
              page in the accent. Alerts are the bell in the top bar and account
              actions — Sign out included — the account menu beside it, so
              neither is repeated here. Painted from the surface tokens, so it
              follows the theme. */}
          <aside
            className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-[28px] px-4 pt-3
                       pb-[max(1.25rem,var(--sab))] shadow-panel animate-slide-up"
            style={{
              background: 'rgb(var(--surface))',
              paddingLeft: 'calc(var(--sal) + 1rem)',
              paddingRight: 'calc(var(--sar) + 1rem)',
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            <span
              className="mx-auto block h-1 w-10 rounded-full"
              style={{ background: 'rgb(var(--border-strong))' }}
            />
            <div className="mb-3 mt-3 flex items-center justify-between">
              <p className="text-base font-extrabold tracking-tight">Menu</p>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="btn btn-ghost btn-icon"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* Grouped, so the drawer reads as sections rather than one grid
                of tiles: the tools, the people, the reports, and the account
                last. Only groups with something in them are drawn. */}
            <nav className="max-h-[70dvh] space-y-4 overflow-y-auto overscroll-contain pb-1">
              {drawerGroups.map((group) => (
                <section key={group.title}>
                  <p className="subtle mb-2 px-1 text-[11px] font-bold uppercase tracking-wider">
                    {group.title}
                  </p>
                  <div className="grid grid-cols-3 gap-2.5">
                    {group.items.map((item) => {
                        const Icon = item.icon
                        return (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            end={hasNestedNavMatch(item.to, location.pathname)}
                            className={({ isActive }) =>
                              cx(
                                'flex min-w-0 flex-col items-center gap-2 rounded-2xl px-1.5 py-3.5 text-center',
                                'text-[12px] font-bold leading-tight tracking-tight transition-colors',
                                isActive
                                  ? 'bg-amberline-400/15 text-amberline-700 dark:text-amberline-300'
                                  : 'hover:bg-black/[0.035] dark:hover:bg-white/5',
                              )
                            }
                            style={({ isActive }) =>
                              isActive ? undefined : { background: 'rgb(var(--surface-2))' }
                            }
                          >
                            {({ isActive }) => (
                              <>
                                <span
                                  className="grid h-11 w-11 place-items-center rounded-full"
                                  style={
                                    isActive
                                      ? { background: 'rgb(var(--accent))', color: 'rgb(var(--accent-contrast))' }
                                      : { background: 'rgb(var(--surface-3))' }
                                  }
                                >
                                  <Icon className="h-5 w-5" strokeWidth={2} />
                                </span>
                                <span className="line-clamp-2 min-w-0">{item.label}</span>
                              </>
                            )}
                          </NavLink>
                        )
                    })}
                  </div>
                </section>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* --------------------------------- main ---------------------------------- */}
      {/* The side insets are taken here rather than on the shell, so the fixed
          desktop rail still reaches the left edge of the window while the top
          bar and the page keep clear of a notch or a curved edge in landscape.
          Both are 0px in portrait and on desktop. */}
      <div
        className={cx('safe-x flex min-w-0 flex-1 flex-col', !bare && 'lg:pl-[248px]')}
      >
        {/* The bar carries three things and no more: the way back to navigation
            on a phone, where you are, and who you are. There is no notification
            control here — Notifications is a first-class destination in the rail
            and in the bottom bar, and a bell would be a third route to it.
            One height at every width (56px): the old 64px desktop bar was mostly
            empty, and the page's own hero is what should own the space below. */}
        {!bare && (
        <header
          // Above the dashboard greeting, so the bar and the account menu it
          // opens are painted over the mascot rather than under it.
          className={cx(
            'safe-top sticky top-0 z-40 border-b',
            // A student's dashboard on a phone opens on an accent band that
            // starts right under the bar; the bar takes the same accent and
            // drops its hairline so the two read as one surface.
            // Every student page uses it now, not only the dashboard.
            studentModern && 'shell-bar-accent',
          )}
          style={{
            // Solid rather than translucent: with no blur behind it, the page
            // scrolling past would otherwise show through the bar.
            background: 'rgb(var(--surface))',
            borderColor: 'rgb(var(--border) / 0.7)',
          }}
        >
          {/* A little more room from the edge on a phone than the page below
              takes, so the title and the avatar are not pressed against the
              screen. The phone inset is a touch wider still — at 15px the title
              sat almost on the edge — and the right side keeps the old 1rem so
              the extra room goes to the name rather than away from the controls.
              The wider breakpoints are unchanged. */}
          <div className="flex h-14 items-center gap-2 pl-5 pr-4 sm:px-5 lg:px-8">
            {/* No navigation control lives in the bar for any role: an
                administrator opens their drawer from the Menu slot in the bottom
                bar, and an instructor's and a student's bottom bar already
                carries every route they have. The bar is the title, the bell and
                the account pill. */}

            {/* The page name on its own: no glyph, no figure, no tile — the
                account pill opposite is the only shape in the row. */}
            <div className="min-w-0 flex-1">
              {/* A step up from 15px on a phone: the page name is the one piece
                  of text in the bar and read at arm's length. From `sm` the bar
                  is unchanged. */}
              <h1 className="truncate text-[17px] font-extrabold tracking-tight sm:text-[15px]">
                {currentPage?.label ?? 'ToolTrack'}
              </h1>
            </div>

            {/* The account control's own space doubles as the notice area: while
                a notification is live it takes this slot, and the control returns
                untouched the moment the notice times out. */}
            {notice && <HeaderNotice toast={notice} />}

            {/* An instructor's bottom bar carries five destinations and no
                "More", so their alerts move here — immediately left of the
                account pill, with the same unread count the bar used to show.
                Same route, same badge; only its place in the shell changes. */}
            {/* An administrator's bell sits here too, beside the account pill —
                same route, same unread badge, only its place changes. */}
            {/* Theme, notifications, account — in that order. Appearance is a
                Settings concern, so the switch only appears while Settings is
                open; every other page keeps the bar to two controls. */}
            {location.pathname.startsWith('/settings') && (
              <AppearanceToggleButton className={cx(notice && 'hidden')} />
            )}

            {/* TOBI on a desktop, where there is no bottom bar to carry it. */}
            <button
              type="button"
              onClick={openTobi}
              aria-haspopup="dialog"
              aria-expanded={tobiOpen}
              aria-label="Ask TOBI, the Tool Track assistant"
              title="Ask TOBI"
              className={cx(
                'liquid-glass-orb hidden h-10 w-10 shrink-0 place-items-center rounded-full',
                'transition-transform active:scale-95 lg:grid',
                (notice || onTobiPage) && '!hidden',
              )}
            >
              <Sparkles className="h-5 w-5" />
            </button>

            {(isInstructor || isAdmin || isStudent) && (
              <NavLink
                to="/notifications"
                className={({ isActive }) =>
                  cx(
                    'relative grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors',
                    notice && 'hidden',
                    isActive
                      ? 'bg-black/5 text-amberline-600 dark:bg-white/5 dark:text-amberline-400'
                      : 'hover:bg-black/5 dark:hover:bg-white/5',
                  )
                }
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5" />
                {unread > 0 && (
                  <span
                    className="absolute right-1.5 top-1.5 grid h-3.5 min-w-[14px] place-items-center
                               rounded-full bg-red-500 px-1 text-[9px] font-bold text-white"
                  >
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </NavLink>
            )}

            {/* profile menu */}
            <div className={cx('relative shrink-0', notice && 'hidden')} ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                // A pill rather than a bare square: the avatar plus a chevron
                // reads as a control at a glance, and the whole pill is the tap
                // target on a phone rather than the 36px avatar alone.
                className={cx(
                  'flex min-h-[44px] items-center gap-1.5 rounded-full py-1 pl-1 pr-2 transition-colors',
                  menuOpen
                    ? 'bg-black/5 dark:bg-white/5'
                    : 'hover:bg-black/5 dark:hover:bg-white/5',
                )}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
              >
                <Avatar
                  name={user?.fullName}
                  url={user?.avatarUrl}
                  className="h-9 w-9 text-sm ring-1 ring-black/5 dark:ring-white/10"
                />
                <span className="hidden min-w-0 text-left sm:block">
                  <span className="block max-w-[140px] truncate text-xs font-bold leading-tight">
                    {user?.fullName}
                  </span>
                  <span className="subtle block text-[10px] font-bold uppercase tracking-wider">
                    {user?.role}
                  </span>
                </span>
                {/* Shown at every width now: on a phone it is the one thing that
                    says the avatar opens something. */}
                <ChevronDown
                  className={cx(
                    'h-4 w-4 shrink-0 text-navy-400 transition-transform duration-200',
                    menuOpen && 'rotate-180',
                  )}
                />
              </button>

              {menuOpen && (
                // Anchored to the trigger's right edge and capped to the
                // viewport, so it can never hang off the screen on a narrow
                // phone. Its z-index sits above the dashboard greeting, so the
                // menu is painted over the mascot standing behind it rather than
                // the other way round.
                <div
                  className={cx(
                    // The bar is inset 1rem on a phone where the page below is
                    // inset 0.75rem, so the menu steps out that 4px and its
                    // right edge lines up with the card underneath it. From
                    // `sm` the two insets already match.
                    'card absolute -right-1 top-full z-50 mt-2 max-w-[calc(100vw-1.5rem)] sm:right-0',
                    'overflow-hidden rounded-2xl p-1.5 shadow-panel animate-slide-up',
                    'w-64',
                  )}
                  role="menu"
                >
                  {/* Who is signed in, with the one or two details that tell one
                      account from another — the role, and a student's own ID. */}
                  {/* The avatar beside the name, and the role and ID as one
                      quiet line under it, on a soft tinted block — a profile
                      header rather than a row of badges. */}
                  <div className="mb-1 flex min-w-0 items-center gap-3 rounded-xl bg-black/[0.035] px-3 py-3 dark:bg-white/[0.05]">
                    <Avatar
                      name={user?.fullName}
                      url={user?.avatarUrl}
                      className="h-10 w-10 shrink-0 text-sm ring-2 ring-white dark:ring-white/10"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-bold leading-tight">{user?.fullName}</p>
                      <p className="muted mt-0.5 truncate text-[12px] font-medium">
                        {[user?.role, user?.studentId].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                  {!online && (
                    <p className="mx-1 mb-1.5 flex items-center gap-1.5 rounded-lg bg-orange-500/10 px-2.5 py-2 text-[11px] font-semibold leading-snug text-orange-600 dark:text-orange-300">
                      <WifiOff className="h-3.5 w-3.5 shrink-0" />
                      Offline — changes sync when the connection returns
                    </p>
                  )}
                  <div className="mb-1.5 border-t" />
                  {user?.role === ROLE.STUDENT && (
                    /* Text-only rows, level with Sign out below them. Same
                       routes, same order, same permissions. */
                    <>
                      <Link
                        to="/profile"
                        className="flex min-h-[46px] items-center gap-3 rounded-xl px-2.5 py-1.5
                                   transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        role="menuitem"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          My account
                        </span>
                      </Link>
                      {/* The Settings page shows a student their own preferences;
                          the laboratory configuration inside it stays with the
                          administrators. */}
                      <Link
                        to="/settings"
                        className="flex min-h-[46px] items-center gap-3 rounded-xl px-2.5 py-1.5
                                   transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        role="menuitem"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          Settings
                        </span>
                      </Link>
                    </>
                  )}
                  {/* Staff on a phone reach their account and Settings from the
                      Menu drawer, so the dropdown there is who is signed in and
                      Sign out. On desktop, with no drawer, My account stays here
                      (Settings is in the rail). */}
                  {!isStudent && (
                    <Link
                      to="/profile"
                      className="hidden min-h-[46px] items-center gap-3 rounded-xl px-2.5 py-1.5
                                 transition-colors hover:bg-black/5 dark:hover:bg-white/5 lg:flex"
                      role="menuitem"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        My account
                      </span>
                    </Link>
                  )}
                  <div className={cx('my-1.5 border-t', !isStudent && 'hidden lg:block')} />
                  <button
                    type="button"
                    onClick={handleLogout}
                    className={cx(
                      'flex min-h-[42px] w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm',
                      'font-semibold text-red-600 transition-colors hover:bg-red-500/10',
                      'dark:text-red-400',
                    )}
                    role="menuitem"
                  >
                    <span className="min-w-0 flex-1 truncate">Sign out</span>
                    <LogOut className="h-4 w-4 shrink-0" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        )}

        {/* More room to breathe from `lg`, where the rail takes over navigation
            and the page no longer competes with a bottom bar. A standalone page
            has neither, so it takes the whole viewport with no reserved space. */}
        <main
          className={cx(
            'min-w-0 flex-1',
            // No padding of its own: the standalone page centres itself in the
            // full viewport and carries its own margins.
            // `shell-main-pad` is the room reserved under the last card for the
            // floating bottom bar, and the unchanged 3rem from `lg`, where
            // there is no bar. It was a flat 7rem — the bar plus its 1rem gap
            // on a phone with no gesture area; on one with a home indicator the
            // wrapper sits that much higher and the bar covered the last row.
            bare ? 'flex' : 'px-3 pt-4 sm:px-5 lg:px-8 lg:pt-6',
            // The room under the last card for the floating bar — dropped on a
            // thread, where there is no bar to clear.
            !bare && !fullBleed && 'shell-main-pad',
            studentModern && 'student-modern',
          )}
        >
          {/* The bar already names the page; the band is only the accent the
              sheet below rises out of. */}
          {studentBand && <div aria-hidden="true" className="student-band sm:hidden" />}
          <div className={cx(studentBand && 'student-sheet')}>
          {/* Keyed on the path so navigating away from a failed page clears
              the error rather than sticking on it. */}
          {/* Pages are loaded on first visit rather than all at start-up, so the
              page area may briefly have nothing to render while its chunk
              arrives. The shell around it is already painted. */}
          {!bare && showSectionTabs && (
            <nav
              aria-label={`${sectionParent.label} sections`}
              className="mb-3 flex items-center gap-0.5 rounded-xl border p-0.5 lg:hidden"
              style={{ background: 'rgb(var(--surface-2))' }}
            >
              {[sectionParent, ...sectionTabs].map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={hasNestedNavMatch(item.to, location.pathname)}
                    className={({ isActive }) =>
                      cx(
                        'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5',
                        'text-[11px] font-bold uppercase tracking-wide transition-colors',
                        isActive ? 'btn-dark shadow-sm' : 'muted hover:bg-black/[0.04] dark:hover:bg-white/5',
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </NavLink>
                )
              })}
            </nav>
          )}
          <ErrorBoundary key={location.pathname}>
            {/* Remounted per route by the key above, so its entrance plays on
                every page change: a short slide in the direction travelled and
                a fade (phone only — see `.page-enter`). */}
            <div className="page-enter" data-dir={routeMotion.current.dir}>
              <Suspense fallback={<PageLoading />}>
                <Outlet />
              </Suspense>
            </div>
          </ErrorBoundary>
          </div>
        </main>
      </div>

      {/* ----------------------------- mobile bottom bar ----------------------------
          A floating bar: it sits clear of the bottom edge with the iOS/Android
          safe-area inset added underneath, so the home indicator never crowds it.
          The surface is white Liquid Glass (`.liquid-glass` in index.css): the
          blur is strong enough that cards scrolling behind it read as colour, not
          detail, so the labels stay legible. Same items, same routes, same badges
          as before. */}
      {/* The gap is an offset on the fixed element rather than padding inside
          it, so the bar's own box ends where it is drawn: nothing invisible
          hangs below it, and it cannot be pushed under the gesture bar.
          `max()` rather than a sum — a phone that reports a 34px inset already
          has its clearance, and a phone that reports none still gets a full
          1rem — so the bar sits the same distance clear of the edge on every
          device instead of doubling up on the ones with a home indicator. */}
      {!bare && !fullBleed && (
      <div
        className="fixed inset-x-0 z-30 lg:hidden"
        style={{
          bottom: 'max(var(--sab), 1rem)',
          // The bar is fixed to the window, so it does not inherit the shell's
          // side insets — it takes its own, added to the 0.75rem it always had.
          paddingLeft: 'calc(var(--sal) + 0.75rem)',
          paddingRight: 'calc(var(--sar) + 0.75rem)',
        }}
      >
        {/* White Liquid Glass, for every role: the tabs as icons, with the
            pressed one — the current page — opened into a named lens, and Scan
            in the middle; staff's Menu slot at the end. Beside the bar, the amber
            button: TOBI's icon, or the open page's own "+" with its name. */}
        <div ref={barRowRef} className="mx-auto flex max-w-md items-center" style={{ gap: `${density.rowGap}px` }}>
        <nav
          ref={barRef}
          className="liquid-glass relative flex min-w-0 flex-1 items-center justify-between gap-0.5 rounded-full px-1.5 py-1.5"
          aria-label="Primary"
        >
          {/* The pressed tab's pill: one lens for the bar, gliding from tab to
              tab (transform), rather than each tab switching its own on. */}
          <span ref={lensRef} aria-hidden="true" className="bar-lens liquid-glass-lens" />
          {barItems.map((item) => (item.primary ? renderScanButton() : renderBarItem(item)))}
          {/* Staff's last slot opens the menu panel rather than navigating: the
              drawer carries the rest of their destinations. */}
          {hasDrawer && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={cx('grid h-11 place-items-center rounded-full transition-colors', barIconSlot)}
              style={{ color: 'rgb(var(--glass-fg) / 0.72)' }}
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
            >
              <Menu className="h-5 w-5" strokeWidth={2} />
            </button>
          )}
        </nav>
        {renderAssistant()}
        </div>
      </div>
      )}
      {!bare && <TobiChat open={tobiOpen} onClose={closeTobi} originRef={tobiOrigin} />}
    </div>
    </ShellChromeContext.Provider>
  )
}

/**
 * The instructor rail's action group — Scan, Borrow, Return.
 *
 * Not a second navigation list: these are the three things done *to* a tool, so
 * they are drawn as buttons rather than rows. Scan takes the accent and the full
 * width because it is how the other two usually begin; Borrow and Return sit
 * under it as a pair. Every route and guard is the existing one — the group only
 * changes where they are reached from.
 */
function RailQuickActions({ actions }) {
  const primary = actions.find((a) => a.primary)
  const rest = actions.filter((a) => !a.primary)
  return (
    <div className="mb-4 space-y-1.5" aria-label="Counter actions">
      {primary && (
        <NavLink
          to={primary.to}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px] font-bold',
              'tracking-tight transition-transform active:scale-[0.98] motion-reduce:transition-none',
              isActive && 'ring-2 ring-white/25',
            )
          }
          style={{ background: 'rgb(var(--accent))', color: 'rgb(var(--accent-contrast))' }}
        >
          <primary.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2.25} />
          <span className="min-w-0 flex-1 truncate">{primary.label}</span>
        </NavLink>
      )}
      {rest.length > 0 && (
        <div className={cx('grid gap-1.5', rest.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {rest.map((action) => (
            <NavLink
              key={action.to}
              to={action.to}
              className={({ isActive }) =>
                cx(
                  'flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-[11.5px]',
                  'font-bold tracking-tight transition-colors duration-150',
                  isActive
                    ? 'bg-white/[0.12] text-white'
                    : 'bg-white/[0.05] text-navy-200 hover:bg-white/[0.09] hover:text-white',
                )
              }
            >
              <action.icon className="h-[18px] w-[18px] text-amberline-400" strokeWidth={2} />
              <span className="max-w-full truncate">{action.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The rail's links. Same items, same routes, same badge — refined rather than
 * rebuilt:
 *
 *   • every icon sits in a fixed 20px slot, so labels start on one optical line
 *     whether the glyph is a narrow bell or a wide layout grid;
 *   • the active item is a 12px-radius filled row with a short, centred accent
 *     marker on its edge, instead of a flat `bg-white/10` and a full-height bar;
 *   • one step of type weight between resting and active, and a 150ms colour
 *     transition on both, so hovering the rail feels continuous.
 */
function SidebarLinks({
  items,
  unread,
  messageUnread = 0,
  requestCount = 0,
  userCount = 0,
  reportCount = 0,
  showDescriptions = false,
  spacious = false,
}) {
  const { pathname } = useLocation()
  // Five rails carry a count: alerts, unread messages, open requests, accounts
  // waiting to be approved, and reports still needing attention. Same badge,
  // same rules — each reads its own number, so none of them affects another. A
  // zero renders nothing, which is what hides the badge on every rail that has
  // no work waiting.
  const badgeFor = (to) =>
    to === '/notifications'
      ? unread
      : to === '/messages'
        ? messageUnread
        : to === '/requests'
          ? requestCount
          : to === '/users'
            ? userCount
            : to === '/problem-reports'
              ? reportCount
              : 0

  return (
    <ul className={spacious ? 'space-y-1.5' : 'space-y-1'}>
      {items.map((item) => {
        const Icon = item.icon
        const count = badgeFor(item.to)
        return (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={hasNestedNavMatch(item.to, pathname)}
              className={({ isActive }) =>
                cx(
                  'group relative flex items-center gap-3 rounded-xl px-3',
                  spacious ? 'py-3 text-[14px]' : 'py-2.5 text-[13.5px]',
                  'tracking-tight transition-colors duration-150',
                  isActive
                    ? 'font-bold text-white'
                    : 'font-semibold text-navy-300 hover:bg-white/[0.05] hover:text-white',
                )
              }
              style={({ isActive }) =>
                isActive ? { background: 'rgb(255 255 255 / 0.08)' } : undefined
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-amberline-400" />
                  )}
                  <span className="grid w-5 shrink-0 place-items-center">
                    <Icon
                      strokeWidth={2}
                      className={cx(
                        'h-[18px] w-[18px] transition-colors duration-150',
                        isActive
                          ? 'text-amberline-400'
                          : 'text-navy-400 group-hover:text-amberline-400',
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {item.label}
                    {showDescriptions && (
                      <span className="block text-[10px] font-medium text-navy-500">
                        {item.description}
                      </span>
                    )}
                  </span>
                  {count > 0 && (
                    <span className="grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A notification shown in the account control's slot in the bar.
 *
 * Same icon, tint and wording as before — only the place has changed. It is
 * `aria-live`, so a screen reader still announces it, and nothing inside is
 * interactive: it lets itself out on the timer the provider already runs.
 */
/**
 * Cut a long message to something that fits the bar whole.
 *
 * Nothing is clipped mid-word by the browser: a message longer than the notice
 * can show is shortened here, at a word boundary, so what is displayed is always
 * a complete, readable phrase rather than a truncated one.
 */
function shorten(text, max) {
  const value = String(text ?? '').trim()
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.,;:]$/, '')}…`
}

function HeaderNotice({ toast }) {
  const variant = TOAST_VARIANTS[toast.variant] ?? TOAST_VARIANTS.info
  const Icon = variant.icon
  // Past this the message needs the smaller setting to be shown in full — the
  // approval notice is the one that sets the mark.
  const long = String(toast.message ?? '').length > 44
  return (
    <div
      // One fixed size for every kind of notice — welcome, approved, scanned,
      // deleted — so the bar never changes shape as the message changes, and the
      // card stays inside the account control's own space instead of growing
      // across the header. The width is the widest the account pill occupies.
      // The width follows the wording: a short notice stays small, a long one
      // grows towards the page title and stops just short of it. The cap is only
      // there to leave the page name legible, and because this is a flex item
      // beside the title rather than something over it, the title narrows but is
      // never covered.
      className={cx(
        'flex min-h-[44px] w-auto max-w-[78%] shrink items-center gap-2.5',
        'sm:max-w-[min(30rem,78%)]',
        'rounded-2xl px-3 py-1.5 ring-1 animate-slide-up',
        variant.edge,
      )}
      style={{ background: 'rgb(var(--surface-2))' }}
      role={toast.variant === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      // The full wording is always available, however much of it is shown.
      title={[toast.title, toast.message].filter(Boolean).join(' — ')}
    >
      <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full', variant.chip)}>
        <Icon className="h-4 w-4" />
      </span>
      {/* The title keeps its own line above the message, and the two together
          never exceed two lines — with a title the message takes one, without
          one it may take both. */}
      <div className="min-w-0 flex-1">
        {toast.title && (
          <p className="truncate text-[12.5px] font-bold leading-tight tracking-tight">
            {shorten(toast.title, 40)}
          </p>
        )}
        <p
          className={cx(
            toast.title ? 'muted mt-0.5 truncate text-[11.5px]' : 'line-clamp-2 font-semibold',
            toast.title ? 'leading-tight' : 'text-[12.5px] leading-snug',
          )}
        >
          {shorten(toast.message, toast.title ? 76 : 120)}
        </p>
      </div>
    </div>
  )
}
