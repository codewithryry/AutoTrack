import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardList,
  HardHat,
  Package,
  QrCode,
  Repeat,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  Users as UsersIcon,
  Wrench,
} from 'lucide-react'
import Walkthrough, { usePageTour } from '../components/Walkthrough'
import { MascotGreeter } from '../components/Mascot'
import StatCard from '../components/StatCard'
import TransactionTable from '../components/TransactionTable'
import TransactionDetail from '../components/TransactionDetail'
import {
  EmptyState,
  ErrorState,
  ProgressBar,
  SectionCard,
  SkeletonCards,
  SkeletonRows,
} from '../components/ui'
import { useApp } from '../context/AppContext'
import { useDashboard, useMediaQuery, useNotifications, useUsers } from '../hooks'
import { pendingAccounts, pendingProfileChanges } from '../services/users'
import { PERM, isStaff } from '../utils/permissions'
import { cx, initials } from '../utils/helpers'
import { dueLabel, formatDate, timeAgo } from '../utils/dates'

const ACTIVITY_TONE = {
  tool_borrowed: 'bg-blue-500',
  tool_returned: 'bg-emerald-500',
  tool_overdue: 'bg-red-500',
  tool_created: 'bg-amberline-500',
  tool_updated: 'bg-slate-400',
  tool_deleted: 'bg-red-400',
  status_changed: 'bg-orange-500',
  condition_changed: 'bg-orange-400',
  maintenance_scheduled: 'bg-violet-500',
  maintenance_completed: 'bg-teal-500',
  login: 'bg-slate-400',
}

/* ------------------------------------------------------------------ *
 * The greeting, and the mascot's one home on this page
 * ------------------------------------------------------------------ */

/**
 * The dashboard hero: greeting and status on the left, the assistant standing
 * large on the right, as one composed band rather than a title with a picture
 * next to it.
 *
 * It is not a card, and neither is the mascot — no border, no fill, no shadow
 * anywhere in here. The hero's weight comes from type size and empty space, so
 * the first real surface on the page is the statistics row below it, and the eye
 * has somewhere to land.
 *
 * It replaces `PageHeader` on this page alone because the figure and the text
 * must sit side by side at every width — `PageHeader` stacks its children under
 * the title on a phone, which is right for buttons and wrong for a character.
 *
 * Everything about the figure's box is set here, and only here:
 *
 *   • it is sized in four steps (phone → tablet → laptop → desktop) rather than
 *     one desktop size scaled down, so a phone keeps its screen for the cards
 *     below while a desktop gets a genuinely prominent character;
 *   • it is bottom-aligned with `items-end`, so the mascot stands *on* the
 *     greeting's baseline instead of floating beside it at different heights as
 *     the subtitle wraps to one, two or three lines;
 *   • it is `shrink-0` next to a `min-w-0` text column, so the two can never
 *     overlap — the greeting wraps or truncates, the figure never gets clipped;
 *   • it is hidden below 360px, where there is genuinely no room for both.
 *
 * The text column is capped at `65ch` so a wide screen does not stretch the
 * status line into an unreadable ribbon; the figure then sits out at the right
 * edge of the content column, which is what makes this read as a hero and not as
 * a heading with an ornament.
 *
 * `actions` is what makes the two dashboards read differently from their first
 * line: the student's carries their two everyday buttons, staff pass nothing and
 * get a purely informational hero.
 */
function DashboardHero({ eyebrow, title, subtitle, signals, name, actions }) {
  return (
    <section className="mb-5 flex items-end justify-between gap-4 sm:mb-7 sm:gap-8 lg:mb-8 lg:gap-12">
      <div className="min-w-0 flex-1 lg:max-w-[65ch]">
        {eyebrow && (
          <p className="subtle truncate text-[10px] font-bold uppercase tracking-[0.16em]">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-2 text-[21px] font-extrabold leading-[1.12] tracking-tight [overflow-wrap:anywhere] sm:truncate sm:text-[30px] lg:text-[38px]">
          {title}
        </h1>
        {subtitle && (
          <p className="muted mt-2 text-[13px] leading-snug sm:text-[15px] lg:text-base">
            {subtitle}
          </p>
        )}
        {actions && (
          <div className="mt-4 flex flex-wrap items-center gap-2.5 lg:mt-5">{actions}</div>
        )}
      </div>
      {/* The assistant reports whichever figure below needs attention first — it
          reads the dashboard data and fetches nothing of its own — idles with a
          slow bob and a blink, and answers a tap with one short line. The
          wrapper sets the height; the SVG takes only the width it needs. */}
      <MascotGreeter
        signals={signals}
        name={name}
        className={cx(
          'hidden min-[360px]:flex',
          // Sized against the text beside it, not against the screen. Both
          // columns are bottom-aligned, so a figure taller than the text leaves
          // dead space above the greeting — which is exactly what the staff
          // hero, three lines and no button row, used to show.
          actions
            ? 'h-[92px] sm:h-[132px] lg:h-[176px] xl:h-[200px]'
            : 'h-[84px] sm:h-[116px] lg:h-[144px] xl:h-[160px]',
        )}
      />
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * Router between the two dashboards
 * ------------------------------------------------------------------ */

export default function DashboardPage() {
  const { user, can, settings, online } = useApp()
  const { dashboard, loading, error, reload } = useDashboard()
  const [selected, setSelected] = useState(null)

  const firstName = user?.fullName?.split(' ')[0] ?? 'there'

  if (error) {
    return (
      <>
        <DashboardHero
          eyebrow={`${settings.labName} · ${settings.labLocation}`}
          title={`Good ${greeting()}, ${firstName}`}
          signals={{ error: true }}
          name={firstName}
        />
        <div className="panel">
          <ErrorState
            title="The dashboard could not be loaded"
            description={error.message}
            onRetry={reload}
          />
        </div>
      </>
    )
  }

  // A student sees their own loans, not laboratory-wide totals: their scoped
  // queries only return their own records, so a "total tools borrowed" figure
  // would be quietly wrong rather than restricted.
  if (dashboard?.scope === 'student' || (!dashboard && !isStaff(user))) {
    return (
      <StudentDashboard
        loading={loading}
        online={online}
        data={dashboard?.student}
        userId={user?.id}
        firstName={firstName}
        settings={settings}
        selected={selected}
        onSelect={setSelected}
      />
    )
  }

  return (
    <StaffDashboard
      loading={loading}
      online={online}
      dashboard={dashboard}
      can={can}
      settings={settings}
      firstName={firstName}
      selected={selected}
      onSelect={setSelected}
    />
  )
}

/* ------------------------------------------------------------------ *
 * Admin / instructor dashboard — the laboratory control desk
 *
 * Read top to bottom it answers, in order: what needs a decision from me today,
 * what state is the inventory in, what is moving right now, and who is doing it.
 * Every figure is laboratory-wide, and every panel links to the page that acts on
 * it. There are no personal counters here — staff manage the room, they do not
 * borrow from it on this screen.
 * ------------------------------------------------------------------ */

function StaffDashboard({
  loading,
  online,
  dashboard,
  can,
  settings,
  firstName,
  selected,
  onSelect,
}) {
  const busy = loading && !dashboard
  const stats = dashboard?.stats

  return (
    <>
      {/* No action buttons here: the sidebar on a desktop and the bottom bar on a
          phone both already carry Scan and Borrow / Return, and a control desk
          leads with what is wrong, not with a shortcut. */}
      <DashboardHero
        eyebrow={`${settings.labName} · ${settings.labLocation}`}
        title={`Good ${greeting()}, ${firstName}`}
        subtitle={
          stats?.overdue
            ? `${stats.overdue} tool${stats.overdue === 1 ? '' : 's'} overdue — worth chasing up.`
            : 'The laboratory is running to schedule.'
        }
        signals={{
          online,
          loading: busy,
          overdue: stats?.overdue ?? 0,
          maintenance: stats?.maintenance ?? 0,
          dueSoon: stats?.dueSoon ?? 0,
          activeLoans: stats?.activeLoans ?? 0,
        }}
        name={firstName}
      />

      {/* ----------------------- what needs a decision ----------------------- */}
      {/* The one band above the counters, and the reason this screen opens on a
          control desk rather than on statistics: it is rendered only when
          something is actually waiting, so a quiet day costs no vertical space. */}
      <AttentionBand stats={stats} busy={busy} can={can} settings={settings} />

      {/* --------------------------- inventory state --------------------------- */}
      <SectionLabel>Inventory</SectionLabel>
      {busy ? (
        <SkeletonCards count={5} className="grid-cols-2 lg:grid-cols-5" />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 lg:gap-5">
          <StatCard
            variant="tile"
            label="Total tools"
            value={stats.totalTools}
            icon={Boxes}
            tone="accent"
            hint={`${stats.inCirculation} in circulation`}
            to="/tools"
          />
          <StatCard
            variant="tile"
            label="Available"
            value={stats.available}
            icon={CheckCircle2}
            tone="success"
            hint={`${stats.availabilityRate}% of usable stock`}
            to="/tools?status=Available"
          />
          <StatCard
            variant="tile"
            label="Borrowed"
            value={stats.borrowed}
            icon={Package}
            tone="info"
            hint={stats.dueSoon ? `${stats.dueSoon} due soon` : 'None due today'}
            to="/tools?status=Borrowed"
          />
          <StatCard
            variant="tile"
            label="Overdue"
            value={stats.overdue}
            icon={AlertTriangle}
            tone="danger"
            hint={stats.overdue ? 'Needs follow-up' : 'All on schedule'}
            to="/tools?status=Overdue"
          />
          <StatCard
            variant="tile"
            label="Damaged"
            value={stats.damaged}
            icon={ShieldAlert}
            tone="warning"
            hint={`${stats.maintenance} under maintenance`}
            to="/tools?status=Damaged"
          />
        </div>
      )}

      {/* ------------------------------ operations ------------------------------ */}
      <SectionLabel>Operations today</SectionLabel>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
        {/* The Users page is admin-only, so only an admin gets a link here: an
            instructor may read the directory but cannot open that route, and
            would land on "Restricted area". */}
        <StatCard
          variant="tile"
          label="Total users"
          value={stats?.totalUsers ?? 0}
          icon={UsersIcon}
          hint={`${stats?.activeUsers ?? 0} active`}
          to={can(PERM.USER_MANAGE) ? '/users' : undefined}
          loading={busy}
        />
        <StatCard
          variant="tile"
          label="Today's transactions"
          value={stats?.todayTransactions ?? 0}
          icon={ClipboardList}
          hint={`${stats?.todayBorrowed ?? 0} out · ${stats?.todayReturned ?? 0} back`}
          to="/transactions"
          loading={busy}
        />
        <StatCard
          variant="tile"
          label="Active loans"
          value={stats?.activeLoans ?? 0}
          icon={Repeat}
          tone="info"
          hint={`${stats?.dueSoon ?? 0} due within ${settings.dueSoonThresholdDays} day(s)`}
          to="/transactions?status=Borrowed"
          loading={busy}
        />
        <StatCard
          variant="tile"
          label="Tool utilisation"
          value={`${stats?.utilization ?? 0}%`}
          icon={TrendingUp}
          tone="accent"
          hint="Share of stock currently out"
          loading={busy}
        />
      </div>

      {/* ------------------------------- 12-column body -------------------------------
          Eight columns for the queues staff work through, four for the reference
          panels beside them. */}
      <div className="mt-4 grid gap-4 lg:mt-6 lg:grid-cols-12 lg:gap-6">
        <div className="min-w-0 space-y-4 lg:col-span-8 lg:space-y-6">
          <SectionCard
            variant="panel"
            title="Recent transactions"
            description="Latest borrowing activity in the laboratory"
            bodyClassName="p-0"
            action={
              <Link to="/transactions" className="btn btn-ghost btn-sm">
                View all
              </Link>
            }
          >
            {busy ? (
              <SkeletonRows rows={4} />
            ) : (
              <TransactionTable
                transactions={dashboard.recent}
                onSelect={onSelect}
                compact
                emptyTitle="No transactions recorded yet."
                emptyDescription="Scan a tool and issue it to create the first record."
              />
            )}
          </SectionCard>

          {/* overdue */}
          <SectionCard
            variant="panel"
            title="Overdue summary"
            description="Tools that have passed their return date"
            bodyClassName="p-0"
          >
            {busy ? (
              <SkeletonRows rows={3} columns={3} />
            ) : dashboard.overdue.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Nothing is overdue."
                description="Every issued tool is still within its return date."
                compact
              />
            ) : (
              <ul className="divide-y">
                {dashboard.overdue.slice(0, 5).map(({ transaction, tool, daysOverdue }) => (
                  <li key={transaction.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-500/10">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/tools/${transaction.toolId}`}
                        className="block truncate text-sm font-bold hover:underline"
                      >
                        {transaction.toolName}
                      </Link>
                      <p className="muted truncate text-xs">
                        {transaction.userName} · due {formatDate(transaction.dueDate)}
                      </p>
                    </div>
                    <span className="badge shrink-0 border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                      {daysOverdue}d late
                    </span>
                    {tool && can(PERM.RETURN_ANY) && (
                      <Link
                        to={`/return?tool=${transaction.toolId}`}
                        className="btn btn-outline btn-sm hidden shrink-0 sm:inline-flex"
                      >
                        Return
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {/* most borrowed */}
          <SectionCard
            variant="panel"
            title="Most borrowed tools"
            description="Highest demand equipment in the workshop"
          >
            {busy ? (
              <SkeletonRows rows={4} columns={2} />
            ) : dashboard.mostBorrowed.length === 0 ? (
              <EmptyState
                icon={Wrench}
                title="No borrowing activity yet."
                description="Rankings appear once tools start moving."
                compact
              />
            ) : (
              <ul className="space-y-3.5">
                {dashboard.mostBorrowed.map((row, index) => {
                  const max = dashboard.mostBorrowed[0].count || 1
                  return (
                    <li key={row.toolId}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="subtle mono w-4 shrink-0 text-xs font-bold">
                            {index + 1}
                          </span>
                          <Link
                            to={`/tools/${row.toolId}`}
                            className="truncate text-sm font-semibold hover:underline"
                          >
                            {row.name}
                          </Link>
                        </div>
                        <span className="mono shrink-0 text-xs font-bold">
                          {row.count}
                          <span className="subtle font-medium"> loans</span>
                        </span>
                      </div>
                      <ProgressBar
                        value={row.count}
                        max={max}
                        barClassName={index === 0 ? 'bg-amberline-500' : 'bg-navy-400'}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* --------------------------- secondary column ---------------------------
            Reference, not queues: every panel in here is `quiet`, so the eight
            columns on the left keep the page's attention. */}
        <aside className="min-w-0 space-y-4 lg:col-span-4 lg:space-y-6">
          {/* Accounts and profile edits waiting on an administrator. Mounted only
              for a role that can actually act on them, so an instructor never
              fires the directory read behind it. */}
          {can(PERM.USER_MANAGE) && can(PERM.USER_EDIT) && <ApprovalsCard />}

          <SectionCard variant="quiet" title="Utilisation" description="Where the inventory is right now">
            {busy ? (
              <SkeletonRows rows={3} columns={1} />
            ) : (
              <div className="space-y-4">
                <div className="text-center">
                  <p className="mono text-4xl font-extrabold leading-none">{stats.utilization}%</p>
                  <p className="subtle mt-1.5 text-xs">
                    of {stats.inCirculation} usable tools are checked out
                  </p>
                </div>
                <div className="space-y-2.5">
                  <UtilisationRow
                    label="Available"
                    value={stats.available}
                    total={stats.totalTools}
                    barClass="bg-emerald-500"
                  />
                  <UtilisationRow
                    label="Borrowed"
                    value={stats.borrowed}
                    total={stats.totalTools}
                    barClass="bg-blue-500"
                  />
                  <UtilisationRow
                    label="Overdue"
                    value={stats.overdue}
                    total={stats.totalTools}
                    barClass="bg-red-500"
                  />
                  <UtilisationRow
                    label="Maintenance"
                    value={stats.maintenance}
                    total={stats.totalTools}
                    barClass="bg-orange-500"
                  />
                  <UtilisationRow
                    label="Damaged / lost"
                    value={stats.damaged + stats.lost}
                    total={stats.totalTools}
                    barClass="bg-rose-500"
                  />
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard
            variant="quiet"
            title="Upcoming maintenance"
            description="Scheduled service in the next 30 days"
            bodyClassName="p-0"
            action={
              can(PERM.MAINTENANCE_VIEW) ? (
                <Link to="/maintenance" className="btn btn-ghost btn-sm">
                  Open
                </Link>
              ) : null
            }
          >
            {busy ? (
              <SkeletonRows rows={3} columns={2} />
            ) : dashboard.upcoming.length === 0 ? (
              <EmptyState
                icon={HardHat}
                title="No maintenance due."
                description="Nothing needs servicing in the next 30 days."
                compact
              />
            ) : (
              <ul className="divide-y">
                {dashboard.upcoming.slice(0, 5).map(({ tool, daysUntil }) => (
                  <li key={tool.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/tools/${tool.id}`}
                        className="block truncate text-sm font-semibold hover:underline"
                      >
                        {tool.name}
                      </Link>
                      <p className="subtle truncate text-xs">
                        {formatDate(tool.nextMaintenanceDate)}
                      </p>
                    </div>
                    <span
                      className={cx(
                        'badge shrink-0',
                        daysUntil <= 0
                          ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
                          : daysUntil <= 7
                            ? 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300'
                            : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-300',
                      )}
                    >
                      {daysUntil <= 0 ? 'Due now' : `${daysUntil}d`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {can(PERM.TXN_VIEW_ALL) && (
            <SectionCard
              variant="quiet"
              title="Most active borrowers"
              description="Students and staff using the laboratory"
              bodyClassName="p-0"
            >
              {busy ? (
                <SkeletonRows rows={4} columns={2} />
              ) : dashboard.activeUsers.length === 0 ? (
                <EmptyState icon={UsersIcon} title="No borrowing activity yet." compact />
              ) : (
                <ul className="divide-y">
                  {dashboard.activeUsers.map((row) => (
                    <li key={row.userId} className="flex items-center gap-3 px-4 py-2.5">
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[10px] font-extrabold"
                        style={{ background: 'rgb(var(--rail))', color: 'rgb(var(--accent))' }}
                      >
                        {initials(row.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{row.name}</p>
                        <p className="subtle truncate text-xs">
                          {row.role}
                          {row.active > 0 && ` · ${row.active} out now`}
                        </p>
                      </div>
                      <span className="mono shrink-0 text-xs font-bold">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}

          <SectionCard
            variant="quiet"
            title="Recent activity"
            description="Live log from the tool room"
            bodyClassName="p-4"
          >
            {busy ? (
              <SkeletonRows rows={5} columns={1} />
            ) : dashboard.activity.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No activity recorded yet." compact />
            ) : (
              <ol className="relative space-y-4 border-l pl-4">
                {dashboard.activity.map((entry) => (
                  <li key={entry.id} className="relative">
                    <span
                      className={cx(
                        'absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-4',
                        ACTIVITY_TONE[entry.action] ?? 'bg-slate-400',
                      )}
                      style={{ '--tw-ring-color': 'rgb(var(--surface))' }}
                    />
                    <p className="text-xs font-semibold leading-snug">{entry.message}</p>
                    <p className="subtle mt-0.5 text-[11px]">
                      {entry.toolName ? `${entry.toolName} · ` : ''}
                      {timeAgo(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </aside>
      </div>

      <TransactionDetail transaction={selected} open={!!selected} onClose={() => onSelect(null)} />
    </>
  )
}

/** Small caps rule between the staff dashboard's bands. */
function SectionLabel({ children }) {
  return (
    <h2 className="subtle mb-2 mt-5 text-[10px] font-bold uppercase tracking-[0.14em] first:mt-0">
      {children}
    </h2>
  )
}

/**
 * The row of things a member of staff should deal with before anything else.
 *
 * Every figure comes from the same `dashboardStats()` the counters below use —
 * nothing extra is fetched — and each chip is a link into the page that resolves
 * it. When all three are clear the band renders nothing at all rather than three
 * green "0" tiles, which is why the quiet-day dashboard opens straight onto the
 * inventory.
 */
function AttentionBand({ stats, busy, can, settings }) {
  if (busy || !stats) return null

  const items = []
  if (stats.overdue > 0) {
    items.push({
      key: 'overdue',
      icon: AlertTriangle,
      label: `${stats.overdue} overdue tool${stats.overdue === 1 ? '' : 's'}`,
      hint: 'Chase the borrowers',
      to: '/transactions?status=Overdue',
      tone: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
    })
  }
  if (stats.dueSoon > 0) {
    items.push({
      key: 'due',
      icon: ClipboardList,
      label: `${stats.dueSoon} due within ${settings.dueSoonThresholdDays} day(s)`,
      hint: 'Send a reminder',
      to: '/transactions?status=Borrowed',
      tone: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300',
    })
  }
  if (stats.maintenance > 0 && can(PERM.MAINTENANCE_VIEW)) {
    items.push({
      key: 'maintenance',
      icon: HardHat,
      label: `${stats.maintenance} tool${stats.maintenance === 1 ? '' : 's'} in maintenance`,
      hint: 'Open the service log',
      to: '/maintenance',
      tone: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300',
    })
  }

  if (items.length === 0) return null

  return (
    <>
      <SectionLabel>Needs attention</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ key, icon: Icon, label, hint, to, tone }) => (
          <Link
            key={key}
            to={to}
            className={cx(
              'flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-all hover:-translate-y-0.5 hover:shadow-lift',
              tone,
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold leading-tight">{label}</p>
              <p className="truncate text-[11px] font-medium opacity-80">{hint}</p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 opacity-70" />
          </Link>
        ))}
      </div>
    </>
  )
}

/**
 * Accounts and profile edits waiting on an administrator.
 *
 * Both queues are derived from the directory the Users page already loads —
 * `pendingAccounts()` and `pendingProfileChanges()` are the same helpers that
 * page uses — so no new read, service or endpoint is introduced. The card only
 * links: approving still happens on Users, where the confirmation and the audit
 * entry live.
 */
function ApprovalsCard() {
  const { users, loading } = useUsers()

  const accounts = pendingAccounts(users)
  const profiles = pendingProfileChanges(users)
  const waiting = accounts.length + profiles.length

  return (
    <SectionCard
      variant="quiet"
      title="Waiting on you"
      description="Accounts and profile edits to review"
      bodyClassName="p-0"
      action={
        <Link to="/users" className="btn btn-ghost btn-sm">
          Open Users
        </Link>
      }
    >
      {loading ? (
        <SkeletonRows rows={2} columns={2} />
      ) : waiting === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing to approve."
          description="No account registrations or profile edits are pending."
          compact
        />
      ) : (
        <ul className="divide-y">
          <ApprovalRow
            icon={UserCheck}
            count={accounts.length}
            label={`account registration${accounts.length === 1 ? '' : 's'}`}
            names={accounts.map((u) => u.fullName)}
          />
          <ApprovalRow
            icon={ShieldAlert}
            count={profiles.length}
            label={`profile change${profiles.length === 1 ? '' : 's'}`}
            names={profiles.map((u) => u.fullName)}
          />
        </ul>
      )}
    </SectionCard>
  )
}

function ApprovalRow({ icon: Icon, count, label, names }) {
  if (count === 0) return null
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amberline-400/15">
        <Icon className="h-4 w-4 text-amberline-700 dark:text-amberline-400" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">
          {count} {label}
        </p>
        <p className="muted truncate text-xs">{names.join(' · ')}</p>
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ *
 * Student dashboard — the borrower's own workflow
 *
 * A deliberately different shape from the control desk above. The staff screen
 * opens on laboratory-wide counters because a member of staff is monitoring a
 * room; this one opens on the two buttons a student actually presses and then on
 * the tools in their hands, because a student is running an errand. Their own
 * figures come *after* that list, as a summary of it, not as the headline.
 *
 * Every number is the signed-in student's own, read from `studentDashboard()`
 * with their uid. Nothing here reports on other borrowers, the user directory or
 * the laboratory totals — a student cannot read those, so asking a different
 * question is more honest than showing a wrong answer.
 * ------------------------------------------------------------------ */

/**
 * First-run walkthrough for a student's own dashboard. It describes the three
 * things actually on this screen — the tools they are holding, their figures and
 * their recent activity — and nothing from the staff view.
 */
const STUDENT_DASHBOARD_TOUR = [
  {
    target: 'dash-stats',
    title: 'Your loans at a glance',
    text: 'What you are holding, what is due soon and anything overdue. Every figure here is yours alone.',
    icon: Package,
  },
  {
    target: 'dash-loans',
    title: 'Tools you have out',
    text: 'Everything currently in your hands, with its due date. Hand one back straight from this card.',
    icon: Wrench,
  },
  {
    target: 'dash-history',
    title: 'What you borrowed before',
    text: 'Your most recent loans and returns. Open View all for the complete history.',
    icon: ClipboardList,
  },
]

function StudentDashboard({
  loading,
  online = true,
  data,
  firstName,
  settings,
  selected,
  onSelect,
  userId,
}) {
  // Skeletons whenever there is nothing to render — including the moment between
  // a sign-out and the redirect, where the loader resolves to nothing.
  const busy = loading || !data

  // Once per account on this device, remembered separately from every other page.
  const tour = usePageTour('dashboard', userId)

  // The phone shell — the same breakpoint the layout switches its rail on.
  const isPwa = useMediaQuery('(max-width: 1023px)')

  // Alerts addressed to this student; the hook already scopes the read to them.
  const { unread } = useNotifications()

  return (
    <>
      {/* The greeting carries the two everyday actions, which is the first thing
          that tells this screen apart from the staff one. On a phone they are
          duplicated by the bottom bar but sit here as well: this is the top of
          the screen a student lands on, and reaching the thumb bar to start a
          borrow is a step this saves. */}
      <DashboardHero
        eyebrow={`${settings.labName} · your tools and loans`}
        title={`Good ${greeting()}, ${firstName}`}
        subtitle={
          busy
            ? undefined
            : data.overdue
              ? `Please return your ${data.overdue} overdue tool${data.overdue === 1 ? '' : 's'} first.`
              : data.activeLoans
                ? `You are holding ${data.activeLoans} tool${data.activeLoans === 1 ? '' : 's'} right now.`
                : 'Nothing out at the moment — scan a tool to borrow one.'
        }
        signals={{
          online,
          loading: busy,
          overdue: data?.overdue ?? 0,
          dueSoon: data?.dueSoon ?? 0,
          activeLoans: data?.activeLoans ?? 0,
          unread,
        }}
        name={firstName}
        actions={
          <>
            <Link to="/scan" className="btn btn-primary btn-sm">
              <QrCode className="h-4 w-4" />
              Scan to borrow
            </Link>
            <Link to="/return" className="btn btn-outline btn-sm">
              <Repeat className="h-4 w-4" />
              Return a tool
            </Link>
          </>
        }
      />

      {/* ----------------------------- middle: statistics -----------------------------
          Four compact tiles, full width above the content grid. They are `tile`
          rather than `card`: no shadow and a lighter hairline, so the row reads
          as a summary strip and the panels below it clearly outrank it.
          2 × 2 on a phone, 1 × 4 from `lg`. */}
      <div data-tour="dash-stats" className="mb-4 lg:mb-6">
        {busy ? (
          <SkeletonCards count={4} className="grid-cols-2 lg:grid-cols-4" />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
            <StatCard
              variant="tile"
              label="Active loans"
              value={data.activeLoans}
              icon={Package}
              tone="info"
              hint={data.activeLoans ? 'In your hands' : 'Nothing checked out'}
              to="/transactions?status=Borrowed"
            />
            <StatCard
              variant="tile"
              label="Due soon"
              value={data.dueSoon}
              icon={ClipboardList}
              tone="warning"
              hint={`Within ${settings.dueSoonThresholdDays} day(s)`}
              to="/transactions"
            />
            <StatCard
              variant="tile"
              label="Overdue"
              value={data.overdue}
              icon={AlertTriangle}
              tone="danger"
              hint={data.overdue ? 'Return these first' : 'Nothing late'}
              to="/transactions?status=Overdue"
            />
            <StatCard
              variant="tile"
              label="Available tools"
              value={data.availableTools}
              icon={CheckCircle2}
              tone="success"
              hint={`of ${data.totalTools} in the laboratory`}
              to="/tools?status=Available"
            />
          </div>
        )}
      </div>

      {/* ------------------------------- 12-column body -------------------------------
          Eight columns for what the student acts on, four for what they only
          refer to — a 2:1 split rather than the even thirds the page used to
          have. One column on a phone, where the secondary side is dropped
          entirely rather than stacked underneath. */}
      <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
        <div className="min-w-0 space-y-4 lg:col-span-8 lg:space-y-6">
          {/* The headline of the student screen: what is in their hands, at full
              width, with the return action on every row. */}
          <div data-tour="dash-loans">
            <SectionCard
              variant="panel"
              title="Tools you have out"
              description={
                busy
                  ? 'Everything you are holding right now'
                  : data.loans.length === 0
                    ? 'Nothing is checked out to you'
                    : `${data.loans.length} tool${data.loans.length === 1 ? '' : 's'}, soonest due first`
              }
              bodyClassName="p-0"
            >
              {busy ? (
                <SkeletonRows rows={3} columns={3} />
              ) : data.loans.length === 0 ? (
                <EmptyState
                  icon={Wrench}
                  title="You have no tools out."
                  description="Scan a tool or open the borrow desk to check one out."
                  compact
                  action={
                    <Link to="/scan" className="btn btn-primary btn-sm">
                      <QrCode className="h-4 w-4" />
                      Scan a tool
                    </Link>
                  }
                />
              ) : (
                <ul className="divide-y">
                  {data.loans.map((txn) => {
                    const late = data.overdueLoans.includes(txn)
                    return (
                      <li
                        key={txn.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                      >
                        <span
                          className={cx(
                            'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                            late ? 'bg-red-500/10' : 'bg-blue-500/10',
                          )}
                        >
                          {late ? (
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                          ) : (
                            <Wrench className="h-4 w-4 text-blue-500" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/tools/${txn.toolId}`}
                            className="block truncate text-sm font-bold hover:underline"
                          >
                            {txn.toolName}
                          </Link>
                          <p
                            className={cx(
                              'truncate text-xs',
                              late ? 'font-semibold text-red-600 dark:text-red-400' : 'muted',
                            )}
                          >
                            <span className="mono">{txn.toolId}</span> · {dueLabel(txn.dueDate)}
                          </p>
                        </div>
                        {/* `basis-full` drops the button onto its own line on a
                            phone instead of squeezing the tool name down to
                            "Torque Wrench 1…"; from `sm` it sits back on the
                            row. Either way a return is one tap away — the old
                            card hid this button entirely below `sm`. */}
                        <div className="basis-full pl-12 sm:basis-auto sm:pl-0">
                          <Link
                            to={`/return?tool=${txn.toolId}`}
                            className="btn btn-outline btn-sm shrink-0"
                          >
                            Return
                          </Link>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </SectionCard>
          </div>

          <div data-tour="dash-history">
            <SectionCard
              variant="panel"
              title="Your recent transactions"
              description="Your last few loans and returns"
              bodyClassName="p-0"
              action={
                <Link to="/transactions" className="btn btn-ghost btn-sm">
                  View all
                </Link>
              }
            >
              {busy ? (
                <SkeletonRows rows={4} />
              ) : (
                <TransactionTable
                  transactions={data.recent}
                  onSelect={onSelect}
                  compact
                  emptyTitle="You have no transactions yet."
                  emptyDescription="Borrow your first tool and it will appear here."
                />
              )}
            </SectionCard>
          </div>
        </div>

        {/* --------------------------- secondary column ---------------------------
            Four of the twelve columns, and every panel in here is `quiet`:
            tinted, borderless and unshadowed, so it reads as reference beside the
            white panels on the left rather than as another equal card.

            On a phone the bottom bar already owns Tools and Notifications, so
            rather than stacking this column underneath, the phone gets one
            compact strip at the end of the page — see below. */}
        {!isPwa && (
          <aside className="min-w-0 space-y-4 lg:col-span-4 lg:space-y-6">
            <SectionCard
              variant="quiet"
              title="Available tools"
              description="What you can borrow right now"
            >
              {busy ? (
                <SkeletonRows rows={2} columns={1} />
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="mono text-[40px] font-extrabold leading-none tracking-tight">
                      {data.availableTools}
                    </p>
                    <p className="subtle mt-2 text-xs">
                      of {data.totalTools} tools in the laboratory
                    </p>
                  </div>
                  <ProgressBar
                    value={data.availableTools}
                    max={data.totalTools}
                    barClassName="bg-emerald-500"
                  />
                  <Link to="/tools?status=Available" className="btn btn-outline w-full">
                    <Wrench className="h-4 w-4" />
                    Browse available tools
                  </Link>
                </div>
              )}
            </SectionCard>

            <SectionCard
              variant="quiet"
              title="Reminders"
              description="What needs your attention"
              bodyClassName="p-0"
            >
              {busy ? (
                <SkeletonRows rows={2} columns={1} />
              ) : data.overdueLoans.length === 0 && data.dueSoon === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="You are all clear."
                  description="No overdue tools and nothing due in the next few days."
                  compact
                />
              ) : (
                // No dividers in here: a quiet panel with three hairlines across
                // it puts back exactly the visual noise the tier is meant to shed.
                <ul className="space-y-1 px-2 pb-3 sm:px-3">
                  {data.overdueLoans.map((txn) => (
                    <li key={txn.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-500/10">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{txn.toolName}</p>
                        <p className="muted truncate text-xs">
                          Overdue — was due {formatDate(txn.dueDate)}
                        </p>
                      </div>
                    </li>
                  ))}
                  {data.dueSoon > 0 && (
                    <li className="flex items-center gap-3 rounded-xl px-2 py-2.5">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-orange-500/10">
                        <ClipboardList className="h-4 w-4 text-orange-500" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">
                          {data.dueSoon} tool{data.dueSoon === 1 ? '' : 's'} due soon
                        </p>
                        <p className="muted truncate text-xs">
                          Return within {settings.dueSoonThresholdDays} day(s) to stay on schedule.
                        </p>
                      </div>
                    </li>
                  )}
                </ul>
              )}
            </SectionCard>

            <SectionCard variant="quiet" title="Notifications" description="Alerts addressed to you">
              <Link to="/notifications" className="btn btn-outline w-full">
                <Bell className="h-4 w-4" />
                {unread > 0 ? `${unread} unread` : 'Open notification centre'}
              </Link>
            </SectionCard>
          </aside>
        )}
      </div>

      {/* The phone's replacement for the column above: one link, not a stacked
          copy of the column. Browsing the shelf is not repeated here any more —
          the Available tools tile in the statistics row already goes there — so
          all that is left is the notification centre, which the bottom bar
          carries as an icon but not as a count. */}
      {isPwa && !busy && (
        <Link
          to="/notifications"
          className="tile mt-4 flex items-center gap-3 p-3.5 transition-transform active:scale-[0.98]"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-amberline-400/15">
            <Bell className="h-[17px] w-[17px] text-amberline-700 dark:text-amberline-400" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight">
              {unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications'}
            </p>
            <p className="subtle truncate text-[11px]">Alerts addressed to you</p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 opacity-40" />
        </Link>
      )}

      <TransactionDetail transaction={selected} open={!!selected} onClose={() => onSelect(null)} />

      <Walkthrough steps={STUDENT_DASHBOARD_TOUR} open={tour.open} onClose={tour.close} />
    </>
  )
}

function UtilisationRow({ label, value, total, barClass }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="muted font-medium">{label}</span>
        <span className="mono font-bold">
          {value}
          <span className="subtle font-medium"> / {total}</span>
        </span>
      </div>
      <ProgressBar value={value} max={total} barClassName={barClass} />
    </div>
  )
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}
