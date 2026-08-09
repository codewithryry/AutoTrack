import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  QrCode,
  Settings as SettingsIcon,
  User as UserIcon,
  WifiOff,
  X,
} from 'lucide-react'
import { BrandLockup } from '../components/Brand'
import { MOBILE_NAV, NAV_ITEMS, visibleNavItems } from '../components/navigation'
import { useApp } from '../context/AppContext'
import { useNotifications } from '../hooks'
import { cx, initials } from '../utils/helpers'
import { APP_TAGLINE } from '../utils/constants'
import { PERM } from '../utils/permissions'

/**
 * Application shell.
 *
 * Desktop gets a fixed dark rail plus a sticky top bar; mobile gets a slide-in
 * drawer and a bottom bar with a raised scan button, which is the action a
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

  const navItems = visibleNavItems(can)
  const mobileItems = MOBILE_NAV.map((to) => NAV_ITEMS.find((item) => item.to === to)).filter(
    (item) => item && (!item.permission || can(item.permission)),
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
    NAV_ITEMS.find(
      (item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
    ) ?? null

  const handleLogout = () => {
    logout()
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
        <div className="px-4 py-4">
          <Link to="/dashboard" className="block rounded-lg">
            <BrandLockup />
          </Link>
          <p className="mt-2.5 pl-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-navy-400">
            {APP_TAGLINE}
          </p>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <SidebarLinks items={navItems} unread={unread} />
        </nav>

        <div className="border-t border-white/5 px-4 py-3">
          <p className="truncate text-[11px] font-semibold text-navy-300">{settings.labName}</p>
          <p className="truncate text-[10px] text-navy-500">{settings.labLocation}</p>
        </div>
      </aside>

      {/* ------------------------------ mobile drawer ----------------------------- */}
      {drawerOpen && (
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
        <header
          className="safe-top sticky top-0 z-20 border-b backdrop-blur"
          style={{ background: 'rgb(var(--surface) / 0.88)' }}
        >
          <div className="flex h-14 items-center gap-2 px-3 sm:h-16 sm:px-5">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="btn btn-ghost btn-icon lg:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-bold sm:text-base">
                {currentPage?.label ?? 'Smart Tool Monitoring'}
              </h1>
              <p className="subtle hidden truncate text-xs sm:block">
                {currentPage?.description ?? APP_TAGLINE}
              </p>
            </div>

            {!online && (
              <span
                className="badge border-orange-200 bg-orange-50 text-orange-700
                           dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300"
                title="You are offline. Records stay available on this device."
              >
                <WifiOff className="h-3 w-3" />
                <span className="hidden sm:inline">Offline</span>
              </span>
            )}

            <Link
              to="/scan"
              className="btn btn-primary btn-sm hidden sm:inline-flex"
              title="Scan a tool QR code"
            >
              <QrCode className="h-4 w-4" />
              Scan
            </Link>

            <Link
              to="/notifications"
              className="btn btn-ghost btn-icon relative"
              aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
            >
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span
                  className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center
                             rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Link>

            {/* profile menu */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors
                           hover:bg-black/5 dark:hover:bg-white/5"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-extrabold"
                  style={{ background: 'rgb(var(--rail))', color: 'rgb(var(--accent))' }}
                >
                  {initials(user?.fullName)}
                </span>
                <span className="hidden min-w-0 text-left md:block">
                  <span className="block max-w-[140px] truncate text-xs font-bold leading-tight">
                    {user?.fullName}
                  </span>
                  <span className="subtle block text-[10px] font-bold uppercase tracking-wider">
                    {user?.role}
                  </span>
                </span>
                <ChevronDown className="hidden h-4 w-4 shrink-0 md:block" />
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
                      @{user?.username} · {user?.role}
                    </p>
                    {user?.studentId && (
                      <p className="subtle mono mt-0.5 truncate text-xs">{user.studentId}</p>
                    )}
                  </div>
                  {can(PERM.USER_VIEW) && (
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
                  <Link
                    to="/settings"
                    className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium
                               transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    role="menuitem"
                  >
                    <SettingsIcon className="h-4 w-4" />
                    Settings
                  </Link>
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

        <main className="min-w-0 flex-1 px-3 pb-24 pt-4 sm:px-5 sm:pb-8 lg:pb-8">
          <Outlet />
        </main>
      </div>

      {/* ----------------------------- mobile bottom bar ---------------------------- */}
      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t lg:hidden"
        style={{ background: 'rgb(var(--surface))' }}
        aria-label="Primary"
      >
        <div className="grid grid-cols-5">
          {mobileItems.map((item) => {
            const Icon = item.icon
            if (item.primary) {
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="relative flex flex-col items-center justify-end pb-1.5 pt-1"
                  aria-label={item.label}
                >
                  <span
                    className="mb-0.5 grid h-12 w-12 -translate-y-3 place-items-center rounded-2xl
                               shadow-lift ring-4"
                    style={{
                      background: 'rgb(var(--accent))',
                      color: 'rgb(var(--accent-contrast))',
                      '--tw-ring-color': 'rgb(var(--surface))',
                    }}
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="-mt-3 text-[10px] font-bold">{item.label}</span>
                </NavLink>
              )
            }
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cx(
                    'relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-bold transition-colors',
                    isActive ? 'text-amberline-600 dark:text-amberline-400' : 'subtle',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      <Icon className="h-5 w-5" />
                      {item.to === '/notifications' && unread > 0 && (
                        <span className="absolute -right-1.5 -top-1 grid h-3.5 min-w-[14px] place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                          {unread > 9 ? '9+' : unread}
                        </span>
                      )}
                    </span>
                    <span className="max-w-full truncate px-0.5">{item.label}</span>
                    {isActive && (
                      <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-amberline-500" />
                    )}
                  </>
                )}
              </NavLink>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

function SidebarLinks({ items, unread, showDescriptions = false }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                cx(
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all',
                  isActive
                    ? 'bg-white/10 text-white'
                    : 'text-navy-300 hover:bg-white/5 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-amberline-400" />
                  )}
                  <Icon
                    className={cx(
                      'h-[18px] w-[18px] shrink-0 transition-colors',
                      isActive ? 'text-amberline-400' : 'text-navy-400 group-hover:text-amberline-400',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {item.label}
                    {showDescriptions && (
                      <span className="block text-[10px] font-medium text-navy-500">
                        {item.description}
                      </span>
                    )}
                  </span>
                  {item.to === '/notifications' && unread > 0 && (
                    <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
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
