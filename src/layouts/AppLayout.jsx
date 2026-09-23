import { createContext, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  Plus,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react'
import { AppearanceToggleButton } from '../components/AccountSettings'
import ErrorBoundary from '../components/ErrorBoundary'
import Avatar from '../components/Avatar'
import { PageLoading, RoleBadge } from '../components/ui'

import {
  ACCOUNT_NAV,
  accountNavLabel,
  EXTRA_PAGES,
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
 * may reach) and a bottom bar with a raised scan button, which is the action a
 * student standing at the tool crib actually needs.
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
  // TOBI's "Coming soon" pill, shown for a moment after a tap.
  const [tobiHint, setTobiHint] = useState(false)
  useEffect(() => {
    if (!tobiHint) return undefined
    const timer = setTimeout(() => setTobiHint(false), 2500)
    return () => clearTimeout(timer)
  }, [tobiHint])
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
  const navItems = visibleNavItems(user?.role, can)
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
    .map((to) => NAV_ITEMS.find((item) => item.to === to))
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
  const drawerItems = railItems.filter(
    (item) => !mobileRoutes.has(item.to) && !DRAWER_EXCLUDED.has(item.to),
  )

  // Close transient UI whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false)
    setMenuOpen(false)
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
      : (NAV_ITEMS.find((item) => location.pathname === item.to) ??
        NAV_ITEMS.find((item) => location.pathname.startsWith(`${item.to}/`)) ??
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
  const barIconSlot = studentBarExtra ? 'w-8 shrink-0' : 'w-10 shrink-0'

  // One bottom-bar slot, shared by both bars.
  const renderBarItem = (item) => {
    const Icon = item.icon
    // The scan button: about an eighth larger than a plain item, raised
    // just clear of the bar rather than floating away from it.
    if (item.primary) {
      // While an instructor is on the service log the raised slot carries
      // that page's own action instead — the same scheduler dialog the
      // page's button opens, reached through `?schedule=1`. Scan is not
      // renamed or removed: leaving /maintenance restores it.
      // The administrator's slot carries a page's own Add action where there is
      // one (a tool, a user, a service); elsewhere, like everyone's, it is Scan
      // or the page's "+".
      const action =
        (isAdmin && adminAddSlot ? { ...adminAddSlot, icon: Plus } : null) ??
        scheduleSlot ??
        messageSlot ??
        requestSlot ??
        item
      const ActionIcon = action.icon
      // Only Scan itself opens into a named pill; an Add or "+" is an action on
      // the page that is open, so it stays a circle.
      const namesItself = action === item
      if (studentModern) {
        return (
          <NavLink
            key={item.to}
            to={action.to}
            end
            aria-label={action.ariaLabel ?? action.label}
            className={({ isActive }) =>
              cx(
                'flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full shadow-lift',
                'text-[11px] font-bold tracking-tight transition-all active:scale-95',
                'motion-reduce:transition-none',
                // Pressed — its own page open — it opens into the named pill.
                isActive && namesItself ? 'flex-1 px-3' : barIconSlot,
              )
            }
            style={{ background: 'rgb(var(--accent))', color: 'rgb(var(--accent-contrast))' }}
          >
            {({ isActive }) => (
              <>
                <ActionIcon className="h-5 w-5 shrink-0" />
                {isActive && namesItself ? (
                  <span className="min-w-0 truncate">{action.label}</span>
                ) : (
                  <span className="sr-only">{action.label}</span>
                )}
              </>
            )}
          </NavLink>
        )
      }
      return (
        <NavLink
          key={item.to}
          to={action.to}
          className="flex flex-1 flex-col items-center justify-end gap-1 rounded-2xl px-1 pb-1"
          aria-label={action.ariaLabel ?? action.label}
        >
          <span
            className="grid h-[52px] w-[52px] -translate-y-3.5 place-items-center rounded-2xl
                       shadow-lift ring-[5px] transition-transform active:scale-95
                       motion-reduce:transition-none"
            style={{
              background: 'rgb(var(--accent))',
              color: 'rgb(var(--accent-contrast))',
              '--tw-ring-color': 'rgb(var(--surface))',
            }}
          >
            <ActionIcon className="h-[26px] w-[26px]" />
          </span>
          <span className="-mt-3.5 max-w-full truncate px-0.5 text-[10px] font-extrabold tracking-tight">
            {action.label}
          </span>
        </NavLink>
      )
    }
    if (studentModern) {
      return (
        <NavLink
          key={item.to}
          to={item.to}
          end={hasNestedNavMatch(item.to, location.pathname)}
          aria-label={item.label}
          className={({ isActive }) =>
            cx(
              'flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full transition-all',
              'text-[11px] font-bold tracking-tight',
              isActive ? 'flex-1 px-3' : barIconSlot,
            )
          }
          style={({ isActive }) =>
            // The current page is a white pill — the accent stays Scan's alone,
            // so the two never read as the same thing.
            isActive
              ? { background: 'rgb(var(--dock-fg))', color: 'rgb(11 18 32)' }
              : { color: 'rgb(var(--dock-fg) / 0.85)' }
          }
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
            {/* Pressed — the current page — it is named; the rest are icons. */}
            {isActive ? (
              <span className="min-w-0 truncate">{item.label}</span>
            ) : (
              <span className="sr-only">{item.label}</span>
            )}
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
  const studentBand = studentModern && location.pathname !== '/dashboard' && !onThread
  const chrome = useMemo(() => ({ setBare }), [])

  return (
    <ShellChromeContext.Provider value={chrome}>
    <div className="flex min-h-[100dvh] w-full">
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
            <nav className="grid grid-cols-3 gap-2.5">
              {drawerItems.map((item) => {
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
                    isStudent ? 'w-max min-w-[13rem]' : 'w-64',
                  )}
                  role="menu"
                >
                  {/* Who is signed in, with the one or two details that tell one
                      account from another — the role, and a student's own ID. */}
                  <div className="min-w-0 px-2.5 pb-2.5 pt-1.5">
                    <p className="truncate text-sm font-bold">{user?.fullName}</p>
                    {/* The same role badge the directory uses, so a colour means
                        the same thing wherever it appears: amber Admin, violet
                        Instructor, sky Student. */}
                    <div className="mt-1 flex min-w-0 items-center gap-1.5">
                      {user?.role && <RoleBadge role={user.role} />}
                      {user?.studentId && (
                        <span className="subtle truncate text-xs">{user.studentId}</span>
                      )}
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
                  {/* One block for both staff roles. There used to be three —
                      one keyed off the role and two off `USER_MANAGE` and
                      `SETTINGS_VIEW` — which an instructor now satisfies all of,
                      so the menu repeated their account and their settings. The
                      destinations and their guards are unchanged; only the
                      duplication is gone. */}
                  {!isStudent && (
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
                      {/* Staff reach Settings from the rail on desktop, so the
                          menu there is their account and their way out. On a
                          phone there is no rail, so this row is the way in —
                          `lg:hidden` is the whole difference, and it is the same
                          for an instructor and an administrator. */}
                      {can(PERM.SETTINGS_VIEW) && (
                        <Link
                          to="/settings"
                          className="flex min-h-[46px] items-center gap-3 rounded-xl px-2.5 py-1.5
                                     transition-colors hover:bg-black/5 dark:hover:bg-white/5 lg:hidden"
                          role="menuitem"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                            Settings
                          </span>
                        </Link>
                      )}
                    </>
                  )}
                  <div className="my-1.5 border-t" />
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
            !bare && !onThread && 'shell-main-pad',
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
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
          </div>
        </main>
      </div>

      {/* ----------------------------- mobile bottom bar ----------------------------
          A floating bar: it sits clear of the bottom edge with the iOS/Android
          safe-area inset added underneath, so the home indicator never crowds it.
          The surface is solid — no blur and no translucency — so the cards
          scrolling past behind it never show through and the labels stay legible.
          Same items, same routes, same badge as before. */}
      {/* The gap is an offset on the fixed element rather than padding inside
          it, so the bar's own box ends where it is drawn: nothing invisible
          hangs below it, and it cannot be pushed under the gesture bar.
          `max()` rather than a sum — a phone that reports a 34px inset already
          has its clearance, and a phone that reports none still gets a full
          1rem — so the bar sits the same distance clear of the edge on every
          device instead of doubling up on the ones with a home indicator. */}
      {!bare && !onThread && (
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
        {/* A translucent grey glass pill, for every role: icons, with the
            pressed one — the current page — opened into a named pill (white;
            Scan's is the accent). Staff keep their Menu slot at the end of it.
            The assistant is its own round button beside the bar. */}
        <div className="mx-auto flex max-w-md items-center gap-2">
        <nav
          className={cx(
            'flex min-w-0 flex-1 shadow-panel',
            'items-center gap-0.5 rounded-full px-1.5 py-1.5 ring-1 ring-white/15 backdrop-blur-xl',
          )}
          style={{ background: 'rgb(var(--dock-bg) / 0.78)' }}
          aria-label="Primary"
        >
          {barItems.map(renderBarItem)}
          {/* Staff's last slot opens the menu panel rather than navigating: the
              drawer carries the rest of their destinations. */}
          {hasDrawer && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={cx('grid h-11 place-items-center rounded-full transition-colors', barIconSlot)}
              style={{ color: 'rgb(var(--dock-fg) / 0.85)' }}
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
            >
              <Menu className="h-5 w-5" strokeWidth={2} />
            </button>
          )}
        </nav>
        {studentModern && (
          // TOBI, the AI assistant — not connected yet. Nothing opens: a tap
          // widens it into a pill that says so, the way a pressed page widens
          // into its name, and it folds back on its own a moment later.
          <button
            type="button"
            onClick={() => setTobiHint(true)}
            aria-label="TOBI, the AI assistant — coming soon"
            className={cx(
              'relative flex h-[52px] shrink-0 items-center justify-center gap-1.5 rounded-full',
              'ring-2 ring-white/40 transition-all duration-300 motion-reduce:transition-none',
              tobiHint ? 'px-4' : 'w-[52px]',
            )}
            // TOBI's own mark: a bright amber gradient with a warm glow — the
            // brand's yellow, but not the flat accent Scan wears.
            style={{
              background: 'linear-gradient(135deg, #fde68a 0%, #F7C948 45%, #DE911D 100%)',
              color: 'rgb(var(--accent-contrast))',
              boxShadow: '0 8px 24px -6px rgb(222 145 29 / 0.6)',
            }}
          >
            <Sparkles className="h-6 w-6 shrink-0" />
            {tobiHint && (
              <span className="whitespace-nowrap text-[11px] font-bold" role="status">
                Coming soon
              </span>
            )}
          </button>
        )}
        </div>
      </div>
      )}
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
