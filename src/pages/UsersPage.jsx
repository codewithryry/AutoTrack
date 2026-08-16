import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  KeyRound,
  Mail,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Trash2,
  UserX,
} from 'lucide-react'
import {
  ConfirmDialog,
  DetailItem,
  EmptyState,
  ErrorState,
  FilterSelect,
  MobileFilterBar,
  Modal,
  PageHeader,
  RoleBadge,
  SearchInput,
  SectionCard,
  SelectField,
  SkeletonRows,
  Spinner,
  TableWrap,
  TextField,
  UserStatusBadge,
} from '../components/ui'
import TransactionTable from '../components/TransactionTable'
import Walkthrough, { usePageTour } from '../components/Walkthrough'
import AccountAvatar from '../components/Avatar'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useDebounced, useTransactions, useUsers } from '../hooks'
import * as userService from '../services/users'
import { ValidationError } from '../services/tools'
import {
  PERM,
  can as hasPermission,
  canAssignRole,
  canManageAccount,
  visibleAccountRoles,
} from '../utils/permissions'
import {
  ACTIVE_TXN_STATUSES,
  DEPARTMENTS,
  OTHER_OPTION,
  PROGRAMMES,
  ROLE,
  ROLES,
  TXN_STATUS,
  USER_STATUS,
  USER_STATUSES,
  YEAR_LEVELS,
} from '../utils/constants'
import { cx } from '../utils/helpers'
import { formatDate } from '../utils/dates'

export const USERS_CSV_COLUMNS = [
  { key: 'id', label: 'Auth UID' },
  { key: 'fullName', label: 'Full Name' },
  { key: 'email', label: 'Email' },
  { key: 'role', label: 'Role' },
  { key: 'studentId', label: 'Student ID' },
  { key: 'course', label: 'Course' },
  { key: 'yearLevel', label: 'Year Level' },
  { key: 'employeeId', label: 'Employee ID' },
  { key: 'department', label: 'Department' },
  { key: 'contact', label: 'Contact' },
  { key: 'status', label: 'Status' },
  { key: 'createdAt', label: 'Registered', format: (v) => formatDate(v, '') },
]

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'role', label: 'Role' },
  { value: 'newest', label: 'Newest first' },
]

/**
 * The directory walkthrough — administrators only, since no other role reaches
 * this page. The approval steps drop themselves when nothing is waiting.
 */
const usersTour = [
  {
    target: 'users-filters',
    title: 'Find an account',
    text: 'Search by name, email, student ID or department, then narrow by role or status.',
  },
  {
    target: 'users-pending',
    title: 'Accounts awaiting approval',
    text: 'Self-registered instructors cannot sign in until you approve them here.',
  },
  {
    target: 'users-profile-changes',
    title: 'Profile changes to review',
    text: "A student's edits are held until you approve them — the old and new details are shown side by side.",
  },
  {
    target: 'users-list',
    title: 'The directory',
    text: 'Open a row for the full record. The pencil edits an account and the bin deletes it, with a confirmation first.',
  },
]

export default function UsersPage() {
  const { user: currentUser, can } = useApp()
  const toast = useToast()
  const { users, loading, error, reload } = useUsers()
  const { transactions } = useTransactions()

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 200)
  const [role, setRole] = useState('all')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('name-asc')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const tour = usePageTour('users', currentUser?.id)

  const canManage = can(PERM.USER_CREATE)
  // The roles this account's directory contains at all — every role for an
  // administrator, `Student` alone for an instructor. The filter offers only
  // these, so it never promises rows `profiles_select` will not return.
  const directoryRoles = visibleAccountRoles(currentUser)

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  /**
   * `?new=1` opens the same create form — how the phone's bottom bar reaches it
   * while this page is open. The parameter is dropped again the moment it is
   * honoured, so a back navigation does not reopen the form.
   */
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (!searchParams.get('new')) return
    if (canManage) openCreate()
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [searchParams, canManage, setSearchParams])

  const filtered = useMemo(
    () => userService.filterUsers(users, { search: debouncedSearch, role, status, sort }),
    [users, debouncedSearch, role, status, sort],
  )

  const hasFilters = !!debouncedSearch || role !== 'all' || status !== 'all'

  const resetFilters = () => {
    setSearch('')
    setRole('all')
    setStatus('all')
  }

  /** The same filters the desktop row holds, described once for the phone's sheet. */
  const MOBILE_FILTERS = [
    {
      key: 'role',
      label: 'Role',
      value: role,
      onChange: setRole,
      options: [{ value: 'all', label: 'All roles' }, ...directoryRoles],
    },
    {
      key: 'status',
      label: 'Status',
      value: status,
      onChange: setStatus,
      options: [{ value: 'all', label: 'All statuses' }, ...USER_STATUSES],
    },
    { key: 'sort', label: 'Sort', value: sort, onChange: setSort, options: SORT_OPTIONS },
  ]

  /** Self-registered accounts waiting for a decision. */
  const pending = useMemo(() => userService.pendingAccounts(users), [users])

  /** Students whose profile edits are waiting for a decision. */
  const pendingProfiles = useMemo(() => userService.pendingProfileChanges(users), [users])

  const decideProfile = async (target, approve) => {
    setBusy(true)
    try {
      if (approve) {
        await userService.approveProfileChanges(target.id, currentUser)
        toast.success(`${target.fullName}'s profile was updated.`, { title: 'Changes approved' })
      } else {
        await userService.rejectProfileChanges(target.id, currentUser)
        toast.success(`${target.fullName}'s previous details were kept.`, {
          title: 'Changes rejected',
        })
      }
      reload()
    } catch (err) {
      toast.error(err.message ?? 'That decision could not be recorded.')
    } finally {
      setBusy(false)
    }
  }

  /** Outstanding loans per user, so instructors can see who holds what. */
  const loansByUser = useMemo(() => {
    const map = {}
    for (const txn of transactions) {
      const row = (map[txn.userId] ||= { total: 0, active: 0, overdue: 0, items: [] })
      row.total++
      if (ACTIVE_TXN_STATUSES.includes(txn.status)) {
        row.active++
        row.items.push(txn)
      }
      if (txn.status === TXN_STATUS.OVERDUE) row.overdue++
    }
    return map
  }, [transactions])

  const requestDelete = (target) =>
    setConfirm({
      title: `Delete ${target.fullName}?`,
      message:
        'The laboratory profile is deleted, which revokes access immediately — without a profile ' +
        'the sign-in has no role. Transaction history stays in the laboratory record.',
      confirmLabel: 'Delete profile',
      onConfirm: async () => {
        setBusy(true)
        try {
          await userService.remove(target.id, currentUser)
          toast.success(`${target.fullName} was removed from the directory.`)
          setConfirm(null)
          setViewing(null)
        } catch (err) {
          toast.error(err.message ?? 'Unable to delete the account.')
        } finally {
          setBusy(false)
        }
      },
    })

  /** Password reset needs a backend, which this local build does not have. */
  const sendReset = async (target) => {
    setBusy(true)
    try {
      await userService.requestPasswordReset(target.email, currentUser)
      toast.success(`A password reset link was sent to ${target.email}.`)
    } catch (err) {
      toast.error(err.message ?? 'The reset email could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  /** Activate a self-registered instructor. */
  const approveAccount = async (target) => {
    setBusy(true)
    try {
      await userService.approve(target.id, currentUser)
      toast.success(`${target.fullName} can now sign in.`, { title: 'Account approved' })
      setViewing((v) => (v && v.id === target.id ? { ...v, status: USER_STATUS.ACTIVE } : v))
    } catch (err) {
      toast.error(err.message ?? 'Unable to approve the account.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Turn down a self-registered instructor.
   *
   * Confirmed rather than immediate: it is the one decision on this card that
   * shuts somebody out. The profile is kept and set inactive, so a rejection
   * made in error is undone with "Activate account" in the detail panel.
   */
  const rejectAccount = (target) =>
    setConfirm({
      title: `Reject ${target.fullName}?`,
      message:
        'The account is kept but set inactive, so they cannot sign in. You can activate it later ' +
        'from the directory if this was a mistake.',
      confirmLabel: 'Reject account',
      onConfirm: async () => {
        setBusy(true)
        try {
          await userService.reject(target.id, currentUser)
          toast.success(`${target.fullName}'s account was not approved.`, {
            title: 'Account rejected',
          })
          setConfirm(null)
          setViewing((v) => (v && v.id === target.id ? { ...v, status: USER_STATUS.INACTIVE } : v))
        } catch (err) {
          toast.error(err.message ?? 'Unable to reject the account.')
        } finally {
          setBusy(false)
        }
      },
    })

  const toggleStatus = async (target) => {
    const next = target.status === USER_STATUS.ACTIVE ? USER_STATUS.INACTIVE : USER_STATUS.ACTIVE
    setBusy(true)
    try {
      await userService.setStatus(target.id, next, currentUser)
      toast.success(`${target.fullName}'s account is now ${next.toLowerCase()}.`)
      setViewing((v) => (v && v.id === target.id ? { ...v, status: next } : v))
    } catch (err) {
      toast.error(err.message ?? 'Unable to change the account status.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* The sticky shell already names the page, and on a phone the bottom
          bar's "+" carries the add action — so the header row is the desktop's
          only, exactly as the Tools page opens. */}
      {canManage && (
        <div className="hidden lg:block">
          <PageHeader hideTitle>
            <button type="button" onClick={openCreate} className="btn btn-primary">
              <Plus className="h-4 w-4" />
              Add user
            </button>
          </PageHeader>
        </div>
      )}

      {/* ---------------------- pending profile changes ---------------------- */}
      {canManage && pendingProfiles.length > 0 && (
        <SectionCard
          title={`${pendingProfiles.length} profile change${
            pendingProfiles.length === 1 ? '' : 's'
          } awaiting approval`}
          description="A student's current details, and what they have asked to change them to."
          bodyClassName="p-0"
          className="mb-4"
          data-tour="users-profile-changes"
        >
          <ul className="divide-y">
            {pendingProfiles.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={row.fullName} url={row.avatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{row.fullName}</p>
                    <p className="subtle truncate text-xs">
                      {row.email}
                      {row.studentId ? ` · ${row.studentId}` : ''}
                    </p>
                  </div>
                  <RoleBadge role={row.role} />
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => decideProfile(row, false)}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="btn btn-success btn-sm"
                      onClick={() => decideProfile(row, true)}
                    >
                      Approve
                    </button>
                  </div>
                </div>

                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  {Object.entries(row.pendingProfile ?? {}).map(([field, value]) => (
                    <div
                      key={field}
                      className="rounded-lg border px-3 py-2"
                      style={{ background: 'rgb(var(--surface-2))' }}
                    >
                      <dt className="subtle text-[11px] font-bold uppercase tracking-wider">
                        {field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}
                      </dt>
                      {/* A picture is decided by looking at it, so the two are
                          drawn rather than printed as URLs. Every other field
                          reads as before. */}
                      <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
                        {field === 'avatarUrl' ? (
                          <>
                            <Avatar name={row.fullName} url={row.avatarUrl} size="sm" />
                            <span aria-hidden="true">→</span>
                            {value ? (
                              <Avatar name={row.fullName} url={value} size="sm" />
                            ) : (
                              <span className="font-semibold">Removed</span>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="subtle line-through">{row[field] || '—'}</span>
                            <span aria-hidden="true">→</span>
                            <span className="font-semibold">{value || '—'}</span>
                          </>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* --------------------------- pending approvals --------------------------- */}
      {canManage && pending.length > 0 && (
        <SectionCard
          title={`${pending.length} account${pending.length === 1 ? '' : 's'} awaiting approval`}
          description="Self-registered instructors cannot sign in until an administrator approves them."
          bodyClassName="p-0"
          className="mb-4"
          data-tour="users-pending"
        >
          <ul className="divide-y">
            {pending.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={row.fullName} url={row.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{row.fullName}</p>
                  <p className="subtle truncate text-xs">
                    {row.email}
                    {row.employeeId ? ` · ${row.employeeId}` : ''}
                    {row.department ? ` · ${row.department}` : ''}
                  </p>
                </div>
                <RoleBadge role={row.role} />
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setViewing(row)}
                    className="btn btn-ghost btn-sm"
                  >
                    Review
                  </button>
                  <button
                    type="button"
                    onClick={() => rejectAccount(row)}
                    className="btn btn-outline btn-sm"
                    disabled={busy}
                  >
                    <UserX className="h-3.5 w-3.5" />
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => approveAccount(row)}
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Approve
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* -------------------------------- filters --------------------------------
          The inventory's card, exactly: the search takes the full width of its
          own row with the phone's filter sheet at the end of it, and the
          dropdowns wrap along a desktop row that the result count closes. Every
          control, filter and handler is this page's own, unchanged — only the
          arrangement is now the one the rest of the app uses. */}
      <div className="card mb-3 p-2.5 sm:mb-4 sm:p-3" data-tour="users-filters">
        <div className="flex flex-col gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search by name, email, student ID or department…"
              />
            </div>
            <div className="sm:hidden">
              <MobileFilterBar
                iconOnly
                filters={MOBILE_FILTERS}
                hasFilters={hasFilters}
                onClear={resetFilters}
              />
            </div>
          </div>

          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            <FilterSelect
              label="Role"
              value={role}
              onChange={setRole}
              options={[{ value: 'all', label: 'All roles' }, ...directoryRoles]}
            />
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[{ value: 'all', label: 'All statuses' }, ...USER_STATUSES]}
            />
            <FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_OPTIONS} />
            {hasFilters && (
              <button type="button" onClick={resetFilters} className="btn btn-ghost btn-sm shrink-0">
                Clear
              </button>
            )}
            <ResultCount
              loading={loading}
              shown={filtered.length}
              total={users.length}
              className="ml-auto shrink-0"
            />
          </div>

          {/* The phone's second row: the same count, stretched across the width
              rather than left floating at one end. */}
          <div className="flex sm:hidden">
            <ResultCount
              loading={loading}
              shown={filtered.length}
              total={users.length}
              className="min-w-0 flex-1"
            />
          </div>
        </div>
      </div>

      {/* --------------------------------- list ---------------------------------
          The count moved into the filter card above, as it is on the inventory,
          so the list is named rather than numbered twice. */}
      <SectionCard
        title="Directory"
        bodyClassName="p-0"
        data-tour="users-list"
      >
        {error ? (
          <ErrorState
            title="The user directory could not be loaded"
            description={error.message}
            onRetry={reload}
          />
        ) : loading && !users.length ? (
          <SkeletonRows rows={6} columns={4} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={UserX}
            title="No users found."
            description="No account matches the current search and filters."
          />
        ) : (
          <>
            {/* mobile */}
            <ul className="divide-y sm:hidden">
              {filtered.map((row) => (
                <li key={row.id} className="flex items-center gap-1 pr-2">
                  <button
                    type="button"
                    onClick={() => setViewing(row)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                  >
                    <Avatar name={row.fullName} url={row.avatarUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{row.fullName}</p>
                      <p className="subtle truncate text-xs">
                        {row.email}
                        {row.studentId ? ` · ${row.studentId}` : ''}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <RoleBadge role={row.role} />
                        <UserStatusBadge status={row.status} />
                      </div>
                    </div>
                    {loansByUser[row.id]?.active > 0 && (
                      <span className="badge shrink-0 border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
                        {loansByUser[row.id].active} out
                      </span>
                    )}
                  </button>
                  {/* Same handlers, permissions and confirmation as the desktop
                      table's row actions. */}
                  {(canManage || row.id === currentUser?.id) && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(row)
                        setFormOpen(true)
                      }}
                      className="btn btn-ghost btn-icon shrink-0"
                      aria-label={`Edit ${row.fullName}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {can(PERM.USER_DELETE) && canManageAccount(currentUser, row) && row.id !== currentUser?.id && (
                    <button
                      type="button"
                      onClick={() => requestDelete(row)}
                      className="btn btn-ghost btn-icon shrink-0 text-red-600 dark:text-red-400"
                      aria-label={`Delete ${row.fullName}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {/* desktop */}
            <TableWrap className="hidden sm:block">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Course / Year</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const loans = loansByUser[row.id]
                    return (
                      <tr key={row.id} className="cursor-pointer" onClick={() => setViewing(row)}>
                        <td>
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar name={row.fullName} url={row.avatarUrl} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-semibold">{row.fullName}</p>
                              <p className="subtle truncate text-xs">
                                {row.studentId || row.employeeId || row.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td>
                          <RoleBadge role={row.role} />
                        </td>
                        <td className="max-w-[200px]">
                          {row.course ? (
                            <>
                              <p className="truncate text-xs font-medium">{row.course}</p>
                              <p className="subtle text-xs">{row.yearLevel}</p>
                            </>
                          ) : row.department ? (
                            <>
                              <p className="truncate text-xs font-medium">{row.department}</p>
                              <p className="subtle mono text-xs">{row.employeeId}</p>
                            </>
                          ) : (
                            <span className="subtle text-xs">—</span>
                          )}
                        </td>
                        <td className="text-xs">
                          <p className="truncate">{row.email || '—'}</p>
                          <p className="subtle mono">{row.contact || ''}</p>
                        </td>
                        <td>
                          <UserStatusBadge status={row.status} />
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {(canManage || row.id === currentUser?.id) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditing(row)
                                  setFormOpen(true)
                                }}
                                className="btn btn-ghost btn-icon"
                                aria-label={`Edit ${row.fullName}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            )}
                            {can(PERM.USER_DELETE) && canManageAccount(currentUser, row) && row.id !== currentUser?.id && (
                              <button
                                type="button"
                                onClick={() => requestDelete(row)}
                                className="btn btn-ghost btn-icon text-red-600 dark:text-red-400"
                                aria-label={`Delete ${row.fullName}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </TableWrap>
          </>
        )}
      </SectionCard>

      {/* -------------------------------- dialogs -------------------------------- */}
      <UserForm
        open={formOpen}
        user={editing}
        onClose={() => setFormOpen(false)}
        currentUser={currentUser}
      />

      <UserDetail
        user={viewing}
        loans={viewing ? loansByUser[viewing.id] : null}
        open={!!viewing}
        onClose={() => setViewing(null)}
        canManage={canManage || viewing?.id === currentUser?.id}
        canDelete={
          can(PERM.USER_DELETE) &&
          canManageAccount(currentUser, viewing) &&
          viewing?.id !== currentUser?.id
        }
        canReset={can(PERM.USER_EDIT)}
        busy={busy}
        onEdit={() => {
          setEditing(viewing)
          setViewing(null)
          setFormOpen(true)
        }}
        onDelete={() => requestDelete(viewing)}
        onResetPassword={() => sendReset(viewing)}
        onToggleStatus={() => toggleStatus(viewing)}
        onApprove={() => approveAccount(viewing)}
        onReject={() => rejectAccount(viewing)}
      />

      <Walkthrough steps={usersTour} open={tour.open} onClose={tour.close} />

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

// The directory's own square tile, now carrying the account's picture when it
// has one. The shared component draws the initials otherwise, exactly as this
// did before.
function Avatar({ name, url, size = 'md' }) {
  return (
    <AccountAvatar
      name={name}
      url={url}
      className={cx(
        '!rounded-lg',
        size === 'sm' ? 'h-8 w-8 text-[10px]' : 'h-10 w-10 text-xs',
      )}
    />
  )
}

/* ------------------------------------------------------------------ *
 * Detail dialog
 * ------------------------------------------------------------------ */

function UserDetail({
  user,
  loans,
  open,
  onClose,
  onEdit,
  onDelete,
  onResetPassword,
  onToggleStatus,
  onApprove,
  onReject,
  canManage,
  canDelete,
  canReset,
  busy,
}) {
  if (!user) return null

  const isPending = user.status === USER_STATUS.PENDING

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user.fullName}
      description={user.email}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Close
          </button>
          {canReset && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={onResetPassword}
              disabled={busy}
            >
              <KeyRound className="h-4 w-4" />
              Reset password
            </button>
          )}
          {canDelete && (
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
          {canManage && !isPending && (
            <button type="button" className="btn btn-primary" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit account
            </button>
          )}
          {canManage && isPending && (
            <>
              <button type="button" className="btn btn-outline" onClick={onReject} disabled={busy}>
                <UserX className="h-4 w-4" />
                Reject
              </button>
              <button type="button" className="btn btn-primary" onClick={onApprove} disabled={busy}>
                <ShieldCheck className="h-4 w-4" />
                Approve account
              </button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Avatar name={user.fullName} url={user.avatarUrl} />
          <div className="flex flex-wrap gap-1.5">
            <RoleBadge role={user.role} />
            <UserStatusBadge status={user.status} />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4">
          {user.studentId && (
            <DetailItem label="Student ID" mono>
              {user.studentId}
            </DetailItem>
          )}
          {user.employeeId && (
            <DetailItem label="Employee ID" mono>
              {user.employeeId}
            </DetailItem>
          )}
          {user.department && <DetailItem label="Department">{user.department}</DetailItem>}
          {user.course && (
            <DetailItem label="Course" className="col-span-2">
              {user.course}
            </DetailItem>
          )}
          {user.yearLevel && user.yearLevel !== 'N/A' && (
            <DetailItem label="Year level">{user.yearLevel}</DetailItem>
          )}
          <DetailItem label="Email">
            {user.email ? (
              <span className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="truncate">{user.email}</span>
              </span>
            ) : (
              '—'
            )}
          </DetailItem>
          <DetailItem label="Contact" mono>
            {user.contact ? (
              <span className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 shrink-0 opacity-60" />
                {user.contact}
              </span>
            ) : (
              '—'
            )}
          </DetailItem>
          <DetailItem label="Registered" mono>
            {formatDate(user.createdAt)}
          </DetailItem>
          <DetailItem label="Last sign-in" mono>
            {formatDate(user.lastLoginAt, 'Never')}
          </DetailItem>
        </dl>

        <div>
          <p className="label mb-2">Currently holding</p>
          {loans?.items?.length ? (
            <div className="card overflow-hidden">
              <TransactionTable transactions={loans.items} compact />
            </div>
          ) : (
            <p className="muted text-sm">This user has no tools out at the moment.</p>
          )}
        </div>

        <div
          className="rounded-lg border px-3.5 py-3"
          style={{ background: 'rgb(var(--surface-2))' }}
        >
          <p className="flex items-center gap-1.5 text-xs font-bold">
            <ShieldCheck className="h-3.5 w-3.5" />
            {user.role} permissions
          </p>
          <p className="subtle mt-1 text-xs leading-relaxed">{ROLE_SUMMARY[user.role]}</p>
          {/* A waiting account is decided with Approve/Reject in the footer, not
              with the activate toggle — going straight to Active here would skip
              the approval record (`approvedAt`/`approvedBy`) the decision writes. */}
          {canManage && !isPending && (
            <button
              type="button"
              onClick={onToggleStatus}
              disabled={busy}
              className="btn btn-outline btn-sm mt-3"
            >
              <UserX className="h-3.5 w-3.5" />
              {user.status === USER_STATUS.ACTIVE ? 'Deactivate account' : 'Activate account'}
            </button>
          )}
          <p className="subtle mt-2 text-[11px] leading-relaxed">
            Sign-in is handled locally (id {user.id}). Passwords are never shown in the
            laboratory database — use “Reset password” to email a link.
          </p>
        </div>
      </div>
    </Modal>
  )
}

const ROLE_SUMMARY = {
  [ROLE.ADMIN]:
    'Full control — manage tools, users, transactions, maintenance, reports and system settings.',
  [ROLE.INSTRUCTOR]:
    'Issue and receive tools for any student, oversee all transactions and manage maintenance. No user management, reports or system settings.',
  [ROLE.STUDENT]:
    'Scan tools, borrow available equipment under their own name, return what they borrowed, and see only their own loans and notifications.',
}

/* ------------------------------------------------------------------ *
 * Create / edit form
 * ------------------------------------------------------------------ */

const BLANK_USER = {
  fullName: '',
  role: '',
  studentId: '',
  course: '',
  yearLevel: 'N/A',
  employeeId: '',
  department: '',
  departmentOther: '',
  contact: '',
  email: '',
  status: USER_STATUS.ACTIVE,
  password: '',
  confirmPassword: '',
}

function UserForm({ open, user, onClose, currentUser }) {
  const toast = useToast()
  const isEdit = !!user
  const isSelf = user?.id === currentUser?.id
  // Permission, not role: an instructor keeps the directory too. What an
  // instructor may not do is reach an administrator — `canManageAccount` — or
  // hand out the role, which is why `ROLES` is filtered rather than shown whole.
  const canManageRoles =
    hasPermission(currentUser, PERM.USER_EDIT) && canManageAccount(currentUser, user)
  const roleOptions = ROLES.filter((role) => canAssignRole(currentUser, role))

  const [form, setForm] = useState(BLANK_USER)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setForm(user ? { ...BLANK_USER, ...user, password: '', confirmPassword: '' } : BLANK_USER)
  }, [open, user])

  const setField = (field) => (event) => {
    const value = event?.target ? event.target.value : event
    setForm((f) => ({ ...f, [field]: value }))
    // The typed `Other` value is validated as `department`, so clear that error.
    const shown = field === 'departmentOther' ? 'department' : field
    setErrors((e) => ({ ...e, [field]: undefined, [shown]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const payload = { ...form }
      // Credentials are only ever collected when the Auth account is created.
      if (isEdit) {
        delete payload.password
        delete payload.confirmPassword
      }
      // If department is "Other", use the typed value instead
      const isOtherDept = payload.department === OTHER_OPTION
      if (isOtherDept) {
        payload.department = payload.departmentOther
      }
      delete payload.departmentOther
      const saved = isEdit
        ? await userService.updateUser(user.id, payload, currentUser)
        : await userService.create(payload, currentUser)
      // Never leave a password in component state.
      setForm((f) => ({ ...f, password: '', confirmPassword: '' }))
      toast.success(
        isEdit
          ? `${saved.fullName}'s account was updated.`
          : `${saved.fullName} was added — they can sign in with ${saved.email}.`,
      )
      onClose()
    } catch (err) {
      if (err instanceof ValidationError) {
        setErrors(err.errors)
        toast.error('Please correct the highlighted fields.')
      } else {
        toast.error(err.message ?? 'Unable to save the account.')
      }
    } finally {
      setSaving(false)
    }
  }

  const isStudent = form.role === ROLE.STUDENT
  const isOther = form.department === OTHER_OPTION

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={isEdit ? `Edit ${user.fullName}` : 'Add a user'}
      description={
        isEdit
          ? isSelf
            ? 'Update your own profile details.'
            : user.email
          : 'Creates a sign-in account and its laboratory profile.'
      }
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="user-form" className="btn btn-primary" disabled={saving}>
            {saving && <Spinner />}
            {isEdit ? 'Save changes' : 'Create account'}
          </button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="space-y-5" noValidate>
        <fieldset className="space-y-4">
          <legend className="label mb-2">Account</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Full name"
              required
              value={form.fullName}
              onChange={setField('fullName')}
              error={errors.fullName}
              placeholder="e.g. Juan Dela Cruz"
            />
            <TextField
              label="Email address"
              type="email"
              required
              value={form.email}
              onChange={setField('email')}
              error={errors.email}
              autoCapitalize="none"
              spellCheck="false"
              placeholder="name@autolab.edu.ph"
              disabled={isEdit}
              hint={
                isEdit
                  ? 'The sign-in address cannot be changed here.'
                  : 'This is the sign-in name.'
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Role"
              required
              value={form.role}
              onChange={setField('role')}
              options={roleOptions}
              placeholder="Select a role"
              error={errors.role}
              disabled={isEdit && !canManageRoles}
              hint={
                isEdit && !canManageRoles
                  ? 'You are not allowed to change this account’s role.'
                  : ROLE_SUMMARY[form.role]
              }
            />
            <SelectField
              label="Account status"
              value={form.status}
              onChange={setField('status')}
              options={USER_STATUSES}
              error={errors.status}
              disabled={!canManageRoles}
              hint={
                !canManageRoles ? 'You are not allowed to change this account’s status.' : undefined
              }
            />
          </div>
        </fieldset>

        {isStudent && (
          <fieldset className="space-y-4 border-t pt-5">
            <legend className="label mb-2">Academic details</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                label="Student ID"
                required
                value={form.studentId}
                onChange={setField('studentId')}
                error={errors.studentId}
                placeholder="e.g. 2022-04517"
                className="mono"
              />
              <SelectField
                label="Programme"
                required
                value={form.course}
                onChange={setField('course')}
                options={PROGRAMMES}
                placeholder="Select a programme"
                error={isOther ? undefined : errors.course}
                className="sm:col-span-2"
              />
            </div>
            {isOther && form.role === ROLE.STUDENT && (
              <TextField
                label="Programme (please specify)"
                required
                value={form.course}
                onChange={setField('course')}
                error={errors.course}
                placeholder="e.g. Automotive Technology"
              />
            )}
            <SelectField
              label="Year level"
              value={form.yearLevel}
              onChange={setField('yearLevel')}
              options={YEAR_LEVELS}
              className="sm:w-1/3"
            />
          </fieldset>
        )}

        {form.role && !isStudent && (
          <fieldset className="space-y-4 border-t pt-5">
            <legend className="label mb-2">Staff details</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Employee ID"
                value={form.employeeId}
                onChange={setField('employeeId')}
                error={errors.employeeId}
                placeholder="e.g. EMP-2019-0142"
                className="mono"
              />
              <SelectField
                label="Department"
                value={form.department}
                onChange={setField('department')}
                options={DEPARTMENTS}
                placeholder="Select a department"
                error={isOther ? undefined : errors.department}
              />
            </div>
            {isOther && form.role !== ROLE.STUDENT && (
              <TextField
                label="Department (please specify)"
                value={form.departmentOther}
                onChange={setField('departmentOther')}
                error={errors.department}
                placeholder="e.g. Automotive Technology"
              />
            )}
          </fieldset>
        )}

        <fieldset className="space-y-4 border-t pt-5">
          <legend className="label mb-2">Contact</legend>
          <TextField
            label="Contact number"
            value={form.contact}
            onChange={setField('contact')}
            error={errors.contact}
            placeholder="0917 000 0000"
            className="sm:w-1/2"
          />
        </fieldset>

        {isEdit ? (
          <fieldset className="space-y-2 border-t pt-5">
            <legend className="label mb-2">Password</legend>
            <p className="subtle text-xs leading-relaxed">
              Passwords are held with the account and are never shown in the laboratory
              database, so they cannot be edited here. Use <strong>Reset password</strong> on the
              account to email a reset link.
            </p>
          </fieldset>
        ) : (
          <fieldset className="space-y-4 border-t pt-5">
            <legend className="label mb-2">Sign-in password</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Password"
                type="password"
                required
                autoComplete="new-password"
                value={form.password}
                onChange={setField('password')}
                error={errors.password}
                hint="At least 6 characters."
              />
              <TextField
                label="Confirm password"
                type="password"
                required
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={setField('confirmPassword')}
                error={errors.confirmPassword}
              />
            </div>
          </fieldset>
        )}
      </form>
    </Modal>
  )
}

/**
 * How much of the directory is on screen — the inventory's control, worded for
 * accounts, so the two pages report their results the same way.
 */
function ResultCount({ loading, shown, total, className }) {
  return (
    <p
      className={cx(
        'subtle inline-flex min-h-[34px] items-center rounded-xl border px-3',
        'text-[11px] font-bold uppercase tracking-wider',
        className ?? 'shrink-0',
      )}
      style={{ background: 'rgb(var(--surface-2))' }}
    >
      {loading ? 'Loading…' : `${shown} of ${total} accounts`}
    </p>
  )
}
