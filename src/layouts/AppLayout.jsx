import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  ChevronDown,
  ExternalLink,
  Globe,
  LogOut,
  Menu,
  Plus,
  Settings as SettingsIcon,
  User as UserIcon,
  WifiOff,
  X,
} from 'lucide-react'
import { AppearanceToggleButton } from '../components/AccountSettings'
import { BrandLockup } from '../components/Brand'
import ErrorBoundary from '../components/ErrorBoundary'
import Avatar from '../components/Avatar'
import {
  ACCOUNT_NAV,
  accountNavLabel,
  ADMIN_DRAWER_NAV,
  EXTRA_PAGES,
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
  useRequests,
  useTransactions,
} from '../hooks'
import { cx } from '../utils/helpers'
import * as txnService from '../services/transactions'
import { ACTIVE_TXN_STATUSES, APP_TAGLINE, REQUEST_STATUS, ROLE } from '../utils/constants'
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
  // Presence is announced for as long as the app is open, not only while the
  // inbox is on screen — otherwise a signed-in account reads as offline to
  // everyone until it happens to be looking at its own messages. The channel is
  // shared, so the inbox's own `usePresence` joins the same one.
  usePresence()
  const location = useLocation()
  const navigate = useNavigate()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const isStudent = user?.role === ROLE.STUDENT
  // The tool-crib role. Every branch keyed off this leaves the Admin and Student
  // shells on exactly the path they were on before.
  const isInstructor = user?.role === ROLE.INSTRUCTOR
  const isAdmin = user?.role === ROLE.ADMIN

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

  // One navigation definition, filtered by the authenticated user's stored
  // role — the sidebar, the drawer and the bottom bar all read from it.
  const navItems = visibleNavItems(user?.role, can)
  const allowed = new Set(navItems.map((item) => item.to))
  // An instructor's rail is the same permitted set, reordered for the crib and
  // with the counter actions lifted into their own block; every other role gets
  // the list untouched.
  const railItems = isInstructor
    ? instructorRailItems(navItems)
    : isStudent
      ? studentRailItems(navItems)
      : navItems
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

  // The administrator's drawer is the five places it names, in that order, and
  // only the ones their permissions already allow.
  const adminDrawerItems = ADMIN_DRAWER_NAV.map((to) =>
    navItems.find((item) => item.to === to),
  ).filter(Boolean)

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
      : (NAV_ITEMS.find(
          (item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
        ) ??
        // An instructor works from routes that were never rail items — Borrow and
        // Return, which they reach from the hero and the scan result — so the bar can
        // still name the page instead of falling back to the product name.
        EXTRA_PAGES.find((page) => location.pathname === page.to) ??
        (isInstructor
          ? (INSTRUCTOR_EXTRA_PAGES.find((page) => location.pathname === page.to) ?? null)
          : null))

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
        {/* A student's rail carries six destinations rather than the staff
            eleven, so it can afford the room: a little more air under the
            lockup and a rule closing the brand block off from the list. The
            staff rail keeps its denser spacing. */}
        <div
          className={cx('px-5 pt-5', isStudent ? 'pb-5' : 'pb-4')}
          style={isStudent ? { borderBottom: '1px solid rgb(255 255 255 / 0.06)' } : undefined}
        >
          <Link to="/dashboard" className="block rounded-lg">
            <BrandLockup />
          </Link>
          {/* Tracked just far enough to read as a strapline, and no further: at
              0.22em it broke onto a ragged second line inside the 248px rail. */}
          <p className="mt-2.5 pl-0.5 text-[9.5px] font-bold uppercase leading-relaxed tracking-[0.13em] text-navy-500">
            {APP_TAGLINE}
          </p>
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
            spacious={isStudent}
          />
        </nav>

        {/* A student's navigation is the rail on desktop and the bottom bar on a
            phone, so the department's own page — its Facebook page or external
            site — is the one extra stop worth adding, and only when the
            administrator has configured an address. */}
        {isStudent && settings.departmentUrl && (
          <div
            className="px-3 py-2.5"
            style={{ borderTop: '1px solid rgb(255 255 255 / 0.06)' }}
          >
            <a
              href={settings.departmentUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold
                         text-navy-300 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              <Globe className="h-[18px] w-[18px] shrink-0 text-navy-400" />
              <span className="min-w-0 flex-1 truncate">Department page</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-navy-500" />
            </a>
          </div>
        )}

        <div className="px-5 pb-4 pt-3" style={{ borderTop: '1px solid rgb(255 255 255 / 0.06)' }}>
          <p className="truncate text-[11px] font-semibold text-navy-300">{settings.labName}</p>
          <p className="truncate text-[10px] text-navy-500">{settings.labLocation}</p>
        </div>
      </aside>
      )}

      {/* ------------------------------ mobile drawer ----------------------------- */}
      {/* Administrators only — they alone have more destinations than a bottom
          bar holds, and they open this from the bar's own Menu slot. A student's
          and an instructor's bottom bar carries every route they have, so
          neither has a drawer to open. */}
      {!bare && drawerOpen && isAdmin && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-navy-950/70 animate-fade-in"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          {/* The administrator's menu: one panel carrying the five destinations
               and nothing else. Alerts are the bell in the top bar and account
               actions — Sign out included — are the account dropdown beside it,
               so neither is repeated here.

               Painted from the surface tokens rather than a hardcoded white:
               the panel used to stay light while the rest of the app went dark,
               which is the one place in the shell the theme did not reach. */}
            <aside
              className="safe-top absolute inset-y-0 left-0 flex w-[78vw] max-w-[288px] flex-col
                         shadow-panel animate-slide-in-right"
              // The panel runs the full height of the window, so its own header
              // has to start below the status bar rather than under it. The
              // surface carries on into the inset; only the content moves down.
              style={{ paddingLeft: 'var(--sal)', background: 'rgb(var(--surface))' }}
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
            >
              <div className="flex items-center justify-between border-b px-4 py-4">
                <p className="subtle text-[11px] font-bold uppercase tracking-[0.16em]">Menu</p>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-lg subtle transition-colors
                             hover:bg-black/5 dark:hover:bg-white/5"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {/* `pb-[max(…)]`, not `.safe-bottom` + `p-3`: the helper is a
                  components-layer rule and `p-3` a utility, so the utility won
                  and the drawer's last row sat under the gesture bar. */}
              <nav className="min-h-0 flex-1 overflow-y-auto p-3 pb-[max(0.75rem,var(--sab))]">
                <ul className="space-y-1">
                  {adminDrawerItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          className={({ isActive }) =>
                            cx(
                              'flex items-center gap-3 rounded-xl px-3 py-3 text-[14px] tracking-tight',
                              'transition-colors duration-150',
                              isActive
                                ? 'bg-black/[0.05] font-bold dark:bg-white/[0.07]'
                                : 'muted font-semibold hover:bg-black/[0.035] dark:hover:bg-white/5',
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <span className="grid w-5 shrink-0 place-items-center">
                                <Icon
                                  strokeWidth={2}
                                  className={cx(
                                    'h-[18px] w-[18px]',
                                    isActive
                                      ? 'text-amberline-600 dark:text-amberline-400'
                                      : 'opacity-60',
                                  )}
                                />
                              </span>
                              <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            </>
                          )}
                        </NavLink>
                      </li>
                    )
                  })}
                </ul>
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
          className="safe-top sticky top-0 z-40 border-b"
          style={{
            // Solid rather than translucent: with no blur behind it, the page
            // scrolling past would otherwise show through the bar.
            background: 'rgb(var(--surface))',
            borderColor: 'rgb(var(--border) / 0.7)',
          }}
        >
          {/* A little more room from the edge on a phone than the page below
              takes, so the title and the avatar are not pressed against the
              screen. The wider breakpoints are unchanged. */}
          <div className="flex h-14 items-center gap-2 px-4 sm:px-5 lg:px-8">
            {/* No navigation control lives in the bar for any role: an
                administrator opens their drawer from the Menu slot in the bottom
                bar, and an instructor's and a student's bottom bar already
                carries every route they have. The bar is the title, the bell and
                the account pill. */}

            {/* The page name on its own: no glyph, no figure, no tile — the
                account pill opposite is the only shape in the row. */}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-extrabold tracking-tight">
                {currentPage?.label ?? 'ToolTrack AutoLab'}
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
                    <p className="subtle mt-0.5 truncate text-xs">
                      {user?.role}
                      {user?.studentId ? ` · ${user.studentId}` : ''}
                    </p>
                  </div>
                  {!online && (
                    <p className="mx-1 mb-1.5 flex items-center gap-1.5 rounded-lg bg-orange-500/10 px-2.5 py-2 text-[11px] font-semibold leading-snug text-orange-600 dark:text-orange-300">
                      <WifiOff className="h-3.5 w-3.5 shrink-0" />
                      Offline — changes sync when the connection returns
                    </p>
                  )}
                  <div className="mb-1.5 border-t" />
                  {user?.role === ROLE.STUDENT && (
                    <>
                      <Link
                        to="/profile"
                        className="flex min-h-[42px] items-center gap-3 rounded-lg px-2.5 text-sm
                                   font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        role="menuitem"
                      >
                        <UserIcon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">Profile</span>
                      </Link>
                      {/* The Settings page shows a student their own preferences;
                          the laboratory configuration inside it stays with the
                          administrators. */}
                      <Link
                        to="/settings"
                        className="flex min-h-[42px] items-center gap-3 rounded-lg px-2.5 text-sm
                                   font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        role="menuitem"
                      >
                        <SettingsIcon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">Settings</span>
                      </Link>
                      {/* The student menu's one external stop: the department's
                          own page, when the administrator has set an address. */}
                      {settings.departmentUrl && (
                        <a
                          href={settings.departmentUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex min-h-[42px] items-center gap-3 rounded-lg px-2.5 text-sm font-semibold
                                     transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                          role="menuitem"
                        >
                          <Globe className="h-4 w-4" />
                          Department page
                          <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-50" />
                        </a>
                      )}
                    </>
                  )}
                  {/* An instructor had no route to their own account anywhere in
                      the shell: this menu offered them Sign out and nothing
                      else, and /profile was reachable only by typing it. They
                      get the same two entries a student has — their profile and
                      their own preferences — and nothing from user management,
                      which stays an administrator's. */}
                  {isInstructor && (
                    <>
                      <Link
                        to="/profile"
                        className="flex min-h-[42px] items-center gap-3 rounded-lg px-2.5 text-sm
                                   font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        role="menuitem"
                      >
                        <UserIcon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">My account</span>
                      </Link>
                      <Link
                        to="/settings"
                        className="flex min-h-[42px] items-center gap-3 rounded-lg px-2.5 text-sm
                                   font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        role="menuitem"
                      >
                        <SettingsIcon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">Settings</span>
                      </Link>
                    </>
                  )}
                  {/* The directory has its own rail entry — this menu is the
                      account's own, so an administrator gets their profile here
                      the way a student and an instructor do. */}
                  {can(PERM.USER_MANAGE) && (
                    <Link
                      to="/profile"
                      className="flex min-h-[42px] items-center gap-3 rounded-lg px-2.5 text-sm font-semibold
                                 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                      role="menuitem"
                    >
                      <UserIcon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">Profile</span>
                    </Link>
                  )}
                  {can(PERM.SETTINGS_VIEW) && (
                    <Link
                      to="/settings"
                      className="flex min-h-[42px] items-center gap-3 rounded-lg px-2.5 text-sm font-semibold
                                 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                      role="menuitem"
                    >
                      <SettingsIcon className="h-4 w-4" />
                      Settings
                    </Link>
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
          )}
        >
          {/* Keyed on the path so navigating away from a failed page clears
              the error rather than sticking on it. */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
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
        <nav
          className="mx-auto flex max-w-md items-stretch rounded-[22px] border px-1.5 py-1.5 shadow-panel"
          style={{ background: 'rgb(var(--surface))' }}
          aria-label="Primary"
        >
          {mobileItems.map((item) => {
            const Icon = item.icon
            // The scan button: about an eighth larger than a plain item, raised
            // just clear of the bar rather than floating away from it.
            if (item.primary && isAdmin && adminAddSlot) {
              // The administrator's raised slot on a page that has something to
              // add: the same shape as the scan button, carrying that page's own
              // Add action. Everywhere else the slot stays Scan.
              return (
                <Link
                  key={item.to}
                  to={adminAddSlot.to}
                  className="flex flex-1 flex-col items-center justify-end gap-1 rounded-2xl px-1 pb-1"
                  aria-label={adminAddSlot.ariaLabel}
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
                    <Plus className="h-[26px] w-[26px]" />
                  </span>
                  <span className="-mt-3.5 max-w-full truncate px-0.5 text-[10px] font-extrabold tracking-tight">
                    {adminAddSlot.label}
                  </span>
                </Link>
              )
            }
            if (item.primary) {
              // While an instructor is on the service log the raised slot carries
              // that page's own action instead — the same scheduler dialog the
              // page's button opens, reached through `?schedule=1`. Scan is not
              // renamed or removed: leaving /maintenance restores it.
              const action = scheduleSlot ?? messageSlot ?? requestSlot ?? item
              const ActionIcon = action.icon
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
            return (
              <NavLink
                key={item.to}
                to={item.to}
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
          })}
          {/* The administrator's last slot opens the menu panel rather than
              navigating: the drawer carries the rest of their destinations. */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex flex-1 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px]
                         font-bold tracking-tight subtle transition-colors"
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
            >
              <span className="grid h-8 w-12 place-items-center rounded-xl">
                <Menu className="h-[22px] w-[22px]" strokeWidth={2} />
              </span>
              <span className="max-w-full truncate px-0.5">Menu</span>
            </button>
          )}
        </nav>
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
  showDescriptions = false,
  spacious = false,
}) {
  // Three rails carry a count: alerts, unread messages and open requests. Same
  // badge, same rules.
  const badgeFor = (to) =>
    to === '/notifications'
      ? unread
      : to === '/messages'
        ? messageUnread
        : to === '/requests'
          ? requestCount
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
