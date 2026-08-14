import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AlertTriangle, ShieldOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import InstallPrompt from './components/InstallPrompt'
import { ErrorState, Skeleton, SkeletonCards, SkeletonRows } from './components/ui'
import { useApp } from './context/AppContext'
import { PERM } from './utils/permissions'

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
import NotificationsPage from './pages/NotificationsPage'
import MaintenancePage from './pages/MaintenancePage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import ProfilePage from './pages/ProfilePage'

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
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
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
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
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
 * What a refresh shows while the stored session is read.
 *
 * There is no splash screen: the page structure appears immediately, drawn with
 * the same skeleton primitives the pages themselves use while their data loads,
 * so the transition into the real dashboard is a swap of content rather than a
 * change of screen. No timer, no minimum duration — it lasts exactly as long as
 * reading the session takes.
 */
function BootSkeleton() {
  return (
    // The same padding as the shell's `main`, so nothing shifts once the real
    // layout takes over.
    <div className="min-w-0 px-3 pb-28 pt-4 sm:px-5 lg:pb-8">
      <div className="mb-5 space-y-2">
        <Skeleton className="h-7 w-56 max-w-[70%] rounded-lg" />
        <Skeleton className="h-4 w-72 max-w-[60%] rounded" />
      </div>
      <SkeletonCards count={4} className="grid-cols-2 lg:grid-cols-4" />
      <div className="card mt-4 overflow-hidden">
        <SkeletonRows rows={4} />
      </div>
    </div>
  )
}

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
  // stops a refresh bouncing a signed-in user to the login page — but the wait
  // now shows the page skeleton rather than a full-screen splash.
  if (booting) return <BootSkeleton />

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
          <Route
            path="/tools/:id/history"
            element={
              <RequirePermission permission={PERM.TOOL_VIEW}>
                <ToolHistoryPage />
              </RequirePermission>
            }
          />

          <Route path="/scan" element={<ScanPage />} />
          <Route
            path="/borrow"
            element={
              <RequirePermission permission={PERM.BORROW}>
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
          <Route
            path="/users"
            element={
              <RequirePermission permission={PERM.USER_MANAGE}>
                <UsersPage />
              </RequirePermission>
            }
          />
          <Route path="/notifications" element={<NotificationsPage />} />
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
            element={
              <RequirePermission permission={PERM.SETTINGS_VIEW}>
                <SettingsPage />
              </RequirePermission>
            }
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
