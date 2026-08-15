import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarClock, Filter, Search, Undo2, XCircle } from 'lucide-react'
import Walkthrough, { usePageTour } from '../components/Walkthrough'
import {
  ConfirmDialog,
  ErrorState,
  FilterSelect,
  MobileFilterBar,
  PageHeader,
  SearchInput,
  SectionCard,
  SkeletonRows,
  TextField,
} from '../components/ui'
import TransactionTable from '../components/TransactionTable'
import TransactionDetail from '../components/TransactionDetail'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useDebounced, useMediaQuery, useTools, useTransactions, useUsers } from '../hooks'
import * as txnService from '../services/transactions'
import { cx } from '../utils/helpers'
import { canReturnTransaction, isInstructor, isStudent, PERM } from '../utils/permissions'
import { ACTIVE_TXN_STATUSES, TXN_STATUS, TXN_STATUSES } from '../utils/constants'
import { formatDate, fromDateInput, toDateInput } from '../utils/dates'

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'due-soonest', label: 'Due soonest' },
  { value: 'tool', label: 'Tool name' },
  { value: 'borrower', label: 'Borrower' },
]

export const TRANSACTIONS_CSV_COLUMNS = [
  { key: 'id', label: 'Transaction ID' },
  { key: 'toolId', label: 'Tool ID' },
  { key: 'toolName', label: 'Tool' },
  { key: 'userName', label: 'Borrower' },
  { key: 'userRole', label: 'Role' },
  { key: 'borrowDate', label: 'Borrow Date', format: (v) => formatDate(v, '') },
  { key: 'dueDate', label: 'Due Date', format: (v) => formatDate(v, '') },
  { key: 'returnDate', label: 'Return Date', format: (v) => formatDate(v, '') },
  { key: 'conditionIn', label: 'Condition' },
  { key: 'status', label: 'Status' },
  { key: 'purpose', label: 'Purpose' },
]

/**
 * First-run walkthrough for the borrowing history. Steps point at controls
 * that really live on this page; `Walkthrough` drops any step whose target is
 * absent, so the tour stays honest on every account.
 */
const transactionsTour = (student) =>
  student
    ? [
        {
          title: 'Your borrowing history',
          text: 'Every tool you have taken out and handed back, newest first. Only your own borrowings appear here.',
        },
        {
          target: 'txn-summary',
          title: 'At a glance',
          text: 'Your total records, what you are holding now, anything overdue, and what you have already returned.',
        },
        {
          target: 'txn-search',
          title: 'Find a borrowing',
          text: 'Search by tool name or transaction ID to pull up a single record.',
        },
        {
          target: 'txn-filters',
          title: 'Narrow the list',
          text: 'Filter by status or date range — handy for checking what is still out.',
        },
        {
          title: 'Open a record',
          text: 'Tap a row for the full record: the dates, the condition it went out in, and its due date.',
        },
      ]
    : [
        {
          title: 'Borrowing history',
          text: 'Every issue and return in the laboratory, newest first, so you can trace any tool.',
        },
        {
          target: 'txn-summary',
          title: 'At a glance',
          text: 'The tiles show total records, tools currently out, overdue borrowings and returns.',
        },
        {
          target: 'txn-search',
          title: 'Find a record',
          text: 'Search by transaction ID, tool, borrower or purpose.',
        },
        {
          target: 'txn-filters',
          title: 'Filter the history',
          text: 'Narrow by status, borrower, tool or date range to focus on what matters.',
        },
        {
          title: 'Open a transaction',
          text: 'Select a row to see the full record, extend a borrowing, or report a tool lost.',
        },
      ]

export default function TransactionsPage() {
  const { user, can } = useApp()
  const toast = useToast()
  const { transactions, loading, error, reload } = useTransactions()
  const { tools } = useTools()
  const { users } = useUsers()
  const [searchParams] = useSearchParams()

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 200)
  const [status, setStatus] = useState(searchParams.get('status') ?? 'all')
  const [userId, setUserId] = useState('all')
  const [toolId, setToolId] = useState(searchParams.get('tool') ?? 'all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sort, setSort] = useState('newest')

  const [selected, setSelected] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [extendDate, setExtendDate] = useState('')

  // Once per account on this device, remembered separately from every other page.
  const tour = usePageTour('transactions', user?.id)
  const tourSteps = useMemo(() => transactionsTour(isStudent(user)), [user])

  // The phone shell — the same breakpoint the layout switches its rail on.
  const isPwa = useMediaQuery('(max-width: 1023px)')

  // An instructor works this page at the counter: no summary strip and a short
  // list. Filters, sorting and the records themselves are untouched — only how
  // much of the list is painted changes.
  const instructor = isInstructor(user)
  const VISIBLE_LIMIT = 5

  const canManage = can(PERM.TXN_EDIT)
  const canSeeAll = can(PERM.TXN_VIEW_ALL)

  const filtered = useMemo(
    () =>
      txnService.filterTransactions(transactions, {
        search: debouncedSearch,
        status,
        userId,
        toolId,
        from,
        to,
        sort,
      }),
    [transactions, debouncedSearch, status, userId, toolId, from, to, sort],
  )

  const summary = useMemo(
    () => ({
      total: filtered.length,
      active: filtered.filter((t) => ACTIVE_TXN_STATUSES.includes(t.status)).length,
      overdue: filtered.filter((t) => t.status === TXN_STATUS.OVERDUE).length,
      returned: filtered.filter((t) => t.status === TXN_STATUS.RETURNED).length,
    }),
    [filtered],
  )

  const hasFilters =
    !!debouncedSearch || status !== 'all' || userId !== 'all' || toolId !== 'all' || !!from || !!to

  // The same filters the desktop row holds, described once for the phone's chips.
  const mobileFilters = [
    {
      key: 'status',
      label: 'Status',
      value: status,
      onChange: setStatus,
      options: [{ value: 'all', label: 'All statuses' }, ...TXN_STATUSES],
    },
    ...(canSeeAll
      ? [
          {
            key: 'user',
            label: 'Borrower',
            value: userId,
            onChange: setUserId,
            options: [
              { value: 'all', label: 'All borrowers' },
              ...users.map((u) => ({ value: u.id, label: u.fullName })),
            ],
          },
        ]
      : []),
    {
      key: 'tool',
      label: 'Tool',
      value: toolId,
      onChange: setToolId,
      options: [
        { value: 'all', label: 'All tools' },
        ...tools.map((t) => ({ value: t.id, label: t.name })),
      ],
    },
    { key: 'sort', label: 'Sort', value: sort, onChange: setSort, options: SORT_OPTIONS },
  ]

  const resetFilters = () => {
    setSearch('')
    setStatus('all')
    setUserId('all')
    setToolId('all')
    setFrom('')
    setTo('')
  }

  const requestMarkLost = (txn) =>
    setConfirm({
      title: `Report ${txn.toolName} as lost?`,
      message: `The transaction will be closed as Lost and ${txn.toolName} will be removed from the borrowable inventory. Recorded against ${txn.userName}.`,
      confirmLabel: 'Report lost',
      onConfirm: async () => {
        setBusy(true)
        try {
          await txnService.markLost(txn.id, user, 'Reported lost from the transactions page.')
          toast.success(`${txn.toolName} was reported lost.`)
          setConfirm(null)
          setSelected(null)
        } catch (err) {
          toast.error(err.message ?? 'Unable to update the transaction.')
        } finally {
          setBusy(false)
        }
      },
    })

  const submitExtension = async (txn) => {
    const iso = fromDateInput(extendDate)
    if (!iso) {
      toast.error('Choose a new due date first.')
      return
    }
    setBusy(true)
    try {
      await txnService.extendDueDate(txn.id, iso, user)
      toast.success(`Due date extended to ${formatDate(iso)}.`)
      setExtendDate('')
      setSelected(null)
    } catch (err) {
      toast.error(err.message ?? 'Unable to extend the due date.')
    } finally {
      setBusy(false)
    }
  }

  const detailFooter = selected && (
    <>
      <button type="button" className="btn btn-outline" onClick={() => setSelected(null)}>
        Close
      </button>
      {ACTIVE_TXN_STATUSES.includes(selected.status) && canManage && (
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => requestMarkLost(selected)}
          disabled={busy}
        >
          <XCircle className="h-4 w-4" />
          Report lost
        </button>
      )}
      {/* Returning is reached from the borrowing it closes: Return is no longer
          a bottom-bar slot for a student, so this record is the way to it —
          for staff as it always was, and for the borrower themselves.
          `canReturnTransaction` is the existing rule, unchanged. */}
      {ACTIVE_TXN_STATUSES.includes(selected.status) &&
        canReturnTransaction(user, selected) && (
          <Link
            to={`/return?tool=${selected.toolId}`}
            className={cx('btn', txnService.returnRequested(selected) ? 'btn-outline' : 'btn-success')}
          >
            <Undo2 className="h-4 w-4" />
            {txnService.returnRequested(selected) ? 'Return requested' : 'Return tool'}
          </Link>
        )}
    </>
  )

  return (
    <>
      <PageHeader hideTitle />

      {/* -------------------------------- summary --------------------------------
          A student's dashboard already carries these four totals, so repeating
          them here only pushes their own records down the page. Staff keep the
          strip: this is the only screen that gives them the figures. */}
      {!isStudent(user) && !instructor && (
        <div data-tour="txn-summary" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile label="Records" value={summary.total} />
          <SummaryTile label="Currently out" value={summary.active} tone="text-blue-600 dark:text-blue-400" />
          <SummaryTile label="Overdue" value={summary.overdue} tone="text-red-600 dark:text-red-400" />
          <SummaryTile
            label="Returned"
            value={summary.returned}
            tone="text-emerald-600 dark:text-emerald-400"
          />
        </div>
      )}

      {/* -------------------------------- filters -------------------------------- */}
      <div className="card mb-3 p-2.5 sm:mb-4 sm:p-3">
        <div className="space-y-2 sm:space-y-3">
          {/* On a phone the filters — the date range included — live at the
              end of the search row as one square control, so the card stays a
              single line. The desktop keeps its inline dropdowns and dates. */}
          <div className="flex items-center gap-2" data-tour="txn-search">
            <div className="min-w-0 flex-1">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search by transaction ID, tool, borrower or purpose…"
              />
            </div>
            <div data-tour="txn-filters" className="sm:hidden">
              <MobileFilterBar
                iconOnly
                filters={mobileFilters}
                hasFilters={hasFilters}
                onClear={resetFilters}
                extra={{
                  label: from || to ? 'Dates set' : 'Dates',
                  active: !!from || !!to,
                  children: (
                    <div className="space-y-3">
                      <TextField
                        label="From"
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                      />
                      <TextField
                        label="To"
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                      />
                    </div>
                  ),
                }}
              />
            </div>
          </div>

          <div className="no-scrollbar -mx-1 hidden gap-2 overflow-x-auto px-1 pb-0.5 sm:flex">
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[{ value: 'all', label: 'All statuses' }, ...TXN_STATUSES]}
            />
            {canSeeAll && (
              <FilterSelect
                label="Borrower"
                value={userId}
                onChange={setUserId}
                options={[
                  { value: 'all', label: 'All borrowers' },
                  ...users.map((u) => ({ value: u.id, label: u.fullName })),
                ]}
              />
            )}
            <FilterSelect
              label="Tool"
              value={toolId}
              onChange={setToolId}
              options={[
                { value: 'all', label: 'All tools' },
                ...tools.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
            <FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_OPTIONS} />
          </div>

          <div className="hidden flex-wrap items-end gap-2 sm:flex">
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
            {hasFilters && (
              <button type="button" onClick={resetFilters} className="btn btn-ghost">
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* -------------------------------- results -------------------------------- */}
      <SectionCard
        title={`${filtered.length} transaction${filtered.length === 1 ? '' : 's'}`}
        description={
          instructor && filtered.length > VISIBLE_LIMIT
            ? `Showing the ${VISIBLE_LIMIT} most recent — narrow the filters to find an older record.`
            : undefined
        }
        bodyClassName="p-0"
      >
        {error ? (
          <ErrorState
            title="Transactions could not be loaded"
            description={error.message}
            onRetry={reload}
          />
        ) : loading && !transactions.length ? (
          <SkeletonRows rows={instructor ? VISIBLE_LIMIT : 6} columns={5} />
        ) : (
          <TransactionTable
            transactions={instructor ? filtered.slice(0, VISIBLE_LIMIT) : filtered}
            onSelect={(txn) => {
              setSelected(txn)
              setExtendDate(toDateInput(txn.dueDate))
            }}
            emptyTitle={
              hasFilters ? 'No transactions match these filters.' : 'No transactions recorded yet.'
            }
            emptyDescription={
              hasFilters
                ? 'Try widening the date range or clearing the filters.'
                : 'Issued and returned tools will appear here.'
            }
          />
        )}
      </SectionCard>

      {/* -------------------------------- detail -------------------------------- */}
      <TransactionDetail
        transaction={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        footer={detailFooter}
        extra={
          selected && canManage && ACTIVE_TXN_STATUSES.includes(selected.status) ? (
            <ExtendDueDate
              transaction={selected}
              value={extendDate}
              onChange={setExtendDate}
              onSubmit={() => submitExtension(selected)}
              busy={busy}
            />
          ) : null
        }
      />

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm?.onConfirm?.()}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        loading={busy}
      />

      <Walkthrough steps={tourSteps} open={tour.open} onClose={tour.close} compact={isStudent(user)} />
    </>
  )
}

function SummaryTile({ label, value, tone }) {
  return (
    <div className="card p-3">
      <p className="subtle text-[11px] font-bold uppercase tracking-wider">{label}</p>
      <p className={`mono mt-1 text-2xl font-extrabold leading-none ${tone ?? ''}`}>{value}</p>
    </div>
  )
}

/** Due-date extension, rendered inside the transaction dialog for open loans. */
function ExtendDueDate({ transaction, value, onChange, onSubmit, busy }) {
  return (
    <div>
      <label className="label" htmlFor="extend-due">
        Extend due date
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="extend-due"
          type="date"
          value={value}
          min={toDateInput(transaction.borrowDate)}
          onChange={(e) => onChange(e.target.value)}
          className="input sm:w-48"
        />
        <button type="button" onClick={onSubmit} className="btn btn-primary" disabled={busy}>
          <CalendarClock className="h-4 w-4" />
          Extend borrowing
        </button>
      </div>
      <p className="subtle mt-1.5 text-xs">
        Granting more laboratory time clears the overdue flag if the new date is in the future.
      </p>
    </div>
  )
}
