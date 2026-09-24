import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AlertTriangle, ShieldOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppLayout, { useStandalonePage } from './layouts/AppLayout'
import InstallPrompt from './components/InstallPrompt'
import { ErrorState } from './components/ui'
import { useApp } from './context/AppContext'
import { useAndroidBack } from './hooks/useAndroidBack'
import { PERM } from './utils/permissions'

/*
 * The sign-in screens are the first thing every session renders, so they are
 * part of the initial bundle. Everything behind the session is loaded when it is
 * first visited.
 *
 * This is the single largest thing that was slowing the app down on a modest
 * phone. Every page was imported statically, which made Vite preload the whole
 * application — including the QR scanner (334 kB) and the charting library
 * (400 kB) — before the login form could paint, on a screen that uses neither.
 * A 2 GB device paid for parsing and holding all of it just to type a password.
 *
 * The chunks the router now pulls in on demand are the same files as before;
 * only the moment they arrive has changed.
 */
import LoginPage from './pages/LoginPage'
import SignUpPage from './pages/SignUpPage'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ToolsPage = lazy(() => import('./pages/ToolsPage'))
const ToolDetailPage = lazy(() => import('./pages/ToolDetailPage'))
const ToolHistoryPage = lazy(() => import('./pages/ToolHistoryPage'))
const ToolMapPage = lazy(() => import('./pages/ToolMapPage'))
const ScanPage = lazy(() => import('./pages/ScanPage'))
const BorrowPage = lazy(() => import('./pages/BorrowPage'))
const ReturnPage = lazy(() => import('./pages/ReturnPage'))
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const ActivityPage = lazy(() => import('./pages/ActivityPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const MaintenancePage = lazy(() => import('./pages/MaintenancePage'))
const ProblemReportsPage = lazy(() => import('./pages/ProblemReportsPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const RequestsPage = lazy(() => import('./pages/RequestsPage'))
const NewRequestPage = lazy(() => import('./pages/NewRequestPage'))
const RequestDetailPage = lazy(() => import('./pages/RequestDetailPage'))
const MessagesPage = lazy(() => import('./pages/MessagesPage'))
const TobiPage = lazy(() => import('./pages/TobiPage'))

/*
 * Search metadata.
 *
 * Only the sign-in and sign-up pages are public, so only they are indexable and
 * carry a canonical URL. Every other route is behind an account: it is marked
 * `noindex` here (and disallowed in `public/robots.txt`), which keeps it out of
 * search results — authentication is still what protects it. The origin comes
 * from the deployment address, never from `localhost`.
 */
const SITE_ORIGIN = (import.meta.env.VITE_PUBLIC_APP_URL || 'https://autotracking.vercel.app').replace(
  /\/+$/,
  '',
)
const DEFAULT_TITLE = typeof document !== 'undefined' ? document.title : 'ToolTrack'
const PUBLIC_PAGES = {
  '/login': {
    title: 'Sign in — ToolTrack Automotive Laboratory Tool Monitoring',
    description:
      'Sign in to ToolTrack to scan, borrow, track and return automotive laboratory tools with QR codes.',
  },
  '/signup': {
    title: 'Create an account — ToolTrack',
    description:
      'Create a ToolTrack account to request and borrow automotive laboratory tools and follow your loans.',
  },
}

function setHeadTag(selector, create, attr, value) {
  let el = document.head.querySelector(selector)
  if (value == null) {
    el?.remove()
    return
  }
  if (!el) {
    el = create()
    document.head.appendChild(el)
  }
  el.setAttribute(attr, value)
}

function usePageMeta() {
  const { pathname } = useLocation()
  useEffect(() => {
    const page = PUBLIC_PAGES[pathname]
    const meta = (key, name) => () => {
      const el = document.createElement('meta')
      el.setAttribute(key, name)
      return el
    }
    document.title = page?.title ?? DEFAULT_TITLE
    setHeadTag('meta[name="robots"]', meta('name', 'robots'), 'content', page ? 'index, follow' : 'noindex, nofollow')
    setHeadTag(
      'link[rel="canonical"]',
      () => Object.assign(document.createElement('link'), { rel: 'canonical' }),
      'href',
      page ? `${SITE_ORIGIN}${pathname}` : null,
    )
    if (page) {
      setHeadTag('meta[name="description"]', meta('name', 'description'), 'content', page.description)
      setHeadTag('meta[property="og:title"]', meta('property', 'og:title'), 'content', page.title)
      setHeadTag('meta[property="og:description"]', meta('property', 'og:description'), 'content', page.description)
      setHeadTag('meta[property="og:url"]', meta('property', 'og:url'), 'content', `${SITE_ORIGIN}${pathname}`)
    }
  }, [pathname])
}

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

export default function App() {
  const { booting, bootError, retryBoot, continueWithoutBoot, isAuthenticated } = useApp()

  // Android's back button means "go back one route", not "close the app".
  // Nothing happens in a browser build.
  useAndroidBack()
  usePageMeta()

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

  // The boot state covers the moment the stored session is read. Routing is
  // held until then so a refresh never bounces a signed-in user to /login.
  //
  // Nothing is painted here — not on a phone (the system launch screen covers
  // this moment) and not on desktop (the browser's blank tab is one steady
  // colour, so there is no flash to mask). The only loading state in the app is
  // the `PageLoading` spinner inside the shell's content column, which shows
  // while a page's chunk loads — the login page and the whole viewport never
  // get one.
  if (booting) return null

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
        {/* One boundary around the whole protected tree, inside the shell: the
            rail, top bar and bottom bar paint immediately and only the page area
            waits for its chunk. On a fast connection the chunk is usually there
            before this ever shows. */}
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
          {/* Last recorded location of each tool. Scoped by role in the data
              layer: staff read every loan's points, a student only their own. */}
          <Route
            path="/tools/map"
            element={
              <RequirePermission permission={PERM.TOOL_VIEW}>
                <ToolMapPage />
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

          {/* One universal QR entry point. A tool's QR is all `/scan` ever
              reads: it resolves the tool and the signed-in role's active loan,
              and `ToolFound`/`ToolScanResult` decide what to show from there —
              request, borrow, return, or (for staff, when the tool's loan has
              an open return request waiting) accept/issue/reject it right on
              this screen. There is no second, return-specific scanner. */}
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
          {/* TOBI, full page. No permission gate: every account may ask, and
              what each one is told is decided by /api/tobi on the server. */}
          <Route path="/tobi" element={<TobiPage />} />
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
            path="/problem-reports"
            element={
              <RequirePermission permission={PERM.MAINTENANCE_VIEW}>
                <ProblemReportsPage />
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
