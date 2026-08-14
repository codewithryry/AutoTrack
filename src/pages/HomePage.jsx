import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  ClipboardList,
  GraduationCap,
  HardHat,
  LayoutDashboard,
  LogIn,
  QrCode,
  Repeat,
  ShieldCheck,
  Undo2,
  UserCog,
  Wrench,
} from 'lucide-react'
import { BrandLockup, BrandMark } from '../components/Brand'
import { useApp } from '../context/AppContext'
import { APP_NAME, APP_TAGLINE, DEFAULT_SETTINGS, ROLE } from '../utils/constants'

/**
 * Public landing page — the only route a visitor can reach without an account.
 *
 * It reuses the application's own visual language rather than inventing a
 * marketing one: the dark navy rail colour as the page ground, the amber accent,
 * the hazard stripe, the same `card` / `btn` / `badge` components and the same
 * technical typography. Somebody who signs in should feel they are already in the
 * system they were just reading about.
 *
 * Everything below the fold is static copy. There is no data read here, so
 * the page renders instantly and works with no session at all.
 */

const FEATURES = [
  {
    icon: Wrench,
    title: 'Tool Management',
    text: 'Keep track of laboratory tools and their availability.',
  },
  {
    icon: Repeat,
    title: 'Borrow & Return',
    text: 'Manage tool borrowing and return transactions efficiently.',
  },
  {
    icon: LayoutDashboard,
    title: 'Real-Time Monitoring',
    text: 'Monitor tool availability, active loans, overdue tools, and tool status.',
  },
  {
    icon: ClipboardList,
    title: 'Transaction Tracking',
    text: 'Maintain a clear history of tool borrowing and returns.',
  },
  {
    icon: ShieldCheck,
    title: 'Role-Based Access',
    text: 'Provide different access levels for administrators, instructors, and students.',
  },
  {
    icon: HardHat,
    title: 'Maintenance Monitoring',
    text: 'Track damaged tools and maintenance status.',
  },
]

const STEPS = [
  { icon: LogIn, title: 'Sign in to your account', text: 'Use your laboratory account to open the system.' },
  { icon: QrCode, title: 'Find or scan a tool', text: 'Search the inventory or scan the QR label on the tool.' },
  { icon: Repeat, title: 'Borrow and use the tool', text: 'A transaction records who holds it and when it is due.' },
  { icon: Undo2, title: 'Return and complete', text: 'Hand it back, check its condition, and the loan is closed.' },
]

const ROLES = [
  {
    icon: UserCog,
    role: ROLE.ADMIN,
    title: 'Administrator',
    text: 'Manage laboratory tools, users, transactions, maintenance, and system settings.',
  },
  {
    icon: BarChart3,
    role: ROLE.INSTRUCTOR,
    title: 'Instructor',
    text: 'Monitor laboratory operations, tools, borrowing activity, and transactions.',
  },
  {
    icon: GraduationCap,
    role: ROLE.STUDENT,
    title: 'Student',
    text: 'Browse available tools, borrow tools, and track your own borrowing history.',
  },
]

export default function HomePage() {
  const { isAuthenticated, user } = useApp()

  return (
    // `overflow-x-hidden` belongs here rather than on <body>: it keeps a wide
    // section from ever producing a horizontal scrollbar on a phone.
    <div className="min-h-[100dvh] overflow-x-hidden" style={{ background: 'rgb(var(--rail))' }}>
      <PublicHeader isAuthenticated={isAuthenticated} />

      {/* ------------------------------- hero ------------------------------- */}
      <section className="relative overflow-hidden">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-[0.07]" />
        <div
          className="pointer-events-none absolute -right-40 -top-40 h-[560px] w-[560px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgb(var(--accent) / 0.10), transparent 62%)' }}
        />

        <div className="relative mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
            <div className="min-w-0">
              <span className="badge border-amberline-400/30 bg-amberline-400/10 text-amberline-300">
                <span className="h-1.5 w-1.5 rounded-full bg-amberline-400" />
                Automotive Laboratory Tool Management System
              </span>

              <h1 className="mt-6 text-3xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-[52px]">
                Smart Tool Management for
                <span className="block text-amberline-400">Modern Automotive Laboratories</span>
              </h1>

              <p className="mt-5 max-w-xl text-sm leading-relaxed text-navy-300 sm:text-base">
                Track, manage, borrow, and return laboratory tools with a centralized monitoring
                system designed for automotive technical education.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {isAuthenticated ? (
                  <Link to="/dashboard" className="btn btn-primary btn-lg w-full sm:w-auto">
                    <LayoutDashboard className="h-4 w-4" />
                    Open dashboard
                  </Link>
                ) : (
                  <>
                    <Link to="/signup" className="btn btn-primary btn-lg w-full sm:w-auto">
                      Get Started
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                      to="/login"
                      className="btn btn-lg w-full border border-white/15 text-white
                                 transition-colors hover:bg-white/10 sm:w-auto"
                    >
                      <LogIn className="h-4 w-4" />
                      Sign In
                    </Link>
                  </>
                )}
              </div>

              {isAuthenticated && (
                <p className="mt-3 text-xs text-navy-400">
                  Signed in as {user?.fullName} · {user?.role}
                </p>
              )}
            </div>

            {/* A restrained nod to the real dashboard rather than a stock
                illustration — same rail, same status colours. */}
            <div className="relative min-w-0">
              <div
                className="rounded-2xl border border-white/10 p-4 shadow-panel sm:p-5"
                style={{ background: 'rgb(var(--rail-hover))' }}
              >
                <div className="hazard-stripe mb-4 h-1 w-full rounded-full" />
                <div className="grid grid-cols-2 gap-3">
                  <MetricTile label="Tools tracked" value="Inventory" hint="QR-tagged equipment" />
                  <MetricTile label="Active loans" value="Live" hint="Who holds what, now" />
                  <MetricTile label="Overdue" value="Flagged" hint="Past its return date" />
                  <MetricTile label="Maintenance" value="Scheduled" hint="Calibration and repair" />
                </div>
                <ul className="mt-4 space-y-2">
                  {['Available', 'Borrowed', 'Overdue', 'Maintenance'].map((status, i) => (
                    <li key={status} className="flex items-center gap-2.5">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          ['bg-emerald-500', 'bg-blue-500', 'bg-red-500', 'bg-orange-500'][i]
                        }`}
                      />
                      <span className="text-xs font-semibold text-navy-200">{status}</span>
                      <span className="h-px flex-1 bg-white/10" />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------- features ----------------------------- */}
      <Section
        id="features"
        eyebrow="Capabilities"
        title="Everything the tool room needs"
        description="One system for the inventory, the transactions and the servicing behind them."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="rounded-xl border border-white/10 p-5 transition-colors hover:border-amberline-400/30"
              style={{ background: 'rgb(var(--rail-hover) / 0.7)' }}
            >
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-amberline-400/10 ring-1 ring-amberline-400/25">
                <Icon className="h-5 w-5 text-amberline-400" />
              </span>
              <h3 className="mt-4 text-sm font-bold text-white">{title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-navy-400">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ---------------------------- how it works ---------------------------- */}
      <Section
        eyebrow="How it works"
        title="Four steps, start to finish"
        description="The same flow whether you are at the crib window or the diagnostic bay."
      >
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ icon: Icon, title, text }, index) => (
            <li
              key={title}
              className="relative rounded-xl border border-white/10 p-5"
              style={{ background: 'rgb(var(--rail-hover) / 0.7)' }}
            >
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-white/5">
                  <Icon className="h-5 w-5 text-amberline-400" />
                </span>
                <span className="mono text-2xl font-extrabold text-white/10">
                  {String(index + 1).padStart(2, '0')}
                </span>
              </div>
              <h3 className="mt-4 text-sm font-bold text-white">{title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-navy-400">{text}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ------------------------------- roles ------------------------------- */}
      <Section
        eyebrow="Access levels"
        title="Three roles, three views of the laboratory"
        description="Each account sees exactly what its role needs — enforced in the database, not just the interface."
      >
        <div className="grid gap-3 lg:grid-cols-3">
          {ROLES.map(({ icon: Icon, role, title, text }) => (
            <div
              key={role}
              className="rounded-xl border border-white/10 p-5"
              style={{ background: 'rgb(var(--rail-hover) / 0.7)' }}
            >
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-amberline-400/10 ring-1 ring-amberline-400/25">
                  <Icon className="h-5 w-5 text-amberline-400" />
                </span>
                <h3 className="text-sm font-bold text-white">{title}</h3>
              </div>
              <p className="mt-3.5 text-xs leading-relaxed text-navy-400">{text}</p>
            </div>
          ))}
        </div>

        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-navy-500">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Administrator accounts are issued by the laboratory, never through this sign-up form.
          Instructor registrations wait for approval before they can issue tools.
        </p>
      </Section>

      {/* -------------------------------- CTA -------------------------------- */}
      <section className="px-5 pb-16 sm:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <div
            className="relative overflow-hidden rounded-2xl border border-amberline-400/20 px-6 py-10 text-center sm:px-10 sm:py-12"
            style={{ background: 'rgb(var(--rail-hover))' }}
          >
            <div className="hazard-stripe absolute inset-x-0 top-0 h-1" />
            <h2 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">
              Ready to manage your laboratory tools smarter?
            </h2>
            <p className="muted mx-auto mt-3 max-w-lg text-sm text-navy-300">
              Create an account to start borrowing, returning and tracking equipment.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to={isAuthenticated ? '/dashboard' : '/signup'}
                className="btn btn-primary btn-lg w-full sm:w-auto"
              >
                {isAuthenticated ? 'Open dashboard' : 'Get Started'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              {!isAuthenticated && (
                <Link
                  to="/login"
                  className="btn btn-lg w-full border border-white/15 text-white
                             transition-colors hover:bg-white/10 sm:w-auto"
                >
                  Sign In
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      <PublicFooter isAuthenticated={isAuthenticated} />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Public chrome
 *
 * Deliberately separate from `AppLayout`: signing in switches to the real
 * sidebar, and the public bar never appears inside the application.
 * ------------------------------------------------------------------ */

function PublicHeader({ isAuthenticated }) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 backdrop-blur"
      style={{ background: 'rgb(var(--rail) / 0.85)' }}
    >
      <div className="hazard-stripe h-1 w-full" />
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 py-3 sm:px-8">
        {/* The mark alone on a phone: the wordmark would be truncated next to
            three navigation controls. */}
        <Link to="/" className="min-w-0 rounded-lg" aria-label={APP_NAME}>
          <span className="flex sm:hidden">
            <BrandLockup compact />
          </span>
          <span className="hidden sm:flex">
            <BrandLockup />
          </span>
        </Link>

        <nav className="ml-auto flex items-center gap-1.5 sm:gap-2" aria-label="Public">
          <Link
            to="/"
            className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-navy-200
                       transition-colors hover:bg-white/10 hover:text-white sm:block"
          >
            Home
          </Link>

          {isAuthenticated ? (
            <Link to="/dashboard" className="btn btn-primary btn-sm">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="rounded-lg px-3 py-2 text-sm font-semibold text-navy-200
                           transition-colors hover:bg-white/10 hover:text-white"
              >
                Sign In
              </Link>
              <Link to="/signup" className="btn btn-primary btn-sm">
                Sign Up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

function PublicFooter({ isAuthenticated }) {
  return (
    <footer className="border-t border-white/10 px-5 py-10 sm:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-8 sm:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <BrandMark size={40} />
            <div className="min-w-0">
              <p className="truncate text-xs font-extrabold uppercase tracking-[0.14em] text-white">
                Smart Tool Monitoring System
              </p>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amberline-400">
                {APP_TAGLINE}
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-navy-400">
            {DEFAULT_SETTINGS.labName}
            <br />
            {DEFAULT_SETTINGS.labLocation}
          </p>
        </div>

        <nav aria-label="Footer">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-navy-500">Links</p>
          <ul className="mt-3 space-y-2">
            <li>
              <Link to="/" className="text-xs font-semibold text-navy-300 hover:text-amberline-400">
                Home
              </Link>
            </li>
            {isAuthenticated ? (
              <li>
                <Link
                  to="/dashboard"
                  className="text-xs font-semibold text-navy-300 hover:text-amberline-400"
                >
                  Dashboard
                </Link>
              </li>
            ) : (
              <>
                <li>
                  <Link
                    to="/login"
                    className="text-xs font-semibold text-navy-300 hover:text-amberline-400"
                  >
                    Sign In
                  </Link>
                </li>
                <li>
                  <Link
                    to="/signup"
                    className="text-xs font-semibold text-navy-300 hover:text-amberline-400"
                  >
                    Sign Up
                  </Link>
                </li>
              </>
            )}
          </ul>
        </nav>
      </div>

      <div className="mx-auto mt-8 w-full max-w-6xl border-t border-white/5 pt-5">
        <p className="text-[11px] text-navy-500">
          Students and instructors register here; instructor accounts are activated by an
          administrator. Administrator access is issued by the laboratory.
        </p>
      </div>
    </footer>
  )
}

/* ------------------------------ small parts ------------------------------ */

function Section({ id, eyebrow, title, description, children }) {
  return (
    <section id={id} className="px-5 py-14 sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-6xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amberline-400">
          {eyebrow}
        </p>
        <h2 className="mt-2.5 text-xl font-extrabold tracking-tight text-white sm:text-2xl">
          {title}
        </h2>
        {description && (
          <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-navy-400">{description}</p>
        )}
        <div className="mt-7">{children}</div>
      </div>
    </section>
  )
}

function MetricTile({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-navy-500">{label}</p>
      <p className="mt-1 text-sm font-extrabold text-white">{value}</p>
      <p className="mt-0.5 text-[10px] text-navy-500">{hint}</p>
    </div>
  )
}
