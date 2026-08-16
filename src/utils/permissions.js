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

  // Requests and reservations
  REQUEST_CREATE: 'request:create', // ask for a tool
  REQUEST_VIEW_ALL: 'request:view-all', // the queue, not just your own
  REQUEST_DECIDE: 'request:decide', // approve or reject
  RESERVATION_MANAGE: 'reservation:manage', // hold, release, mark fulfilled

  // Messaging
  MESSAGE_SEND: 'message:send',

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
 * Instructors run the laboratory: they issue and receive equipment for any
 * student, correct transactions, manage servicing and the inventory itself,
 * keep the user directory, review a student's profile changes, and read the
 * reports.
 *
 * What stays with the administrator is writing the system rather than reading
 * it: changing the laboratory settings (`SETTINGS_EDIT`) and the data tools
 * (import, export, reseed, wipe). And one boundary holds absolutely — an instructor may not create,
 * become, edit or delete an `Admin`. That is enforced three times over: in
 * `canManageAccount()` and `canAssignRole()` below, in `services/users.js`, and
 * in the `profiles` policies and guard trigger, which are the real boundary.
 */
const INSTRUCTOR_PERMS = [
  PERM.TOOL_VIEW,
  PERM.TOOL_CREATE,
  PERM.TOOL_EDIT,
  PERM.TOOL_DELETE,
  PERM.TOOL_STATUS,
  PERM.BORROW,
  PERM.BORROW_FOR_OTHERS,
  PERM.RETURN,
  PERM.RETURN_ANY,
  PERM.TXN_VIEW_ALL,
  PERM.TXN_EDIT, // extend due dates, write off a lost tool
  // The crib decides what goes out, so the request queue and its holds are
  // theirs to work: read every request, approve or reject one, and manage the
  // reservations approvals create.
  PERM.REQUEST_CREATE,
  PERM.REQUEST_VIEW_ALL,
  PERM.REQUEST_DECIDE,
  PERM.RESERVATION_MANAGE,
  PERM.MESSAGE_SEND,
  // The directory, and the account work that goes with running a laboratory:
  // adding a student who has not registered, correcting a record, approving a
  // profile change, removing an account that has left. Never an `Admin` — see
  // `canManageAccount()`.
  PERM.USER_VIEW,
  PERM.USER_MANAGE,
  PERM.USER_CREATE,
  PERM.USER_EDIT,
  PERM.USER_DELETE,
  PERM.MAINTENANCE_VIEW,
  PERM.MAINTENANCE_MANAGE,
  PERM.REPORTS_VIEW,
  PERM.REPORTS_EXPORT,
  // Reading the laboratory's configuration, not changing it: `SETTINGS_VIEW`
  // opens the page and its laboratory and alert sections; `SETTINGS_EDIT` —
  // which actually writes them — stays with the administrator, and so does
  // `DATA_MANAGE`. The `settings` table is readable by any active account
  // already (`settings_select` in 0002), so nothing moves in the database.
  PERM.SETTINGS_VIEW,
]

/**
 * Students see the inventory, and their own loans and notifications — nothing
 * else. They cannot change a tool's status, read the directory, or open
 * maintenance, reports or settings.
 */
const STUDENT_PERMS = [
  PERM.TOOL_VIEW,
  PERM.BORROW,
  PERM.RETURN,
  // A student may ask for a tool and talk to the crib about it. Deciding a
  // request, and seeing anybody else's, stays with staff.
  PERM.REQUEST_CREATE,
  PERM.MESSAGE_SEND,
]

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

/**
 * May this actor act on this account at all?
 *
 * An instructor keeps the directory, but an administrator's account is not part
 * of it: only an administrator edits, suspends or deletes another
 * administrator. Without this, `USER_EDIT` alone would let an instructor demote
 * or delete the people who can overrule them.
 *
 * @param {object} actor
 * @param {object|string} target  the account being acted on, or its role
 */
export function canManageAccount(actor, target) {
  if (!actor?.role) return false
  if (!can(actor, PERM.USER_EDIT)) return false
  const targetRole = typeof target === 'string' ? target : target?.role
  // An administrator keeps the whole directory. An instructor keeps the
  // students in it and nothing else: not an administrator, and not another
  // instructor. A row with no role is unknown, so it is not theirs either.
  if (isAdmin(actor)) return true
  return targetRole === ROLE.STUDENT
}

/**
 * May this actor hand out this role?
 *
 * `Admin` is created by an administrator and by nobody else — the same rule
 * that keeps it out of public sign-up keeps it out of an instructor's reach.
 */
export function canAssignRole(actor, role) {
  if (!can(actor, PERM.USER_EDIT)) return false
  // The same boundary as `canManageAccount`: an instructor's directory is the
  // students in it, so `Student` is the only role they can hand out.
  return isAdmin(actor) || role === ROLE.STUDENT
}

/**
 * The roles an actor may see in the directory at all.
 *
 * The frontend counterpart of the `profiles_select` policy: it decides which
 * rows a list is allowed to show, and the policy decides which rows the server
 * will part with. Both must say the same thing — the policy is the one that
 * matters.
 */
export function visibleAccountRoles(actor) {
  if (isAdmin(actor)) return [ROLE.ADMIN, ROLE.INSTRUCTOR, ROLE.STUDENT]
  if (isInstructor(actor)) return [ROLE.STUDENT]
  return []
}

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
