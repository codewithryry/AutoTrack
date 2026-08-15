import { useMemo } from 'react'
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
  DetailItem,
  EmptyState,
  PageHeader,
  SectionCard,
  Skeleton,
  SkeletonRows,
  StatusBadge,
  ConditionBadge,
} from '../components/ui'
import { useTool, useToolActivity, useToolTransactions } from '../hooks'
import { useApp } from '../context/AppContext'
import { visibleTransactions } from '../utils/permissions'
import { cx, sortBy } from '../utils/helpers'
import { formatDate, formatDateTime, formatTime, timeAgo } from '../utils/dates'
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
  const { user } = useApp()
  const { tool, loading } = useTool(id)
  const { entries: logEntries, loading: loadingLog, allowed } = useToolActivity(id)

  // The loans themselves, for both audiences and for two different reasons.
  //
  // Staff need them to answer the question this page is opened for — who had
  // this tool last, when it went out and whether it came back — which the
  // activity log narrates but does not state. A student needs them because the
  // log is staff-only, so their timeline is built from their own loans instead.
  //
  // The same read serves both safely: the policies return a student only their
  // own rows, the data layer sends the same filter, and `useToolTransactions`
  // applies `visibleTransactions` on top.
  const { transactions, loading: loadingTxns, error: txnError } = useToolTransactions(id)

  const ownEntries = useMemo(() => {
    if (allowed) return []
    const mine = visibleTransactions(user, transactions)
    const rows = mine.flatMap((txn) => [
      {
        id: `${txn.id}-borrow`,
        action: ACTIVITY.TOOL_BORROWED,
        createdAt: txn.borrowDate,
        userName: txn.userName,
        message: `Borrowed by ${txn.userName}`,
      },
      ...(txn.returnDate
        ? [
            {
              id: `${txn.id}-return`,
              action: ACTIVITY.TOOL_RETURNED,
              createdAt: txn.returnDate,
              userName: txn.userName,
              message: txn.conditionIn
                ? `Returned in ${txn.conditionIn} condition`
                : 'Returned',
            },
          ]
        : []),
    ])
    return sortBy(rows, 'createdAt', 'desc')
  }, [allowed, user, transactions])

  const entries = allowed ? logEntries : ownEntries
  const loadingEntries = allowed ? loadingLog : loadingTxns

  // The most recent loan on this tool — `listForTool` sorts newest first, and
  // the list is already scoped to what this role may read, so for staff this is
  // the tool's last borrower and for a student it is their own last loan.
  const lastLoan = transactions[0] ?? null
  const stillOut = !!lastLoan && !lastLoan.returnDate

  // The same shape this page settles into: back link, heading, timeline card.
  if (loading && !tool) {
    return (
      <div className="animate-fade-in">
        <Skeleton className="mb-3 h-4 w-36 rounded" />
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-6 w-44 rounded" />
            <Skeleton className="h-3.5 w-56 max-w-full rounded" />
          </div>
          <Skeleton className="h-6 w-32 rounded-full" />
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    )
  }

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
        // Staff read the tool's laboratory record; a student reads their own
        // borrowings of it, so the page is named for what each of them sees.
        title={allowed ? 'Tool history' : 'Borrow history'}
        description={`${tool.name} · ${tool.id}`}
        icon={History}
      >
        <StatusBadge status={tool.status} />
        <ConditionBadge condition={tool.condition} />
      </PageHeader>

      {/* The question this page is opened to answer, stated rather than left to
          be read out of the timeline: who had the tool last, when it went out
          and whether it is back. Built from the same borrowing records the timeline
          below is, so it can never disagree with them. Staff only — an
          instructor or administrator needs to know who holds a tool, while a
          student sees nothing but their own timeline below. */}
      {allowed && lastLoan && (
        <SectionCard
          className="mb-4"
          title={stillOut ? 'Currently with' : 'Last used by'}
          description="The most recent borrowing recorded against this tool"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-bold">
                <UserCheck className="h-4 w-4 shrink-0 opacity-60" />
                <span className="truncate">{lastLoan.userName}</span>
              </p>
              <p className="subtle mono mt-0.5 text-[11px]">{lastLoan.id}</p>
            </div>
            <StatusBadge status={lastLoan.status} />
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <DetailItem label="Borrowed" className="min-w-0" mono>
              {formatDateTime(lastLoan.borrowDate)}
            </DetailItem>
            <DetailItem label="Due" className="min-w-0" mono>
              {formatDate(lastLoan.dueDate)}
            </DetailItem>
            <DetailItem label="Returned" className="min-w-0" mono>
              {lastLoan.returnDate ? formatDateTime(lastLoan.returnDate) : 'Still out'}
            </DetailItem>
          </dl>
        </SectionCard>
      )}

      <SectionCard
        title="Activity timeline"
        description={`${entries.length} event${entries.length === 1 ? '' : 's'} ${
          allowed ? 'recorded for this tool' : 'recorded on your borrowings of this tool'
        }`}
        bodyClassName="p-0"
      >
        {loadingEntries && !entries.length ? (
          <SkeletonRows rows={5} columns={2} />
        ) : !allowed && txnError ? (
          <EmptyState
            icon={History}
            title="This history could not be loaded."
            description={txnError.message ?? 'Please try again in a moment.'}
          />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={History}
            title="No history recorded yet."
            description={
              allowed
                ? 'Borrowing, returns and maintenance for this tool will appear here.'
                : 'Your own borrowing and returns for this tool will appear here.'
            }
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
