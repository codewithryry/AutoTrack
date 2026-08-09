import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarClock, ClipboardList, Download, Undo2, XCircle } from 'lucide-react'
import {
  ConfirmDialog,
  FilterSelect,
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
import { useDebounced, useTools, useTransactions, useUsers } from '../hooks'
import * as txnService from '../services/transactions'
import { canReturnTransaction, PERM } from '../utils/permissions'
import { ACTIVE_TXN_STATUSES, TXN_STATUS, TXN_STATUSES } from '../utils/constants'
import { downloadCSV } from '../utils/helpers'
import { formatDate, fromDateInput, toDateInput } from '../utils/dates'

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'due-soonest', label: 'Due soonest' },
  { value: 'tool', label: 'Tool name' },
  { value: 'borrower', label: 'Borrower' },
]

const CSV_COLUMNS = [
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

export default function TransactionsPage() {
  const { user, can } = useApp()
  const toast = useToast()
  const { transactions, loading } = useTransactions()
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

  const resetFilters = () => {
    setSearch('')
    setStatus('all')
    setUserId('all')
    setToolId('all')
    setFrom('')
    setTo('')
  }

  const exportCSV = () => {
    downloadCSV(
      filtered,
      CSV_COLUMNS,
      `transactions-${new Date().toISOString().slice(0, 10)}.csv`,
    )
    toast.success(`${filtered.length} transactions exported to CSV.`)
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
      {ACTIVE_TXN_STATUSES.includes(selected.status) &&
        canReturnTransaction(user, selected) && (
          <Link to={`/return?tool=${selected.toolId}`} className="btn btn-success">
            <Undo2 className="h-4 w-4" />
            Return tool
          </Link>
        )}
    </>
  )

  return (
    <>
      <PageHeader
        title="Transactions"
        description={
          canSeeAll
            ? 'Every borrowing and return recorded in the laboratory.'
            : 'Your borrowing history.'
        }
        icon={ClipboardList}
      >
        <button
          type="button"
          onClick={exportCSV}
          className="btn btn-outline"
          disabled={!filtered.length}
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Export CSV</span>
        </button>
      </PageHeader>

      {/* -------------------------------- summary -------------------------------- */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Records" value={summary.total} />
        <SummaryTile label="Currently out" value={summary.active} tone="text-blue-600 dark:text-blue-400" />
        <SummaryTile label="Overdue" value={summary.overdue} tone="text-red-600 dark:text-red-400" />
        <SummaryTile
          label="Returned"
          value={summary.returned}
          tone="text-emerald-600 dark:text-emerald-400"
        />
      </div>

      {/* -------------------------------- filters -------------------------------- */}
      <div className="card mb-4 p-3">
        <div className="space-y-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by transaction ID, tool, borrower or purpose…"
          />

          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
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

          <div className="flex flex-wrap items-end gap-2">
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
        bodyClassName="p-0"
      >
        {loading && !transactions.length ? (
          <SkeletonRows rows={6} columns={5} />
        ) : (
          <TransactionTable
            transactions={filtered}
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
          Extend loan
        </button>
      </div>
      <p className="subtle mt-1.5 text-xs">
        Granting more laboratory time clears the overdue flag if the new date is in the future.
      </p>
    </div>
  )
}
