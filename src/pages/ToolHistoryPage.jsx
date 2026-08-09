import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowLeftRight,
  ClipboardList,
  HardHat,
  History,
  PackageSearch,
  Pencil,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Undo2,
  UserCheck,
} from 'lucide-react'
import {
  EmptyState,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusBadge,
  ConditionBadge,
} from '../components/ui'
import { useTool, useToolActivity } from '../hooks'
import { cx } from '../utils/helpers'
import { formatDate, formatTime, timeAgo } from '../utils/dates'
import { ACTIVITY } from '../utils/constants'

/**
 * Complete activity timeline for one tool, rendered from the activity log —
 * borrowing, returns, condition changes, maintenance and edits in one thread.
 */

const ENTRY_STYLES = {
  [ACTIVITY.TOOL_CREATED]: { icon: Plus, dot: 'bg-amberline-500', label: 'Added to inventory' },
  [ACTIVITY.TOOL_UPDATED]: { icon: Pencil, dot: 'bg-slate-400', label: 'Record updated' },
  [ACTIVITY.TOOL_DELETED]: { icon: Trash2, dot: 'bg-red-400', label: 'Removed' },
  [ACTIVITY.TOOL_BORROWED]: { icon: ArrowLeftRight, dot: 'bg-blue-500', label: 'Borrowed' },
  [ACTIVITY.TOOL_RETURNED]: { icon: Undo2, dot: 'bg-emerald-500', label: 'Returned' },
  [ACTIVITY.TOOL_OVERDUE]: { icon: ShieldAlert, dot: 'bg-red-500', label: 'Overdue' },
  [ACTIVITY.STATUS_CHANGED]: { icon: RotateCcw, dot: 'bg-orange-500', label: 'Status changed' },
  [ACTIVITY.CONDITION_CHANGED]: { icon: ShieldAlert, dot: 'bg-orange-400', label: 'Condition changed' },
  [ACTIVITY.MAINTENANCE_SCHEDULED]: { icon: HardHat, dot: 'bg-violet-500', label: 'Maintenance' },
  [ACTIVITY.MAINTENANCE_COMPLETED]: { icon: HardHat, dot: 'bg-teal-500', label: 'Maintenance done' },
}

const DEFAULT_STYLE = { icon: ClipboardList, dot: 'bg-slate-400', label: 'Activity' }

export default function ToolHistoryPage() {
  const { id } = useParams()
  const { tool, loading } = useTool(id)
  const { entries, loading: loadingEntries } = useToolActivity(id)

  if (loading && !tool) return <LoadingBlock label="Loading tool history…" />

  if (!tool) {
    return (
      <div className="card">
        <EmptyState
          icon={PackageSearch}
          title="Tool not found."
          description={`No tool is registered under ${id}.`}
          action={
            <Link to="/tools" className="btn btn-primary">
              Back to inventory
            </Link>
          }
        />
      </div>
    )
  }

  // Group by calendar day so the timeline reads like a logbook.
  const groups = entries.reduce((acc, entry) => {
    const key = formatDate(entry.createdAt)
    ;(acc[key] ||= []).push(entry)
    return acc
  }, {})

  return (
    <>
      <Link
        to={`/tools/${tool.id}`}
        className="muted mb-3 inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to {tool.name}
      </Link>

      <PageHeader
        title="Tool history"
        description={`${tool.name} · ${tool.id}`}
        icon={History}
      >
        <StatusBadge status={tool.status} />
        <ConditionBadge condition={tool.condition} />
      </PageHeader>

      <SectionCard
        title="Activity timeline"
        description={`${entries.length} event${entries.length === 1 ? '' : 's'} recorded for this tool`}
        bodyClassName="p-0"
      >
        {loadingEntries && !entries.length ? (
          <LoadingBlock label="Loading timeline…" />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={History}
            title="No history recorded yet."
            description="Borrowing, returns and maintenance for this tool will appear here."
          />
        ) : (
          <div className="p-4 sm:p-5">
            {Object.entries(groups).map(([day, dayEntries]) => (
              <section key={day} className="mb-6 last:mb-0">
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="mono text-xs font-bold uppercase tracking-wider">{day}</h3>
                  <span className="h-px flex-1" style={{ background: 'rgb(var(--border))' }} />
                  <span className="subtle text-[11px] font-semibold">
                    {dayEntries.length} event{dayEntries.length === 1 ? '' : 's'}
                  </span>
                </div>

                <ol className="relative space-y-4 border-l pl-5">
                  {dayEntries.map((entry) => {
                    const style = ENTRY_STYLES[entry.action] ?? DEFAULT_STYLE
                    const Icon = style.icon
                    return (
                      <li key={entry.id} className="relative">
                        <span
                          className={cx(
                            'absolute -left-[27px] top-0 grid h-4 w-4 place-items-center rounded-full ring-4',
                            style.dot,
                          )}
                          style={{ '--tw-ring-color': 'rgb(var(--surface))' }}
                        >
                          <Icon className="h-2.5 w-2.5 text-white" />
                        </span>

                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <p className="text-sm font-semibold leading-snug">{entry.message}</p>
                        </div>
                        <p className="subtle mt-0.5 text-xs">
                          <span className="mono">{formatTime(entry.createdAt)}</span>
                          {entry.userName && entry.userName !== 'System' && (
                            <>
                              {' · '}
                              <span className="inline-flex items-center gap-1">
                                <UserCheck className="h-3 w-3" />
                                {entry.userName}
                              </span>
                            </>
                          )}
                          {' · '}
                          {timeAgo(entry.createdAt)}
                        </p>

                        {entry.meta?.from && entry.meta?.to && (
                          <p className="subtle mt-1 text-[11px]">
                            <span className="line-through">{entry.meta.from}</span>
                            {' → '}
                            <span className="font-bold">{entry.meta.to}</span>
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  )
}
