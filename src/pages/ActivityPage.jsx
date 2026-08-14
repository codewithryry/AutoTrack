import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import {
  EmptyState,
  ErrorState,
  SectionCard,
  SkeletonRows,
} from '../components/ui'
import { useActivity } from '../hooks'
import { cx } from '../utils/helpers'
import { formatDateTime, timeAgo } from '../utils/dates'

/**
 * The laboratory's activity log in full — the same stream the dashboard's
 * "Recent activity" panel shows the newest three of, without the transaction
 * table's per-loan framing: an entry here can be an edit, a status change or a
 * maintenance record, not only a borrow or a return.
 *
 * Read from the existing activity service, which is staff-scoped in the data
 * layer and by the security rules.
 */

const TONE = {
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

const PAGE_SIZE = 50

export default function ActivityPage() {
  // The streamed tail, deeper than the dashboard's: the page is where the whole
  // log is read, so it asks for a page at a time rather than a handful.
  const [limit, setLimit] = useState(PAGE_SIZE)
  const { entries, loading, error, reload } = useActivity(limit)

  const groups = useMemo(() => {
    const map = new Map()
    for (const entry of entries) {
      const day = new Date(entry.createdAt).toDateString()
      if (!map.has(day)) map.set(day, [])
      map.get(day).push(entry)
    }
    return [...map.entries()]
  }, [entries])

  return (
    <>
      <SectionCard variant="panel" bodyClassName="p-4">
        {error ? (
          <ErrorState
            title="The activity log could not be loaded"
            description={error.message}
            onRetry={reload}
          />
        ) : loading && !entries.length ? (
          <SkeletonRows rows={6} columns={1} />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No activity recorded yet."
            description="Borrowing, returns, edits and maintenance appear here as they happen."
          />
        ) : (
          <div className="space-y-5">
            {groups.map(([day, rows]) => (
              <div key={day}>
                <p className="subtle mb-2.5 text-[10px] font-bold uppercase tracking-[0.16em]">
                  {day}
                </p>
                <ol className="relative space-y-4 border-l pl-4">
                  {rows.map((entry) => (
                    <li key={entry.id} className="relative">
                      <span
                        className={cx(
                          'absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-4',
                          TONE[entry.action] ?? 'bg-slate-400',
                        )}
                        style={{ '--tw-ring-color': 'rgb(var(--surface))' }}
                      />
                      <p className="text-[13px] font-semibold leading-snug">{entry.message}</p>
                      <p className="subtle mt-0.5 text-[11px]">
                        {entry.toolId ? (
                          <Link to={`/tools/${entry.toolId}`} className="hover:underline">
                            {entry.toolName}
                          </Link>
                        ) : (
                          entry.userName
                        )}
                        {' · '}
                        <span title={formatDateTime(entry.createdAt)}>
                          {timeAgo(entry.createdAt)}
                        </span>
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            ))}

            {/* The tail is paged rather than streamed whole: the button asks the
                same service for a deeper slice. */}
            {entries.length >= limit && (
              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => setLimit((value) => value + PAGE_SIZE)}
                  className="btn btn-outline btn-sm"
                  disabled={loading}
                >
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </>
  )
}
