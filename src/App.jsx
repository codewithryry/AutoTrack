import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AlertTriangle, ShieldOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppLayout, { useStandalonePage } from './layouts/AppLayout'
import InstallPrompt from './components/InstallPrompt'
import { BrandMark } from './components/Brand'
import { ErrorState } from './components/ui'
import { useApp } from './context/AppContext'
import { PERM } from './utils/permissions'
import { APP_VERSION } from './utils/constants'
import { claimAppLaunch } from './utils/pwa'

import LoginPage from './pages/LoginPage'
import SignUpPage from './pages/SignUpPage'
import DashboardPage from './pages/DashboardPage'
import ToolsPage from './pages/ToolsPage'
import ToolDetailPage from './pages/ToolDetailPage'
import ToolHistoryPage from './pages/ToolHistoryPage'
import ScanPage from './pages/ScanPage'
import BorrowPage from './pages/BorrowPage'
import ReturnPage from './pages/ReturnPage'
import TransactionsPage from './pages/TransactionsPage'
import UsersPage from './pages/UsersPage'
import ActivityPage from './pages/ActivityPage'
import NotificationsPage from './pages/NotificationsPage'
import MaintenancePage from './pages/MaintenancePage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import ProfilePage from './pages/ProfilePage'
import RequestsPage from './pages/RequestsPage'
import NewRequestPage from './pages/NewRequestPage'
import RequestDetailPage from './pages/RequestDetailPage'
import MessagesPage from './pages/MessagesPage'

/**
 * Blocks unauthenticated access and remembers where the user was heading.
 *
 * By the time this renders, the stored session has already been read to see whether it was
 * restored (the shell holds routing on the page skeleton until then), so there is no window
 * in which a signed-in user is bounced to the login page on refresh.
 */
function RequireAuth({ children }) {
  const { isAuthenticated } = useApp()
  const location = useLocation()
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}

/**
 * Route-level role guard.
 *
 * Typing `/users` as a student lands here, not on the page. This is one of three
 * layers: the sidebar hides the link, this guard refuses the route, the service
 * layer refuses the call — and the data layer scopes the records regardless.
 */
function RequirePermission({ permission, children }) {
  const { can } = useApp()
  if (!can(permission)) return <NoAccess />
  return children
}

function NoAccess() {
  const { user } = useApp()
  // A dead end: the shell drops its rail, top bar and bottom bar for it.
  useStandalonePage()
  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-red-500/10">
        <ShieldOff className="h-7 w-7 text-red-500" />
      </span>
      <h2 className="text-lg font-extrabold">Restricted area</h2>
      <p className="muted mt-2 max-w-sm text-sm">
        {user?.role ? `The ${user.role} role does not` : 'Your role does not'} have access to this
        section of the laboratory system. Contact the laboratory administrator if you believe this
        is a mistake.
      </p>
      <Link to="/dashboard" className="btn btn-primary mt-5">
        Back to dashboard
      </Link>
    </div>
  )
}

function NotFound() {
  useStandalonePage()
  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-amberline-400/15">
        <AlertTriangle className="h-7 w-7 text-amberline-600 dark:text-amberline-400" />
      </span>
      <h2 className="text-lg font-extrabold">Page not found</h2>
      <p className="muted mt-2 max-w-sm text-sm">
        That page does not exist in the tool monitoring system.
      </p>
      <Link to="/" className="subtle mt-3 text-xs font-bold uppercase tracking-wider hover:underline">
        Public homepage
      </Link>
      <Link to="/dashboard" className="btn btn-primary mt-5">
        Back to dashboard
      </Link>
    </div>
  )
}

/**
 * The PWA's opening screen, shown while the stored session is read.
 *
 * It is a real splash rather than a page skeleton: the same navy the system
 * launch screen paints (`#0B1220` in the manifest) so the hand-over from the
 * OS splash to the first frame is one continuous colour, with the brand mark,
 * the lockup, the version and a quiet footer centred like a modern app launch
 * screen. It lasts exactly as long as reading the session takes and is drawn
 * in plain markup — no images to load and no timers — so it adds nothing to
 * the boot path.
 */
function BootSplash() {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6"
      style={{ background: 'rgb(11 18 32)' }}
      role="status"
      aria-busy="true"
    >
      <div className="flex flex-col items-center text-center">
        <BrandMark size={76} className="rounded-2xl shadow-lift" />
        <p className="mt-5 text-[19px] font-extrabold uppercase tracking-wide text-white">
          Smart Tool
        </p>
        <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-amberline-400">
          Monitoring System
        </p>
        <p className="mt-4 text-xs font-semibold text-navy-300">Version {APP_VERSION}</p>
      </div>
    </div>
  )
}

/**
 * Whether this document is the installed app opening.
 *
 * Resolved once when the module is evaluated — that is once per document, so it
 * survives every remount of `App` and every in-app navigation, and a refresh
 * re-evaluates it against the same app session and gets `false`. A browser tab
 * is never a launch.
 */
const IS_APP_LAUNCH = claimAppLaunch()

export default function App() {
  const { booting, bootError, retryBoot, continueWithoutBoot, isAuthenticated } = useApp()

  // A boot that failed outright: the records or the stored session could not be
  // read, so there is nothing to route to yet. The ordinary error state carries
  // the retry — and "Continue anyway" enters the app without the stored session.
  if (bootError) {
    return (
      <div className="min-w-0 px-3 pb-28 pt-4 sm:px-5 lg:pb-8">
        <div className="card mx-auto max-w-lg">
          <ErrorState
            title="Unable to start"
            description={bootError}
            onRetry={retryBoot}
          />
          <div className="border-t px-6 pb-5 pt-4 text-center">
            <button type="button" onClick={continueWithoutBoot} className="btn btn-ghost">
              Continue anyway
            </button>
            <p className="subtle mt-2 text-xs leading-relaxed">
              A blocked browser-storage setting can also prevent the session from being restored.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Routing is still held until the stored session has been read — that is what
  // stops a refresh bouncing a signed-in user to the login page. The opening
  // screen is only drawn over that wait when the installed app is actually
  // opening; a refresh, an in-app navigation or a browser tab waits on the
  // manifest's own background colour instead.
  if (booting) return IS_APP_LAUNCH ? <BootSplash /> : null

  return (
    <>
      <Routes>
        {/* ------------------------------ public ------------------------------ */}
        {/* The landing page is hidden for now: `/` is the login screen, in a
            browser tab and in the installed app alike. `pages/HomePage.jsx` is
            kept and unmodified — restoring it is putting the element back here.
            An already-signed-in visitor is bounced on to the dashboard by the
            /login route below, so this single redirect serves both cases. */}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
        />
        <Route
          path="/signup"
          element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <SignUpPage />}
        />

        {/* ---------------------------- protected ---------------------------- */}
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          {/* Your own account. No permission gate: everyone has a profile. */}
          <Route path="/profile" element={<ProfilePage />} />

          <Route
            path="/tools"
            element={
              <RequirePermission permission={PERM.TOOL_VIEW}>
                <ToolsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/tools/:id"
            element={
              <RequirePermission permission={PERM.TOOL_VIEW}>
                <ToolDetailPage />
              </RequirePermission>
            }
          />
          {/* One tool's borrowing history, opened from that tool's record.
              Whoever may read the tool may open it: the page itself is already
              scoped by role — staff get the laboratory's activity timeline, a
              student only their own borrowings of this tool, through the same
              policies and the same `visibleTransactions` filter as everywhere
              else. No permission changes. */}
          <Route
            path="/tools/:id/history"
            element={
              <RequirePermission permission={PERM.TOOL_VIEW}>
                <ToolHistoryPage />
              </RequirePermission>
            }
          />

          <Route path="/scan" element={<ScanPage />} />
          {/* The crib's counter: issuing a tool to somebody, and the approved
              requests waiting to be released. Staff only — a student's own
              borrowing runs through /requests, which is where their one ask
              lives from Pending to Approved to checked out. */}
          <Route
            path="/borrow"
            element={
              <RequirePermission permission={PERM.BORROW_FOR_OTHERS}>
                <BorrowPage />
              </RequirePermission>
            }
          />
          <Route
            path="/return"
            element={
              <RequirePermission permission={PERM.RETURN}>
                <ReturnPage />
              </RequirePermission>
            }
          />

          {/* Scoped by role in the data layer: a student's query only ever
              returns their own transactions. */}
          <Route path="/transactions" element={<TransactionsPage />} />

          {/* One Requests page for everybody, scoped by role in the data layer:
              staff work the queue of everyone's asks, a student sees their own
              and their states. `/requests/new` is the single place a borrowing
              request is created, for either. */}
          <Route
            path="/requests"
            element={
              <RequirePermission permission={PERM.REQUEST_CREATE}>
                <RequestsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/requests/new"
            element={
              <RequirePermission permission={PERM.REQUEST_CREATE}>
                <NewRequestPage />
              </RequirePermission>
            }
          />
          <Route path="/requests/:id" element={<RequestDetailPage />} />
          {/* A reservation is the internal hold an approved request creates,
              not a place of its own — it is shown on the request it belongs to,
              so there is no standalone route for it. The table and the service
              are unchanged. */}

          {/* A conversation is readable only through membership, so both paths
              share one page and one guard. */}
          <Route
            path="/messages"
            element={
              <RequirePermission permission={PERM.MESSAGE_SEND}>
                <MessagesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/messages/:id"
            element={
              <RequirePermission permission={PERM.MESSAGE_SEND}>
                <MessagesPage />
              </RequirePermission>
            }
          />

          <Route
            path="/users"
            element={
              <RequirePermission permission={PERM.USER_MANAGE}>
                <UsersPage />
              </RequirePermission>
            }
          />
          <Route path="/notifications" element={<NotificationsPage />} />
          {/* The activity log is staff-only, the same audience the service and
              the security rules already scope it to. */}
          <Route
            path="/activity"
            element={
              <RequirePermission permission={PERM.TXN_VIEW_ALL}>
                <ActivityPage />
              </RequirePermission>
            }
          />
          <Route
            path="/maintenance"
            element={
              <RequirePermission permission={PERM.MAINTENANCE_VIEW}>
                <MaintenancePage />
              </RequirePermission>
            }
          />
          <Route
            path="/reports"
            element={
              <RequirePermission permission={PERM.REPORTS_VIEW}>
                <ReportsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings"
            // No permission gate: everyone has preferences of their own. The
            // laboratory configuration inside the page is still gated.
            element={<SettingsPage />}
          />
          {/* Any other path falls inside the protected tree: signed in it is a
              404 in the shell, signed out `RequireAuth` sends it to /login. */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>

      <InstallPrompt />
    </>
  )
}
