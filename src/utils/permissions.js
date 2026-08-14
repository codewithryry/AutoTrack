import { ROLE } from './constants'

/**
 * Single source of truth for who may do what.
 *
 * Three layers enforce the same matrix, and all three are required:
 *
 *   1. `visibleNavItems()` hides what a role cannot reach (a courtesy).
 *   2. Route guards in `App.jsx` and `assertCan()` in the services refuse the
 *      action even when the URL is typed by hand.
 *   3. the data layer scopes every read to the role, so a screen cannot
 *      show records the role may not see.
 *
 * Keep this file, `the data layer` and `components/navigation.js` in step.
 */

export const PERM = {
  // Tools
  TOOL_VIEW: 'tool:view',
  TOOL_CREATE: 'tool:create',
  TOOL_EDIT: 'tool:edit',
  TOOL_DELETE: 'tool:delete',
  TOOL_STATUS: 'tool:status',

  // Borrowing
  BORROW: 'txn:borrow',
  BORROW_FOR_OTHERS: 'txn:borrow-for-others',
  RETURN: 'txn:return',
  RETURN_ANY: 'txn:return-any',
  TXN_VIEW_ALL: 'txn:view-all',
  TXN_EDIT: 'txn:edit',

  // Users
  USER_VIEW: 'user:view', // read the directory (borrower pickers, loan owners)
  USER_MANAGE: 'user:manage', // reach the Users page at all
  USER_CREATE: 'user:create',
  USER_EDIT: 'user:edit',
  USER_DELETE: 'user:delete',

  // Maintenance / reports / settings
  MAINTENANCE_VIEW: 'maintenance:view',
  MAINTENANCE_MANAGE: 'maintenance:manage',
  REPORTS_VIEW: 'reports:view',
  REPORTS_EXPORT: 'reports:export',
  SETTINGS_VIEW: 'settings:view',
  SETTINGS_EDIT: 'settings:edit',
  DATA_MANAGE: 'settings:data',
}

/**
 * Instructors run the tool crib: they issue and receive equipment for any
 * student, correct transactions and manage servicing. They may read the user
 * directory (a borrower has to be selectable) but cannot create, edit or delete
 * accounts, cannot open the Users page, and cannot touch reports or settings.
 */
const INSTRUCTOR_PERMS = [
  PERM.TOOL_VIEW,
  PERM.TOOL_EDIT,
  PERM.TOOL_STATUS,
  PERM.BORROW,
  PERM.BORROW_FOR_OTHERS,
  PERM.RETURN,
  PERM.RETURN_ANY,
  PERM.TXN_VIEW_ALL,
  PERM.TXN_EDIT, // extend due dates, write off a lost tool
  PERM.USER_VIEW,
  PERM.MAINTENANCE_VIEW,
  PERM.MAINTENANCE_MANAGE,
]

/**
 * Students see the inventory, and their own loans and notifications — nothing
 * else. They cannot change a tool's status, read the directory, or open
 * maintenance, reports or settings.
 */
const STUDENT_PERMS = [PERM.TOOL_VIEW, PERM.BORROW, PERM.RETURN]

const ROLE_PERMISSIONS = {
  [ROLE.ADMIN]: Object.values(PERM), // full access
  [ROLE.INSTRUCTOR]: INSTRUCTOR_PERMS,
  [ROLE.STUDENT]: STUDENT_PERMS,
}

export function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] ?? []
}

/** `can(user, PERM.TOOL_EDIT)` — false for a missing/unknown user. */
export function can(user, permission) {
  if (!user?.role) return false
  return permissionsFor(user.role).includes(permission)
}

export function canAny(user, permissions = []) {
  return permissions.some((p) => can(user, p))
}

/** Thrown by service mutations so callers can surface a real message. */
export class PermissionError extends Error {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message)
    this.name = 'PermissionError'
  }
}

export function assertCan(user, permission, message) {
  if (!can(user, permission)) {
    throw new PermissionError(
      message ?? `Your role (${user?.role ?? 'guest'}) is not allowed to perform this action.`,
    )
  }
}

export const isAdmin = (user) => user?.role === ROLE.ADMIN
export const isInstructor = (user) => user?.role === ROLE.INSTRUCTOR
export const isStudent = (user) => user?.role === ROLE.STUDENT
/** Staff share the laboratory-wide view; students are scoped to themselves. */
export const isStaff = (user) => isAdmin(user) || isInstructor(user)

/** Students may only borrow for themselves. */
export function canBorrowFor(user, targetUserId) {
  if (!user) return false
  if (can(user, PERM.BORROW_FOR_OTHERS)) return true
  return can(user, PERM.BORROW) && user.id === targetUserId
}

/** Students may only return what they personally borrowed. */
export function canReturnTransaction(user, transaction) {
  if (!user || !transaction) return false
  if (can(user, PERM.RETURN_ANY)) return true
  return can(user, PERM.RETURN) && transaction.userId === user.id
}

/**
 * Belt-and-braces filter for transaction lists.
 *
 * A student's queries are already scoped to their own uid in the data layer and
 * by the security rules; this keeps a mixed list (say, a cached page) honest.
 */
export function visibleTransactions(user, transactions = []) {
  if (!user) return []
  if (can(user, PERM.TXN_VIEW_ALL)) return transactions
  return transactions.filter((t) => t.userId === user.id)
}
