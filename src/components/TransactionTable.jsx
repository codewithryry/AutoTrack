import { Link } from 'react-router-dom'
import { ArrowRight, Clock } from 'lucide-react'
import { TxnStatusBadge, EmptyState, TableWrap } from './ui'
import { formatDate, dueLabel, daysUntilDue } from '../utils/dates'
import { cx } from '../utils/helpers'
import { ACTIVE_TXN_STATUSES, TXN_STATUS } from '../utils/constants'

/**
 * Transaction list.
 *
 * Renders a real table from `sm` up and stacked cards on phones — the same
 * records either way, so nothing is hidden behind a horizontal scroll on a
 * handset held in one hand.
 */
export default function TransactionTable({
  transactions,
  onSelect,
  emptyTitle = 'No transactions recorded yet.',
  emptyDescription = 'Issued and returned tools will appear here.',
  showDue = true,
  compact = false,
}) {
  if (!transactions.length) {
    return (
      <EmptyState
        icon={Clock}
        title={emptyTitle}
        description={emptyDescription}
        compact={compact}
      />
    )
  }

  return (
    <>
      {/* ------------------------------ mobile ------------------------------ */}
      <ul className="divide-y sm:hidden">
        {transactions.map((txn) => {
          const overdue = txn.status === TXN_STATUS.OVERDUE
          return (
            <li key={txn.id}>
              <button
                type="button"
                onClick={() => onSelect?.(txn)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors
                           active:bg-black/5 dark:active:bg-white/5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{txn.toolName}</p>
                  <p className="muted mt-0.5 truncate text-xs">{txn.userName}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <TxnStatusBadge status={txn.status} />
                    <span className="subtle mono text-[11px]">
                      {formatDate(txn.borrowDate)}
                    </span>
                  </div>
                  {showDue && ACTIVE_TXN_STATUSES.includes(txn.status) && (
                    <p
                      className={cx(
                        'mt-1 text-[11px] font-bold',
                        overdue ? 'text-red-600 dark:text-red-400' : 'muted',
                      )}
                    >
                      {dueLabel(txn.dueDate)}
                    </p>
                  )}
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 opacity-40" />
              </button>
            </li>
          )
        })}
      </ul>

      {/* ------------------------------ desktop ----------------------------- */}
      <TableWrap className="hidden sm:block">
        <table className="tbl">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Borrower</th>
              <th>Date Borrowed</th>
              <th>Due Date</th>
              {!compact && <th>Returned</th>}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((txn) => {
              const overdue = txn.status === TXN_STATUS.OVERDUE
              const active = ACTIVE_TXN_STATUSES.includes(txn.status)
              return (
                <tr
                  key={txn.id}
                  onClick={() => onSelect?.(txn)}
                  className={cx(onSelect && 'cursor-pointer')}
                >
                  <td>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{txn.toolName}</p>
                      <Link
                        to={`/tools/${txn.toolId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="subtle mono text-xs hover:underline"
                      >
                        {txn.toolId}
                      </Link>
                    </div>
                  </td>
                  <td>
                    <p className="truncate font-medium">{txn.userName}</p>
                    <p className="subtle text-xs">{txn.userRole}</p>
                  </td>
                  <td className="mono whitespace-nowrap text-xs">{formatDate(txn.borrowDate)}</td>
                  <td className="whitespace-nowrap">
                    <span className="mono text-xs">{formatDate(txn.dueDate)}</span>
                    {showDue && active && (
                      <span
                        className={cx(
                          'block text-[11px] font-bold',
                          overdue
                            ? 'text-red-600 dark:text-red-400'
                            : daysUntilDue(txn.dueDate) <= 1
                              ? 'text-orange-600 dark:text-orange-400'
                              : 'subtle',
                        )}
                      >
                        {dueLabel(txn.dueDate)}
                      </span>
                    )}
                  </td>
                  {!compact && (
                    <td className="mono whitespace-nowrap text-xs">
                      {txn.returnDate ? formatDate(txn.returnDate) : '—'}
                    </td>
                  )}
                  <td>
                    <TxnStatusBadge status={txn.status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableWrap>
    </>
  )
}
