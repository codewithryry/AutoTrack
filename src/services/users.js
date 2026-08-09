import * as db from './db'
import { COLLECTIONS } from './db'
import * as activity from './activity'
import { ValidationError } from './tools'
import {
  ACTIVE_TXN_STATUSES,
  ACTIVITY,
  COURSES,
  ROLE,
  ROLES,
  USER_STATUS,
  USER_STATUSES,
  YEAR_LEVELS,
} from '../utils/constants'
import { PERM, assertCan } from '../utils/permissions'
import { matchesQuery, padId, sortBy } from '../utils/helpers'
import { nowISO } from '../utils/dates'

/**
 * User directory. Passwords are stored as a salted hash even though this build
 * is local-only — it keeps the shape of the record honest for the day a real
 * backend takes over, and stops a casual IndexedDB browse revealing credentials.
 */

const SEARCH_FIELDS = ['id', 'fullName', 'username', 'studentId', 'email', 'course', 'contact']

export async function listAll() {
  return sortBy(await db.list(COLLECTIONS.users), 'fullName')
}

export async function getById(id) {
  return db.get(COLLECTIONS.users, id)
}

export async function findByUsername(username) {
  const normalized = String(username ?? '').trim().toLowerCase()
  const rows = await db.list(COLLECTIONS.users)
  return rows.find((u) => u.username?.toLowerCase() === normalized) ?? null
}

export async function listBorrowers() {
  return (await listAll()).filter((u) => u.status === USER_STATUS.ACTIVE)
}

export function filterUsers(users, { search, role, status, sort } = {}) {
  let rows = users.filter((user) => {
    if (role && role !== 'all' && user.role !== role) return false
    if (status && status !== 'all' && user.status !== status) return false
    return matchesQuery(user, search, SEARCH_FIELDS)
  })

  switch (sort) {
    case 'name-desc':
      rows = sortBy(rows, 'fullName', 'desc')
      break
    case 'newest':
      rows = sortBy(rows, 'createdAt', 'desc')
      break
    case 'role':
      rows = sortBy(rows, 'role', 'asc')
      break
    case 'name-asc':
    default:
      rows = sortBy(rows, 'fullName', 'asc')
  }
  return rows
}

export async function nextUserId() {
  const users = await db.list(COLLECTIONS.users)
  const highest = users.reduce((max, u) => {
    const n = Number(String(u.id).replace(/^USR-/, ''))
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return padId('USR', highest + 1, 4)
}

/* --------------------------- passwords --------------------------- */

/**
 * SHA-256 over `salt:password`. Not a substitute for a real KDF on a server,
 * but it means the stored value is not the password itself.
 */
export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function makeSalt() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function buildCredentials(password) {
  const salt = makeSalt()
  return { salt, passwordHash: await hashPassword(password, salt) }
}

export async function verifyPassword(user, password) {
  if (!user?.passwordHash || !user?.salt) return false
  const attempt = await hashPassword(password, user.salt)
  // Constant-time-ish comparison; both strings are fixed-length hex digests.
  if (attempt.length !== user.passwordHash.length) return false
  let diff = 0
  for (let i = 0; i < attempt.length; i++) diff |= attempt.charCodeAt(i) ^ user.passwordHash.charCodeAt(i)
  return diff === 0
}

/* --------------------------- validation --------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const USERNAME_RE = /^[a-z0-9._-]{3,20}$/i

export async function validate(input, { isEdit = false, currentId = null } = {}) {
  const errors = {}

  if (!input.fullName?.trim()) errors.fullName = 'Full name is required.'
  else if (input.fullName.trim().length < 3) errors.fullName = 'Full name is too short.'

  const username = input.username?.trim()
  if (!username) errors.username = 'Username is required.'
  else if (!USERNAME_RE.test(username)) {
    errors.username = 'Use 3–20 letters, numbers, dots, dashes or underscores.'
  } else {
    const clash = await findByUsername(username)
    if (clash && clash.id !== currentId) errors.username = 'That username is already taken.'
  }

  if (!input.role) errors.role = 'Select a role.'
  else if (!ROLES.includes(input.role)) errors.role = 'Unknown role.'

  if (input.email?.trim() && !EMAIL_RE.test(input.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }

  if (input.contact?.trim() && !/^[0-9+()\-\s]{7,20}$/.test(input.contact.trim())) {
    errors.contact = 'Enter a valid contact number.'
  }

  if (input.role === ROLE.STUDENT) {
    if (!input.studentId?.trim()) errors.studentId = 'Student ID is required for students.'
    else {
      const rows = await db.list(COLLECTIONS.users)
      const clash = rows.find(
        (u) =>
          u.studentId?.trim().toLowerCase() === input.studentId.trim().toLowerCase() &&
          u.id !== currentId,
      )
      if (clash) errors.studentId = `Student ID already registered to ${clash.fullName}.`
    }
    if (!input.course?.trim()) errors.course = 'Course is required for students.'
  }

  if (input.status && !USER_STATUSES.includes(input.status)) errors.status = 'Unknown status.'

  if (!isEdit) {
    if (!input.password) errors.password = 'Password is required.'
    else if (input.password.length < 6) errors.password = 'Use at least 6 characters.'
    else if (input.confirmPassword != null && input.password !== input.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.'
    }
  } else if (input.password) {
    if (input.password.length < 6) errors.password = 'Use at least 6 characters.'
    else if (input.confirmPassword != null && input.password !== input.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.'
    }
  }

  return errors
}

/* --------------------------- mutations --------------------------- */

export async function create(input, actor) {
  assertCan(actor, PERM.USER_CREATE, 'Only an administrator can create user accounts.')

  const errors = await validate(input)
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const { salt, passwordHash } = await buildCredentials(input.password)
  const user = {
    id: await nextUserId(),
    fullName: input.fullName.trim(),
    username: input.username.trim().toLowerCase(),
    role: input.role,
    studentId: input.studentId?.trim() ?? '',
    course: input.course?.trim() ?? '',
    yearLevel: input.yearLevel ?? 'N/A',
    contact: input.contact?.trim() ?? '',
    email: input.email?.trim() ?? '',
    status: input.status ?? USER_STATUS.ACTIVE,
    salt,
    passwordHash,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }

  await db.insert(COLLECTIONS.users, user)
  await activity.log({
    action: ACTIVITY.USER_CREATED,
    userId: actor?.id,
    userName: actor?.fullName,
    message: `${user.fullName} (${user.role}) was added to the directory.`,
    meta: { targetUserId: user.id },
  })
  return user
}

export async function updateUser(id, input, actor) {
  // A user may always edit their own profile; editing anyone else needs the permission.
  if (actor?.id !== id) {
    assertCan(actor, PERM.USER_EDIT, 'You are not allowed to edit user accounts.')
  }

  const current = await getById(id)
  if (!current) throw new Error('User not found.')

  // Guard the laboratory's last administrator before field validation, so the
  // caller gets the real reason rather than a downstream "student ID required".
  const demoting = input.role && input.role !== current.role && current.role === ROLE.ADMIN
  const deactivating =
    input.status && input.status !== current.status && current.role === ROLE.ADMIN &&
    input.status !== USER_STATUS.ACTIVE
  if (demoting || deactivating) {
    assertCan(actor, PERM.USER_EDIT, 'Only an administrator can change a role.')
    await assertNotLastAdmin(id)
  }

  const errors = await validate({ ...current, ...input }, { isEdit: true, currentId: id })
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const patch = {
    fullName: input.fullName?.trim() ?? current.fullName,
    username: (input.username ?? current.username).trim().toLowerCase(),
    studentId: input.studentId?.trim() ?? current.studentId,
    course: input.course?.trim() ?? current.course,
    yearLevel: input.yearLevel ?? current.yearLevel,
    contact: input.contact?.trim() ?? current.contact,
    email: input.email?.trim() ?? current.email,
    updatedAt: nowISO(),
  }

  // Only an admin can change someone's role or account status.
  if (input.role && input.role !== current.role) {
    assertCan(actor, PERM.USER_EDIT, 'Only an administrator can change a role.')
    patch.role = input.role
  }
  if (input.status && input.status !== current.status) {
    assertCan(actor, PERM.USER_EDIT, 'Only an administrator can change an account status.')
    patch.status = input.status
  }

  if (input.password) {
    const { salt, passwordHash } = await buildCredentials(input.password)
    patch.salt = salt
    patch.passwordHash = passwordHash
  }

  const next = await db.update(COLLECTIONS.users, id, patch)
  await activity.log({
    action: ACTIVITY.USER_UPDATED,
    userId: actor?.id,
    userName: actor?.fullName,
    message: `${next.fullName}'s account was updated.`,
    meta: { targetUserId: id },
  })
  return next
}

async function assertNotLastAdmin(excludingId) {
  const admins = (await db.list(COLLECTIONS.users)).filter(
    (u) => u.role === ROLE.ADMIN && u.status === USER_STATUS.ACTIVE && u.id !== excludingId,
  )
  if (!admins.length) {
    throw new Error('The laboratory must keep at least one active administrator.')
  }
}

export async function remove(id, actor, { force = false } = {}) {
  assertCan(actor, PERM.USER_DELETE, 'Only an administrator can delete user accounts.')

  const user = await getById(id)
  if (!user) throw new Error('User not found.')
  if (user.id === actor?.id) throw new Error('You cannot delete your own account.')
  if (user.role === ROLE.ADMIN) await assertNotLastAdmin(id)

  const open = await db.query(
    COLLECTIONS.transactions,
    (t) => t.userId === id && ACTIVE_TXN_STATUSES.includes(t.status),
  )
  if (open.length && !force) {
    const err = new Error(
      `${user.fullName} still has ${open.length} tool${
        open.length > 1 ? 's' : ''
      } on loan. Those tools must be returned first.`,
    )
    err.name = 'ActiveTransactionError'
    err.activeCount = open.length
    throw err
  }

  await db.remove(COLLECTIONS.users, id)
  await activity.log({
    action: ACTIVITY.USER_DELETED,
    userId: actor?.id,
    userName: actor?.fullName,
    message: `${user.fullName} (${user.role}) was removed from the directory.`,
    meta: { targetUserId: id },
  })
  return true
}

/** Borrowing summary shown on the users page. */
export async function borrowingSummary(userId) {
  const rows = await db.query(COLLECTIONS.transactions, (t) => t.userId === userId)
  return {
    total: rows.length,
    active: rows.filter((t) => ACTIVE_TXN_STATUSES.includes(t.status)).length,
    overdue: rows.filter((t) => t.status === 'Overdue').length,
    returned: rows.filter((t) => t.status === 'Returned').length,
  }
}

export const COURSE_OPTIONS = COURSES
export const YEAR_OPTIONS = YEAR_LEVELS
