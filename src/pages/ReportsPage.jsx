import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, RotateCcw } from 'lucide-react'
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  ProgressBar,
  SectionCard,
  StatusBadge,
  TableWrap,
  TextField,
} from '../components/ui'
import { useApp } from '../context/AppContext'
import { useReport } from '../hooks'
import { TOOL_STATUS } from '../utils/constants'
import Walkthrough, { usePageTour } from '../components/Walkthrough'
import { cx, percent } from '../utils/helpers'
import { formatDate } from '../utils/dates'

/**
 * Reports.
 *
 * Every figure is derived from the transaction and tool collections at render
 * time — there is no stored aggregate to fall out of date.
 */

// One palette for every chart, aligned with the status colours used elsewhere.
const STATUS_COLORS = {
  [TOOL_STATUS.AVAILABLE]: '#10b981',
  [TOOL_STATUS.BORROWED]: '#3b82f6',
  [TOOL_STATUS.OVERDUE]: '#ef4444',
  [TOOL_STATUS.MAINTENANCE]: '#f97316',
  [TOOL_STATUS.DAMAGED]: '#f43f5e',
  [TOOL_STATUS.LOST]: '#94a3b8',
  [TOOL_STATUS.RETIRED]: '#cbd5e1',
}

const SERIES = {
  borrowed: '#3b82f6',
  returned: '#10b981',
  overdue: '#ef4444',
  accent: '#F0B429',
}

/**
 * Columns for the tool-utilisation export. The download itself now lives in
 * Settings → Data management, alongside the other exports.
 */
export const UTILIZATION_CSV_COLUMNS = [
  { key: 'id', label: 'Tool ID' },
  { key: 'name', label: 'Tool' },
  { key: 'category', label: 'Category' },
  { key: 'status', label: 'Status' },
  { key: 'condition', label: 'Condition' },
  { key: 'location', label: 'Location' },
  { key: 'timesBorrowed', label: 'Times Borrowed' },
  { key: 'daysOut', label: 'Days Out' },
  { key: 'lastBorrowed', label: 'Last Borrowed', format: (v) => formatDate(v, '') },
]

/**
 * The reports walkthrough — administrators only, the only role with reports.
 */
const reportsTour = [
  {
    target: 'reports-range',
    title: 'Choose a period',
    text: 'Every figure on this page is derived from the records in this date range, live — there is no stored total to go stale. Leave both dates empty for the whole history, and "All time" clears them again.',
  },
  {
    target: 'reports-stats',
    title: 'The headline rates',
    text: 'Return rate, on-time returns, average loan length and damage rate for the period in scope — the four figures that say whether the laboratory is running to schedule.',
  },
  {
    target: 'reports-monthly',
    title: 'Borrowing over time',
    text: 'Tools issued against tools returned over the last six months, so a busy month or a growing backlog is visible at a glance.',
  },
  {
    target: 'reports-status',
    title: 'Where the tools are',
    text: 'The inventory split by status — on the shelf, out on loan, overdue, in for service, damaged or written off.',
  },
  {
    target: 'reports-demand',
    title: 'Highest demand',
    text: 'The tools borrowed most often in the period, which is what to keep stocked and serviced.',
  },
  {
    target: 'reports-condition',
    title: 'Fleet condition',
    text: 'How the inventory is holding up, from excellent down to needing repair.',
  },
  {
    target: 'reports-category',
    title: 'By discipline',
    text: 'The inventory broken down by automotive category, for planning purchases across the programme.',
  },
  {
    target: 'reports-users',
    title: 'Who is borrowing',
    text: 'The busiest borrowers in the period, with how many tools each has out right now.',
  },
  {
    target: 'reports-utilisation',
    title: 'Per-tool load',
    text: 'Every tool with its times borrowed, days out and last loan. The same table exports as a CSV from Settings → Data.',
  },
]

export default function ReportsPage() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const { user } = useApp()
  const range = useMemo(() => ({ from, to }), [from, to])
  const { report, loading, error, reload } = useReport(range)
  const tour = usePageTour('reports', user?.id)

  if (error && !report) {
    return (
      <>
        <div className="card">
          <ErrorState
            title="The report could not be built"
            description={error.message}
            onRetry={reload}
          />
        </div>
      </>
    )
  }
  if (loading && !report) return <LoadingBlock label="Building the laboratory report…" />
  if (!report) return null

  const { stats, metrics, monthly, status, category, condition, mostBorrowed, activeUsers, utilization } =
    report

  const hasRange = !!from || !!to

  return (
    <>

      {/* ------------------------------ date range ------------------------------ */}
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3" data-tour="reports-range">
        <TextField
          label="From"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="w-full sm:w-44"
        />
        <TextField
          label="To"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-full sm:w-44"
        />
        {hasRange && (
          <button
            type="button"
            onClick={() => {
              setFrom('')
              setTo('')
            }}
            className="btn btn-ghost"
          >
            <RotateCcw className="h-4 w-4" />
            All time
          </button>
        )}
        <p className="subtle ml-auto self-center text-xs">
          {metrics.total} transaction{metrics.total === 1 ? '' : 's'} in scope
        </p>
      </div>

      {/* ------------------------------- headline ------------------------------- */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-tour="reports-stats">
        <Metric label="Return rate" value={`${metrics.returnRate}%`} hint={`${metrics.returned} of ${metrics.total} closed`} tone="emerald" />
        <Metric label="On-time returns" value={`${metrics.onTimeRate}%`} hint={`${metrics.late} returned late`} tone="blue" />
        <Metric label="Avg. loan length" value={`${metrics.averageDays}d`} hint="From issue to return" tone="amber" />
        <Metric label="Damage rate" value={`${metrics.damageRate}%`} hint={`${metrics.damaged} damaged returns`} tone="red" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ------------------------- monthly activity ------------------------- */}
        <SectionCard
          data-tour="reports-monthly"
          title="Monthly borrowing activity"
          description="Tools issued and returned over the last six months"
          className="xl:col-span-2"
        >
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,.25)" />
                <XAxis dataKey="month" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,.12)' }} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Bar dataKey="borrowed" name="Borrowed" fill={SERIES.borrowed} radius={[4, 4, 0, 0]} maxBarSize={38} />
                <Bar dataKey="returned" name="Returned" fill={SERIES.returned} radius={[4, 4, 0, 0]} maxBarSize={38} />
                <Bar dataKey="overdue" name="Overdue" fill={SERIES.overdue} radius={[4, 4, 0, 0]} maxBarSize={38} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* --------------------------- status donut --------------------------- */}
        <SectionCard
          data-tour="reports-status"
          title="Inventory status"
          description="Where the tools are right now"
        >
          {status.length === 0 ? (
            <EmptyState icon={BarChart3} title="No tools registered." compact />
          ) : (
            <>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={status}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="58%"
                      outerRadius="88%"
                      paddingAngle={2}
                      stroke="none"
                    >
                      {status.map((entry) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? '#94a3b8'} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip suffix=" tools" />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1.5">
                {status.map((entry) => (
                  <li key={entry.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: STATUS_COLORS[entry.name] ?? '#94a3b8' }}
                    />
                    <span className="muted flex-1 truncate">{entry.name}</span>
                    <span className="mono font-bold">{entry.value}</span>
                    <span className="subtle mono w-9 text-right">
                      {percent(entry.value, stats.totalTools)}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>

        {/* --------------------------- most borrowed --------------------------- */}
        <SectionCard
          data-tour="reports-demand"
          title="Most borrowed tools"
          description="Highest demand equipment"
          className="xl:col-span-2"
        >
          {mostBorrowed.length === 0 ? (
            <EmptyState icon={BarChart3} title="No borrowing activity in this period." compact />
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={mostBorrowed}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,.25)" />
                  <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={AXIS_TICK}
                    axisLine={false}
                    tickLine={false}
                    width={140}
                    tickFormatter={(value) => (value.length > 20 ? `${value.slice(0, 19)}…` : value)}
                  />
                  <Tooltip content={<ChartTooltip suffix=" loans" />} cursor={{ fill: 'rgba(148,163,184,.12)' }} />
                  <Bar dataKey="count" name="Times borrowed" fill={SERIES.accent} radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        {/* ---------------------------- condition ---------------------------- */}
        <SectionCard
          data-tour="reports-condition"
          title="Tool condition"
          description="Fleet health across the inventory"
        >
          {condition.length === 0 ? (
            <EmptyState icon={BarChart3} title="No condition data." compact />
          ) : (
            <ul className="space-y-3">
              {condition.map((entry) => (
                <li key={entry.name}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="muted font-medium">{entry.name}</span>
                    <span className="mono font-bold">{entry.value}</span>
                  </div>
                  <ProgressBar
                    value={entry.value}
                    max={stats.totalTools}
                    barClassName={CONDITION_BAR[entry.name] ?? 'bg-slate-400'}
                  />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* --------------------------- category split --------------------------- */}
        <SectionCard
          data-tour="reports-category"
          title="Category breakdown"
          description="Inventory by automotive discipline"
          className="xl:col-span-2"
        >
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={category} margin={{ top: 8, right: 8, left: -18, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,.25)" />
                <XAxis
                  dataKey="name"
                  tick={{ ...AXIS_TICK, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                  height={60}
                />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,.12)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="available" name="Available" stackId="a" fill={SERIES.returned} maxBarSize={40} />
                <Bar dataKey="out" name="On loan" stackId="a" fill={SERIES.borrowed} radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* ---------------------------- active users ---------------------------- */}
        <SectionCard
          data-tour="reports-users"
          title="Most active users"
          description="Borrowing leaders"
          bodyClassName="p-0"
        >
          {activeUsers.length === 0 ? (
            <EmptyState icon={BarChart3} title="No borrowing activity." compact />
          ) : (
            <ul className="divide-y">
              {activeUsers.map((row, index) => (
                <li key={row.userId} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="subtle mono w-4 shrink-0 text-xs font-bold">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{row.name}</p>
                    <p className="subtle truncate text-xs">
                      {row.role}
                      {row.overdue > 0 && ` · ${row.overdue} overdue`}
                    </p>
                  </div>
                  <span className="mono shrink-0 text-sm font-bold">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* --------------------------- utilisation table --------------------------- */}
        <SectionCard
          data-tour="reports-utilisation"
          title="Tool utilisation"
          description="Per-tool borrowing load"
          bodyClassName="p-0"
          className="xl:col-span-3"
        >
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Category</th>
                  <th>Times borrowed</th>
                  <th>Days out</th>
                  <th>Last borrowed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {utilization.slice(0, 20).map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/tools/${row.id}`} className="block min-w-0 hover:underline">
                        <span className="block truncate font-semibold">{row.name}</span>
                        <span className="subtle mono block text-xs">{row.id}</span>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-xs">{row.category}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="mono w-6 text-sm font-bold">{row.timesBorrowed}</span>
                        <ProgressBar
                          value={row.timesBorrowed}
                          max={utilization[0]?.timesBorrowed || 1}
                          className="w-24"
                          barClassName="bg-amberline-500"
                        />
                      </div>
                    </td>
                    <td className="mono text-xs">{row.daysOut}</td>
                    <td className="mono whitespace-nowrap text-xs">
                      {formatDate(row.lastBorrowed, 'Never')}
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {utilization.length > 20 && (
            <p className="subtle border-t px-4 py-2.5 text-xs">
              Showing the 20 most-used tools of {utilization.length}. Export the CSV for the full
              list.
            </p>
          )}
        </SectionCard>
      </div>

      <Walkthrough steps={reportsTour} open={tour.open} onClose={tour.close} />
    </>
  )
}

const CONDITION_BAR = {
  Excellent: 'bg-emerald-500',
  Good: 'bg-teal-500',
  Fair: 'bg-amber-500',
  'Needs Repair': 'bg-orange-500',
  Damaged: 'bg-red-500',
}

const AXIS_TICK = { fontSize: 11, fill: 'rgb(var(--text-muted))' }

const METRIC_TONES = {
  emerald: 'text-emerald-600 dark:text-emerald-400',
  blue: 'text-blue-600 dark:text-blue-400',
  amber: 'text-amberline-700 dark:text-amberline-400',
  red: 'text-red-600 dark:text-red-400',
}

function Metric({ label, value, hint, tone }) {
  return (
    <div className="card p-3.5">
      <p className="subtle text-[11px] font-bold uppercase tracking-wider">{label}</p>
      <p className={cx('mono mt-1 text-2xl font-extrabold leading-none', METRIC_TONES[tone])}>
        {value}
      </p>
      {hint && <p className="subtle mt-1.5 truncate text-xs">{hint}</p>}
    </div>
  )
}

/** Themed tooltip so charts read correctly in both light and dark. */
function ChartTooltip({ active, payload, label, suffix = '' }) {
  if (!active || !payload?.length) return null
  return (
    <div className="card px-3 py-2 shadow-panel">
      {label && <p className="mb-1 text-xs font-bold">{label}</p>}
      {payload.map((entry) => (
        <p key={entry.dataKey ?? entry.name} className="flex items-center gap-2 text-xs">
          <span
            className="h-2 w-2 shrink-0 rounded-sm"
            style={{ background: entry.color ?? entry.payload?.fill }}
          />
          <span className="muted">{entry.name}</span>
          <span className="mono ml-auto font-bold">
            {entry.value}
            {suffix}
          </span>
        </p>
      ))}
    </div>
  )
}
