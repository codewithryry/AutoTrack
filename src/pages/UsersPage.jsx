import { useEffect, useMemo, useState } from 'react'
import {
  Download,
  Mail,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Trash2,
  Users as UsersIcon,
  UserX,
} from 'lucide-react'
import {
  ConfirmDialog,
  DetailItem,
  EmptyState,
  FilterSelect,
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
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useDebounced, useTransactions, useUsers } from '../hooks'
import * as userService from '../services/users'
import { ValidationError } from '../services/tools'
import { PERM } from '../utils/permissions'
import {
  ACTIVE_TXN_STATUSES,
  COURSES,
  ROLE,
  ROLES,
  TXN_STATUS,
  USER_STATUS,
  USER_STATUSES,
  YEAR_LEVELS,
} from '../utils/constants'
import { cx, downloadCSV, initials } from '../utils/helpers'
import { formatDate } from '../utils/dates'

const CSV_COLUMNS = [
  { key: 'id', label: 'User ID' },
  { key: 'fullName', label: 'Full Name' },
  { key: 'username', label: 'Username' },
  { key: 'role', label: 'Role' },
  { key: 'studentId', label: 'Student ID' },
  { key: 'course', label: 'Course' },
  { key: 'yearLevel', label: 'Year Level' },
  { key: 'contact', label: 'Contact' },
  { key: 'email', label: 'Email' },
  { key: 'status', label: 'Status' },
  { key: 'createdAt', label: 'Registered', format: (v) => formatDate(v, '') },
]

export default function UsersPage() {
  const { user: currentUser, can } = useApp()
  const toast = useToast()
  const { users, loading } = useUsers()
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

  const canManage = can(PERM.USER_CREATE)

  const filtered = useMemo(
    () => userService.filterUsers(users, { search: debouncedSearch, role, status, sort }),
    [users, debouncedSearch, role, status, sort],
  )

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
      message: `The account and its access will be removed. Transaction history remains in the laboratory record.`,
      confirmLabel: 'Delete account',
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

  const exportCSV = () => {
    downloadCSV(filtered, CSV_COLUMNS, `users-${new Date().toISOString().slice(0, 10)}.csv`)
    toast.success(`${filtered.length} users exported to CSV.`)
  }

  return (
    <>
      <PageHeader
        title="Users"
        description={`${users.length} accounts registered — students, instructors and administrators.`}
        icon={UsersIcon}
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
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            className="btn btn-primary"
          >
            <Plus className="h-4 w-4" />
            Add user
          </button>
        )}
      </PageHeader>

      {/* -------------------------------- filters -------------------------------- */}
      <div className="card mb-4 p-3">
        <div className="space-y-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by name, username, student ID or email…"
          />
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
            <FilterSelect
              label="Role"
              value={role}
              onChange={setRole}
              options={[{ value: 'all', label: 'All roles' }, ...ROLES]}
            />
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[{ value: 'all', label: 'All statuses' }, ...USER_STATUSES]}
            />
            <FilterSelect
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'name-asc', label: 'Name (A–Z)' },
                { value: 'name-desc', label: 'Name (Z–A)' },
                { value: 'role', label: 'Role' },
                { value: 'newest', label: 'Newest first' },
              ]}
            />
          </div>
        </div>
      </div>

      {/* --------------------------------- list --------------------------------- */}
      <SectionCard title={`${filtered.length} accounts`} bodyClassName="p-0">
        {loading && !users.length ? (
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
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setViewing(row)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    <Avatar name={row.fullName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{row.fullName}</p>
                      <p className="subtle truncate text-xs">
                        @{row.username}
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
                    <th>Tools out</th>
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
                            <Avatar name={row.fullName} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-semibold">{row.fullName}</p>
                              <p className="subtle truncate text-xs">
                                @{row.username}
                                {row.studentId ? ` · ${row.studentId}` : ''}
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
                          ) : (
                            <span className="subtle text-xs">—</span>
                          )}
                        </td>
                        <td className="text-xs">
                          <p className="truncate">{row.email || '—'}</p>
                          <p className="subtle mono">{row.contact || ''}</p>
                        </td>
                        <td>
                          {loans?.active ? (
                            <span
                              className={cx(
                                'badge',
                                loans.overdue
                                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
                                  : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300',
                              )}
                            >
                              {loans.active} out
                              {loans.overdue ? ` · ${loans.overdue} late` : ''}
                            </span>
                          ) : (
                            <span className="subtle text-xs">None</span>
                          )}
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
                            {can(PERM.USER_DELETE) && row.id !== currentUser?.id && (
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
        canDelete={can(PERM.USER_DELETE) && viewing?.id !== currentUser?.id}
        onEdit={() => {
          setEditing(viewing)
          setViewing(null)
          setFormOpen(true)
        }}
        onDelete={() => requestDelete(viewing)}
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

function Avatar({ name, size = 'md' }) {
  return (
    <span
      className={cx(
        'grid shrink-0 place-items-center rounded-lg font-extrabold',
        size === 'sm' ? 'h-8 w-8 text-[10px]' : 'h-10 w-10 text-xs',
      )}
      style={{ background: 'rgb(var(--rail))', color: 'rgb(var(--accent))' }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * Detail dialog
 * ------------------------------------------------------------------ */

function UserDetail({ user, loans, open, onClose, onEdit, onDelete, canManage, canDelete }) {
  if (!user) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user.fullName}
      description={`@${user.username} · ${user.id}`}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Close
          </button>
          {canDelete && (
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
          {canManage && (
            <button type="button" className="btn btn-primary" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit account
            </button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Avatar name={user.fullName} />
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
        </div>
      </div>
    </Modal>
  )
}

const ROLE_SUMMARY = {
  [ROLE.ADMIN]:
    'Full control — manage tools, users, transactions, maintenance, reports and system settings.',
  [ROLE.INSTRUCTOR]:
    'Issue and receive tools for any student, oversee transactions, manage maintenance and view reports.',
  [ROLE.STUDENT]:
    'Scan tools, borrow available equipment under their own name and return what they borrowed.',
}

/* ------------------------------------------------------------------ *
 * Create / edit form
 * ------------------------------------------------------------------ */

const BLANK_USER = {
  fullName: '',
  username: '',
  role: '',
  studentId: '',
  course: '',
  yearLevel: 'N/A',
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
  const canManageRoles = currentUser?.role === ROLE.ADMIN

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
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const payload = { ...form }
      if (isEdit && !payload.password) {
        delete payload.password
        delete payload.confirmPassword
      }
      const saved = isEdit
        ? await userService.updateUser(user.id, payload, currentUser)
        : await userService.create(payload, currentUser)
      toast.success(
        isEdit ? `${saved.fullName}'s account was updated.` : `${saved.fullName} was added.`,
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

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={isEdit ? `Edit ${user.fullName}` : 'Add a user'}
      description={
        isEdit
          ? isSelf
            ? 'Update your own profile details.'
            : `Account ${user.id}`
          : 'Create a laboratory account and assign its role.'
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
              label="Username"
              required
              value={form.username}
              onChange={setField('username')}
              error={errors.username}
              autoCapitalize="none"
              spellCheck="false"
              placeholder="e.g. jdelacruz"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Role"
              required
              value={form.role}
              onChange={setField('role')}
              options={ROLES}
              placeholder="Select a role"
              error={errors.role}
              disabled={isEdit && !canManageRoles}
              hint={
                isEdit && !canManageRoles
                  ? 'Only an administrator can change a role.'
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
                !canManageRoles ? 'Only an administrator can suspend an account.' : undefined
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
                label="Course"
                required
                value={form.course}
                onChange={setField('course')}
                options={COURSES}
                placeholder="Select a course"
                error={errors.course}
                className="sm:col-span-2"
              />
            </div>
            <SelectField
              label="Year level"
              value={form.yearLevel}
              onChange={setField('yearLevel')}
              options={YEAR_LEVELS}
              className="sm:w-1/3"
            />
          </fieldset>
        )}

        <fieldset className="space-y-4 border-t pt-5">
          <legend className="label mb-2">Contact</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Email"
              type="email"
              value={form.email}
              onChange={setField('email')}
              error={errors.email}
              placeholder="name@autolab.edu.ph"
            />
            <TextField
              label="Contact number"
              value={form.contact}
              onChange={setField('contact')}
              error={errors.contact}
              placeholder="0917 000 0000"
            />
          </div>
        </fieldset>

        <fieldset className="space-y-4 border-t pt-5">
          <legend className="label mb-2">
            {isEdit ? 'Change password (optional)' : 'Password'}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={isEdit ? 'New password' : 'Password'}
              type="password"
              required={!isEdit}
              autoComplete="new-password"
              value={form.password}
              onChange={setField('password')}
              error={errors.password}
              hint={isEdit ? 'Leave blank to keep the current password.' : 'At least 6 characters.'}
            />
            <TextField
              label="Confirm password"
              type="password"
              required={!isEdit}
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={setField('confirmPassword')}
              error={errors.confirmPassword}
            />
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
