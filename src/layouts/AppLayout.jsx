import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  User as UserIcon,
  WifiOff,
  X,
} from 'lucide-react'
import { BrandLockup } from '../components/Brand'
import {
  ACCOUNT_NAV,
  accountNavLabel,
  MOBILE_NAV,
  NAV_ITEMS,
  visibleNavItems,
} from '../components/navigation'
import { useApp } from '../context/AppContext'
import { useNotifications } from '../hooks'
import { cx, initials } from '../utils/helpers'
import { APP_TAGLINE, ROLE } from '../utils/constants'
import { PERM } from '../utils/permissions'

/**
 * Application shell.
 *
 * Desktop gets a fixed dark rail plus a sticky top bar; mobile gets a slide-in
 * drawer (staff only — a student's bottom bar already carries every route they
 * may reach) and a bottom bar with a raised scan button, which is the action a
 * student standing at the tool crib actually needs.
 */
export default function AppLayout() {
  const { user, logout, can, online, settings } = useApp()
  const { unread } = useNotifications()
  const location = useLocation()
  const navigate = useNavigate()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Students never open the drawer: their bottom bar already carries everything
  // they may reach, so a hamburger would only duplicate it. Staff keep it, since
  // the bottom bar omits their maintenance, user, report and settings routes.
  const isStudent = user?.role === ROLE.STUDENT

  // One navigation definition, filtered by the authenticated user's stored
  // role — the sidebar, the drawer and the bottom bar all read from it.
  const navItems = visibleNavItems(user?.role, can)
  const allowed = new Set(navItems.map((item) => item.to))
  const mobileItems = MOBILE_NAV.map((to) => NAV_ITEMS.find((item) => item.to === to)).filter(
    (item) => item && allowed.has(item.to),
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
      : (NAV_ITEMS.find(
          (item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
        ) ?? null)

  const handleLogout = async () => {
    // Clears the session and every scoped listener with it.
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-[100dvh] w-full">
      {/* ------------------------------ desktop rail ------------------------------ */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col lg:flex"
        style={{ background: 'rgb(var(--rail))' }}
      >
        <div className="hazard-stripe h-1 w-full shrink-0" />
        <div className="px-5 pb-4 pt-5">
          <Link to="/dashboard" className="block rounded-lg">
            <BrandLockup />
          </Link>
          {/* Tracked just far enough to read as a strapline, and no further: at
              0.22em it broke onto a ragged second line inside the 248px rail. */}
          <p className="mt-2.5 pl-0.5 text-[9.5px] font-bold uppercase leading-relaxed tracking-[0.13em] text-navy-500">
            {APP_TAGLINE}
          </p>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <SidebarLinks items={navItems} unread={unread} />
        </nav>

        <div className="px-5 pb-4 pt-3" style={{ borderTop: '1px solid rgb(255 255 255 / 0.06)' }}>
          <p className="truncate text-[11px] font-semibold text-navy-300">{settings.labName}</p>
          <p className="truncate text-[10px] text-navy-500">{settings.labLocation}</p>
        </div>
      </aside>

      {/* ------------------------------ mobile drawer ----------------------------- */}
      {!isStudent && drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-navy-950/70 backdrop-blur-sm animate-fade-in"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-[82vw] max-w-[300px] flex-col
                       shadow-panel animate-slide-in-right"
            style={{ background: 'rgb(var(--rail))' }}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            <div className="hazard-stripe h-1 w-full shrink-0" />
            <div className="flex items-center justify-between px-4 py-4">
              <BrandLockup />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-lg text-navy-300
                           transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
              <SidebarLinks items={navItems} unread={unread} showDescriptions />
            </nav>
            <div className="safe-bottom border-t border-white/5 px-4 py-3">
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm
                           font-semibold text-red-300 transition-colors hover:bg-red-500/10"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* --------------------------------- main ---------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-[248px]">
        {/* The bar carries three things and no more: the way back to navigation
            on a phone, where you are, and who you are. There is no notification
            control here — Notifications is a first-class destination in the rail
            and in the bottom bar, and a bell would be a third route to it.
            One height at every width (56px): the old 64px desktop bar was mostly
            empty, and the page's own hero is what should own the space below. */}
        <header
          className="safe-top sticky top-0 z-20 border-b backdrop-blur"
          style={{
            background: 'rgb(var(--surface) / 0.85)',
            borderColor: 'rgb(var(--border) / 0.7)',
          }}
        >
          <div className="flex h-14 items-center gap-2 px-3 sm:px-5 lg:px-8">
            {/* The menu is the one navigation control in the bar, and only where
                the bottom bar does not already carry every route — staff on a
                phone. Students read the title, everybody gets the avatar. */}
            {!isStudent && (
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="btn btn-ghost btn-icon lg:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="h-5 w-5" />
              </button>
            )}

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-bold tracking-tight">
                {currentPage?.label ?? 'ToolTrack AutoLab'}
              </h1>
            </div>

            {/* profile menu */}
            <div className="relative shrink-0" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className={cx(
                  'flex items-center gap-2 rounded-xl py-1 pl-1 pr-1.5 transition-colors',
                  menuOpen
                    ? 'bg-black/5 dark:bg-white/5'
                    : 'hover:bg-black/5 dark:hover:bg-white/5',
                )}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm
                             font-extrabold ring-1 ring-black/5 dark:ring-white/10"
                  style={{ background: 'rgb(var(--rail))', color: 'rgb(var(--accent))' }}
                >
                  {initials(user?.fullName)}
                </span>
                <span className="hidden min-w-0 text-left sm:block">
                  <span className="block max-w-[140px] truncate text-xs font-bold leading-tight">
                    {user?.fullName}
                  </span>
                  <span className="subtle block text-[10px] font-bold uppercase tracking-wider">
                    {user?.role}
                  </span>
                </span>
                <ChevronDown
                  className={cx(
                    'hidden h-4 w-4 shrink-0 text-navy-400 transition-transform duration-200 sm:block',
                    menuOpen && 'rotate-180',
                  )}
                />
              </button>

              {menuOpen && (
                <div
                  className="card absolute right-0 top-full z-30 mt-2 w-60 overflow-hidden
                             p-1 shadow-panel animate-slide-up"
                  role="menu"
                >
                  <div className="border-b px-3 py-2.5">
                    <p className="truncate text-sm font-bold">{user?.fullName}</p>
                    <p className="subtle truncate text-xs">
                      {user?.email} · {user?.role}
                    </p>
                    {user?.studentId && (
                      <p className="subtle mono mt-0.5 truncate text-xs">{user.studentId}</p>
                    )}
                    {!online && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-orange-600 dark:text-orange-300">
                        <WifiOff className="h-3.5 w-3.5 shrink-0" />
                        Offline — changes sync when the connection returns
                      </p>
                    )}
                  </div>
                  {user?.role === ROLE.STUDENT && (
                    <>
                      <Link
                        to="/profile"
                        className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium
                                   transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        role="menuitem"
                      >
                        <UserIcon className="h-4 w-4" />
                        Profile
                      </Link>
                      {/* A student cannot open the laboratory Settings page — that
                          stays with the administrators — so their Settings entry
                          goes to the preferences on their own account page. */}
                      <Link
                        to="/profile#settings"
                        className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium
                                   transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        role="menuitem"
                      >
                        <SettingsIcon className="h-4 w-4" />
                        Settings
                      </Link>
                    </>
                  )}
                  {can(PERM.USER_MANAGE) && (
                    <Link
                      to="/users"
                      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium
                                 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                      role="menuitem"
                    >
                      <UserIcon className="h-4 w-4" />
                      User directory
                    </Link>
                  )}
                  {can(PERM.SETTINGS_VIEW) && (
                    <Link
                      to="/settings"
                      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium
                                 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                      role="menuitem"
                    >
                      <SettingsIcon className="h-4 w-4" />
                      Settings
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm
                               font-semibold text-red-600 transition-colors hover:bg-red-500/10
                               dark:text-red-400"
                    role="menuitem"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* More room to breathe from `lg`, where the rail takes over navigation
            and the page no longer competes with a bottom bar. */}
        <main className="min-w-0 flex-1 px-3 pb-28 pt-4 sm:px-5 lg:px-8 lg:pb-12 lg:pt-6">
          <Outlet />
        </main>
      </div>

      {/* ----------------------------- mobile bottom bar ----------------------------
          A floating bar: it sits clear of the bottom edge with the iOS/Android
          safe-area inset added underneath, so the home indicator never crowds it.
          The surface is solid — no blur and no translucency — so the cards
          scrolling past behind it never show through and the labels stay legible.
          Same items, same routes, same badge as before. */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 px-3 pb-3 lg:hidden"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
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
            if (item.primary) {
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="flex flex-1 flex-col items-center justify-end gap-1 rounded-2xl px-1 pb-1"
                  aria-label={item.label}
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
                    <Icon className="h-[26px] w-[26px]" />
                  </span>
                  <span className="-mt-3.5 text-[10px] font-extrabold tracking-tight">
                    {item.label}
                  </span>
                </NavLink>
              )
            }
            return (
              <NavLink
                key={item.to}
                to={item.to}
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
                      <Icon className={cx('h-[22px] w-[22px]', isActive && 'stroke-[2.4]')} />
                      {item.to === '/notifications' && unread > 0 && (
                        <span
                          className="absolute right-1.5 top-0.5 grid h-3.5 min-w-[14px]
                                     place-items-center rounded-full bg-red-500 px-1 text-[9px]
                                     font-bold text-white"
                        >
                          {unread > 9 ? '9+' : unread}
                        </span>
                      )}
                    </span>
                    <span className="max-w-full truncate px-0.5">{item.label}</span>
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>
      </div>
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
function SidebarLinks({ items, unread, showDescriptions = false }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                cx(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5',
                  'text-[13.5px] tracking-tight transition-colors duration-150',
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
                  {item.to === '/notifications' && unread > 0 && (
                    <span className="grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                      {unread > 99 ? '99+' : unread}
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
