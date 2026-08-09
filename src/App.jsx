import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AlertTriangle, ShieldOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import BootScreen from './components/BootScreen'
import InstallPrompt from './components/InstallPrompt'
import { useApp } from './context/AppContext'
import { PERM } from './utils/permissions'

import LoginPage from './pages/LoginPage'
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

/** Blocks unauthenticated access and remembers where the user was heading. */
function RequireAuth({ children }) {
  const { isAuthenticated } = useApp()
  const location = useLocation()
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}

/** Route-level permission guard, paired with the checks inside each service. */
function RequirePermission({ permission, children }) {
  const { can } = useApp()
  if (!can(permission)) return <NoAccess />
  return children
}

function NoAccess() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-red-500/10">
        <ShieldOff className="h-7 w-7 text-red-500" />
      </span>
      <h2 className="text-lg font-extrabold">Restricted area</h2>
      <p className="muted mt-2 max-w-sm text-sm">
        Your role does not have access to this section of the laboratory system. Contact the
        laboratory administrator if you believe this is a mistake.
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
      <Link to="/dashboard" className="btn btn-primary mt-5">
        Back to dashboard
      </Link>
    </div>
  )
}

export default function App() {
  const { booting, bootError, retryBoot, continueWithoutBoot, isAuthenticated } = useApp()

  // The boot always ends in one of these two states — never an endless spinner.
  if (booting || bootError) {
    return (
      <BootScreen error={bootError} onRetry={retryBoot} onContinue={continueWithoutBoot} />
    )
  }

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
        />

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />

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

          <Route path="/transactions" element={<TransactionsPage />} />
          <Route
            path="/users"
            element={
              <RequirePermission permission={PERM.USER_VIEW}>
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
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>

      <InstallPrompt />
    </>
  )
}
