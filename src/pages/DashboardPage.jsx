import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  HardHat,
  Package,
  QrCode,
  Repeat,
  ShieldAlert,
  TrendingUp,
  Users as UsersIcon,
  Wrench,
} from 'lucide-react'
import StatCard from '../components/StatCard'
import TransactionTable from '../components/TransactionTable'
import TransactionDetail from '../components/TransactionDetail'
import {
  EmptyState,
  PageHeader,
  ProgressBar,
  SectionCard,
  SkeletonCards,
  SkeletonRows,
} from '../components/ui'
import { useApp } from '../context/AppContext'
import { useDashboard } from '../hooks'
import { PERM } from '../utils/permissions'
import { cx, initials } from '../utils/helpers'
import { formatDate, timeAgo } from '../utils/dates'

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

export default function DashboardPage() {
  const { user, can, settings } = useApp()
  const { dashboard, loading } = useDashboard()
  const [selected, setSelected] = useState(null)

  const stats = dashboard?.stats
  const firstName = user?.fullName?.split(' ')[0] ?? 'there'

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${firstName}`}
        description={`${settings.labName} · ${settings.labLocation}`}
      >
        <Link to="/scan" className="btn btn-primary">
          <QrCode className="h-4 w-4" />
          Scan tool
        </Link>
        {can(PERM.BORROW) && (
          <Link to="/borrow" className="btn btn-outline">
            <Repeat className="h-4 w-4" />
            Borrow / Return
          </Link>
        )}
      </PageHeader>

      {/* ------------------------------ counters ------------------------------ */}
      {loading && !dashboard ? (
        <SkeletonCards count={5} className="grid-cols-2 lg:grid-cols-5" />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            label="Total tools"
            value={stats.totalTools}
            icon={Boxes}
            tone="accent"
            hint={`${stats.inCirculation} in circulation`}
            to="/tools"
          />
          <StatCard
            label="Available"
            value={stats.available}
            icon={CheckCircle2}
            tone="success"
            hint={`${stats.availabilityRate}% of usable stock`}
            to="/tools?status=Available"
          />
          <StatCard
            label="Borrowed"
            value={stats.borrowed}
            icon={Package}
            tone="info"
            hint={stats.dueSoon ? `${stats.dueSoon} due soon` : 'None due today'}
            to="/tools?status=Borrowed"
          />
          <StatCard
            label="Overdue"
            value={stats.overdue}
            icon={AlertTriangle}
            tone="danger"
            hint={stats.overdue ? 'Needs follow-up' : 'All on schedule'}
            to="/tools?status=Overdue"
          />
          <StatCard
            label="Damaged"
            value={stats.damaged}
            icon={ShieldAlert}
            tone="warning"
            hint={`${stats.maintenance} under maintenance`}
            to="/tools?status=Damaged"
          />
        </div>
      )}

      {/* --------------------------- secondary counters --------------------------- */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total users"
          value={stats?.totalUsers ?? 0}
          icon={UsersIcon}
          hint={`${stats?.activeUsers ?? 0} active`}
          to={can(PERM.USER_VIEW) ? '/users' : undefined}
          loading={loading && !dashboard}
        />
        <StatCard
          label="Today's transactions"
          value={stats?.todayTransactions ?? 0}
          icon={ClipboardList}
          hint={`${stats?.todayBorrowed ?? 0} out · ${stats?.todayReturned ?? 0} back`}
          to="/transactions"
          loading={loading && !dashboard}
        />
        <StatCard
          label="Active loans"
          value={stats?.activeLoans ?? 0}
          icon={Repeat}
          tone="info"
          hint={`${stats?.dueSoon ?? 0} due within ${settings.dueSoonThresholdDays} day(s)`}
          to="/transactions?status=Borrowed"
          loading={loading && !dashboard}
        />
        <StatCard
          label="Tool utilisation"
          value={`${stats?.utilization ?? 0}%`}
          icon={TrendingUp}
          tone="accent"
          hint="Share of stock currently out"
          loading={loading && !dashboard}
        />
      </div>

      {/* ------------------------------ main grid ------------------------------ */}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <SectionCard
            title="Recent transactions"
            description="Latest borrowing activity in the laboratory"
            bodyClassName="p-0"
            action={
              <Link to="/transactions" className="btn btn-ghost btn-sm">
                View all
              </Link>
            }
          >
            {loading && !dashboard ? (
              <SkeletonRows rows={4} />
            ) : (
              <TransactionTable
                transactions={dashboard.recent}
                onSelect={setSelected}
                compact
                emptyTitle="No transactions recorded yet."
                emptyDescription="Scan a tool and issue it to create the first record."
              />
            )}
          </SectionCard>

          {/* overdue */}
          <SectionCard
            title="Overdue summary"
            description="Tools that have passed their return date"
            bodyClassName="p-0"
          >
            {loading && !dashboard ? (
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
                    {tool && can(PERM.RETURN) && (
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
            title="Most borrowed tools"
            description="Highest demand equipment in the workshop"
          >
            {loading && !dashboard ? (
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

        {/* ------------------------------ side column ------------------------------ */}
        <div className="space-y-4">
          <SectionCard title="Utilisation" description="Where the inventory is right now">
            {loading && !dashboard ? (
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
            {loading && !dashboard ? (
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
              title="Most active borrowers"
              description="Students and staff using the laboratory"
              bodyClassName="p-0"
            >
              {loading && !dashboard ? (
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
            title="Recent activity"
            description="Live log from the tool room"
            bodyClassName="p-4"
          >
            {loading && !dashboard ? (
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
        </div>
      </div>

      <TransactionDetail
        transaction={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
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
