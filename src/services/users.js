import * as db from './db'
import { COLLECTIONS } from './db'
import * as activity from './activity'
import * as notifications from './notifications'
import { ValidationError } from './tools'
import { createAuthAccount, registerAccount, sendPasswordReset } from './localAuth'
import {
  ACTIVE_TXN_STATUSES,
  ACTIVITY,
  COURSES,
  NOTIF_TYPE,
  ROLE,
  ROLES,
  USER_STATUS,
  USER_STATUSES,
  YEAR_LEVELS,
} from '../utils/constants'
import {
  PERM,
  PermissionError,
  assertCan,
  canAssignRole,
  canManageAccount,
} from '../utils/permissions'
import { matchesQuery, sortBy } from '../utils/helpers'
import { nowISO } from '../utils/dates'

/**
 * User directory — the stored `users` records.
 *
 * The record id is always the sign-in account id, which is what lets the
 * security rules compare `request.auth.uid` against the document being read or
 * written without a lookup.
 *
 * Credentials are *not* part of this record. There is no password, hash or salt
 * field anywhere in it: the auth layer holds the password, this holds
 * the profile. A password change is therefore an Auth operation (a reset email),
 * not a directory write.
 */

const SEARCH_FIELDS = [
  'id',
  'fullName',
  'email',
  'studentId',
  'employeeId',
  'department',
  'course',
  'contact',
]

export async function listAll() {
  return sortBy(await db.list(COLLECTIONS.users), 'fullName')
}

export async function getById(id) {
  return db.get(COLLECTIONS.users, id)
}

export async function findByEmail(email) {
  const normalized = String(email ?? '').trim().toLowerCase()
  if (!normalized) return null
  const rows = await db.list(COLLECTIONS.users)
  return rows.find((u) => u.email?.toLowerCase() === normalized) ?? null
}

/** Active accounts that may hold a tool — the borrower picker. */
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

/* --------------------------- name helpers --------------------------- */

/** Split a full name into the first/last pair the profile schema stores. */
export function splitName(fullName) {
  const parts = String(fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) }
}

/* --------------------------- validation --------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function validate(input, { isEdit = false, currentId = null, current = null } = {}) {
  const errors = {}

  if (!input.fullName?.trim()) errors.fullName = 'Full name is required.'
  else if (input.fullName.trim().length < 3) errors.fullName = 'Full name is too short.'

  const email = input.email?.trim()
  if (!email) errors.email = 'Email address is required — it is the sign-in name.'
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.'
  else if (!isEdit) {
    const clash = await findByEmail(email)
    if (clash && clash.id !== currentId) errors.email = 'That email address already has an account.'
  }

  if (!input.role) errors.role = 'Select a role.'
  else if (!ROLES.includes(input.role)) errors.role = 'Unknown role.'

  if (input.contact?.trim() && !/^[0-9+()\-\s]{7,20}$/.test(input.contact.trim())) {
    errors.contact = 'Enter a valid contact number.'
  }

  if (input.role === ROLE.STUDENT) {
    const studentId = input.studentId?.trim()
    if (!studentId) errors.studentId = 'Student ID is required for students.'
    // A student ID that is not being changed is not re-checked. Self-registration
    // cannot verify uniqueness (a visitor may not read the directory), so a
    // duplicate can exist; re-checking an untouched value would then block every
    // other edit to *both* profiles until somebody fixed it by hand.
    else if (studentId.toLowerCase() !== current?.studentId?.trim().toLowerCase()) {
      const rows = await db.list(COLLECTIONS.users)
      const clash = rows.find(
        (u) => u.studentId?.trim().toLowerCase() === studentId.toLowerCase() && u.id !== currentId,
      )
      if (clash) errors.studentId = `Student ID already registered to ${clash.fullName}.`
    }
    // A programme is recorded either as a course (chosen from the list by an
    // administrator) or as the department a student typed when registering.
    if (!input.course?.trim() && !input.department?.trim()) {
      errors.course = 'Course or programme is required for students.'
    }
  }

  if (input.status && !USER_STATUSES.includes(input.status)) errors.status = 'Unknown status.'

  // A password is only ever collected when creating the Auth account. Changing
  // one afterwards is a reset email, so there is nothing to validate on edit.
  if (!isEdit) {
    if (!input.password) errors.password = 'Password is required.'
    else if (input.password.length < 6) errors.password = 'Use at least 6 characters.'
    else if (input.confirmPassword != null && input.password !== input.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.'
    }
  }

  return errors
}

/* --------------------------- mutations --------------------------- */

/** Build the profile document from form input. Never includes a password. */
function buildProfile(uid, input, { actor, existing } = {}) {
  const fullName = input.fullName.trim()
  const { firstName, lastName } = splitName(fullName)
  const isStudent = input.role === ROLE.STUDENT
  const timestamp = nowISO()

  return {
    // The row id is the auth uuid. There is no separate `uid` column — writing
    // one fails on an unknown column, which broke every administrator edit as
    // well as self-registration. `toProfile()` derives `uid` from the id for
    // the callers that still read it.
    id: uid,
    email: (input.email ?? existing?.email ?? '').trim().toLowerCase(),
    firstName,
    lastName,
    fullName,
    displayName: fullName,
    role: input.role,
    status: input.status ?? existing?.status ?? USER_STATUS.ACTIVE,
    studentId: isStudent ? (input.studentId?.trim() ?? '') : '',
    course: isStudent ? (input.course?.trim() ?? '') : '',
    yearLevel: isStudent ? (input.yearLevel ?? 'N/A') : 'N/A',
    employeeId: isStudent ? '' : (input.employeeId?.trim() ?? ''),
    // Students registering for themselves give a programme/department too, so
    // this is not staff-only.
    department: input.department?.trim() ?? '',
    contact: input.contact?.trim() ?? '',
    createdAt: existing?.createdAt ?? timestamp,
    createdBy: existing?.createdBy ?? actor?.id ?? null,
    updatedAt: timestamp,
    lastLoginAt: existing?.lastLoginAt ?? null,
  }
}

/**
 * Create an account: a sign-in account first, then the matching
 * profile keyed by its uid.
 *
 * The sign-in account is created without disturbing the
 * administrator's own session is untouched (see `localAuth.js`). The
 * password goes to the auth layer and nowhere else.
 */
export async function create(input, actor) {
  assertCan(actor, PERM.USER_CREATE, 'You are not allowed to create user accounts.')
  // An instructor keeps the directory, but `Admin` is not theirs to hand out.
  // The `profiles_insert` policy refuses it too, so this is the friendly half.
  if (!canAssignRole(actor, input.role)) {
    throw new PermissionError('You are not allowed to create an account with that role.')
  }

  const errors = await validate(input)
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const { uid } = await createAuthAccount({
    email: input.email.trim(),
    password: input.password,
    displayName: input.fullName.trim(),
  })

  const profile = buildProfile(uid, input, { actor })

  try {
    await db.insert(COLLECTIONS.users, profile)
  } catch (err) {
    // The sign-in account exists but has no profile, so it cannot be used yet.
    // Deleting it needs the Admin SDK, so say plainly what has to happen next.
    console.warn('[users] the profile could not be saved', err)
    const message =
      `The sign-in account for ${profile.email} was created, but its laboratory profile ` +
      `could not be saved. Add the profile again with the same email, ` +
      `or remove the account from the directory.`
    const wrapped = new Error(message)
    wrapped.name = 'ProfileWriteError'
    throw wrapped
  }

  await activity
    .log({
      action: ACTIVITY.USER_CREATED,
      userId: actor?.id,
      userName: actor?.fullName,
      message: `${profile.fullName} (${profile.role}) was added to the directory.`,
      meta: { targetUserId: uid },
    })
    .catch(() => {})

  return profile
}

/* ------------------------- self-registration ------------------------- */

/** Roles a visitor may request for themselves. `Admin` is deliberately absent. */
export const SIGNUP_ROLES = [ROLE.STUDENT, ROLE.INSTRUCTOR]

/**
 * The status a self-registered account starts in.
 *
 * Both self-service roles are usable immediately: there is no approval step.
 * `Pending` remains a valid status an administrator can set by hand, and any
 * account already sitting at it still waits — this only decides what a *new*
 * registration starts as.
 *
 * `Admin` is not a self-service role and never has been; `SIGNUP_ROLES` and the
 * `profiles_insert` policy both refuse it.
 */
export const signupStatusFor = () => USER_STATUS.ACTIVE

const SIGNUP_MIN_PASSWORD = 8

/**
 * Optional institutional email allowlist, e.g.
 * `VITE_SIGNUP_EMAIL_DOMAINS=autolab.edu.ph,minsu.edu.ph`.
 *
 * Unset, registration is open to any address — which is what a public sign-up
 * form means, and it is why a student account is the least privileged role in the
 * system. A laboratory that only wants its own students registering should set
 * this (see README → Public pages and
 * sign-up), because this check runs in the browser.
 */
export const SIGNUP_EMAIL_DOMAINS = String(import.meta.env?.VITE_SIGNUP_EMAIL_DOMAINS ?? '')
  .split(',')
  .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean)

function emailDomainAllowed(email) {
  if (!SIGNUP_EMAIL_DOMAINS.length) return true
  const domain = email.split('@')[1]?.toLowerCase()
  return SIGNUP_EMAIL_DOMAINS.some((allowed) => domain === allowed || domain?.endsWith(`.${allowed}`))
}

/**
 * Validate a public sign-up.
 *
 * Kept separate from `validate()` because the fields differ (first/last name
 * rather than a full name, a longer minimum password, no status or role freedom)
 * and because it must not read the user directory — a visitor is not signed in,
 * so it cannot check anything across other accounts. Email uniqueness is decided
 * by the auth layer, which is the only authority on it.
 */
export function validateSignUp(input) {
  const errors = {}

  if (!input.firstName?.trim()) errors.firstName = 'Please enter your first name.'
  if (!input.lastName?.trim()) errors.lastName = 'Please enter your last name.'

  const email = input.email?.trim()
  if (!email) errors.email = 'Please enter your email address.'
  else if (!EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address.'
  else if (!emailDomainAllowed(email)) {
    errors.email = `Use your institutional email address (${SIGNUP_EMAIL_DOMAINS.join(', ')}).`
  }

  if (!input.password) errors.password = 'Please enter a password.'
  else if (input.password.length < SIGNUP_MIN_PASSWORD) {
    errors.password = `Password must be at least ${SIGNUP_MIN_PASSWORD} characters.`
  }

  if (!input.confirmPassword) errors.confirmPassword = 'Please confirm your password.'
  else if (input.password !== input.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.'
  }

  if (!input.role) errors.role = 'Please choose whether you are a student or an instructor.'
  else if (!SIGNUP_ROLES.includes(input.role)) errors.role = 'Please choose a valid role.'

  if (input.role === ROLE.STUDENT) {
    if (!input.studentId?.trim()) errors.studentId = 'Please enter your student ID.'
    if (!input.department?.trim()) errors.department = 'Please enter your programme.'
  }

  if (input.role === ROLE.INSTRUCTOR) {
    if (!input.employeeId?.trim()) errors.employeeId = 'Please enter your employee ID.'
    if (!input.department?.trim()) errors.department = 'Please enter your department.'
  }

  if (input.contact?.trim() && !/^[0-9+()\-\s]{7,20}$/.test(input.contact.trim())) {
    errors.contact = 'Please enter a valid contact number.'
  }

  return errors
}

/**
 * Register a new account from the public sign-up form.
 *
 * The role is forced to one of `SIGNUP_ROLES` and the status is derived here, not
 * taken from the form. The service layer
 * pin exactly what a self-created profile may contain, so a request edited in
 * the browser to ask for `Admin` is refused by the database.
 *
 * The account and its profile are both created without disturbing the current
 * connection, so a visitor is never left half-signed-in on the public site.
 *
 * @returns {Promise<{ uid: string, role: string, status: string, email: string, fullName: string }>}
 */
export async function signUp(input) {
  const errors = validateSignUp(input)
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const role = SIGNUP_ROLES.includes(input.role) ? input.role : ROLE.STUDENT
  const status = signupStatusFor(role)
  const firstName = input.firstName.trim()
  const lastName = input.lastName.trim()
  const fullName = `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim()
  const email = input.email.trim().toLowerCase()
  const isStudent = role === ROLE.STUDENT
  const timestamp = nowISO()

  const { uid } = await registerAccount({
    email,
    password: input.password,
    displayName: fullName,
    profile: (newUid) => ({
      // The row id is the Supabase Auth uuid; there is no separate `uid`
      // column, and `services/auth.js → toProfile()` derives `uid` from the id
      // for the callers that still read it.
      id: newUid,
      email,
      firstName,
      lastName,
      fullName,
      displayName: fullName,
      role,
      status,
      // A self-registered profile is complete on creation: every field the
      // laboratory reads is written, with `N/A` standing in for the ones this
      // role has no value for, so nothing is left null for an administrator to
      // fill in before the account can be used.
      studentId: isStudent ? (input.studentId?.trim() || 'N/A') : 'N/A',
      course: isStudent ? (input.department?.trim() || 'N/A') : 'N/A',
      yearLevel: isStudent ? (input.yearLevel ?? 'N/A') : 'N/A',
      employeeId: isStudent ? 'N/A' : (input.employeeId?.trim() || 'N/A'),
      department: input.department?.trim() || 'N/A',
      // Left blank rather than `N/A`: `validate()` checks any non-empty contact
      // against the phone-number pattern, and `N/A` would fail every later edit.
      contact: input.contact?.trim() ?? '',
      registeredSelf: true,
      createdAt: timestamp,
      createdBy: null,
      updatedAt: timestamp,
      lastLoginAt: null,
    }),
  })

  return { uid, role, status, email, fullName }
}

/**
 * Approve a pending account — the other half of instructor self-registration.
 */
export async function approve(id, actor) {
  assertCan(actor, PERM.USER_EDIT, 'You are not allowed to approve accounts.')

  const user = await getById(id)
  if (!user) throw new Error('User not found.')
  if (user.status !== USER_STATUS.PENDING) return user

  const saved = await db.update(COLLECTIONS.users, id, {
    status: USER_STATUS.ACTIVE,
    approvedAt: nowISO(),
    approvedBy: actor?.id ?? null,
    updatedAt: nowISO(),
  })

  await activity
    .log({
      action: ACTIVITY.USER_UPDATED,
      userId: actor?.id,
      userName: actor?.fullName,
      message: `${user.fullName}'s ${user.role.toLowerCase()} account was approved.`,
      meta: { targetUserId: id, status: USER_STATUS.ACTIVE },
    })
    .catch(() => {})

  // Tell them, so they are not left refreshing the login screen.
  await notifications
    .create({
      type: NOTIF_TYPE.SYSTEM,
      title: 'Account approved',
      message: `Your ${user.role.toLowerCase()} account has been approved. You can now sign in.`,
      userId: id,
      dedupeKey: `approval:${id}`,
    })
    .catch(() => {})

  return saved
}

/** Pending accounts awaiting an administrator's decision. */
export const pendingAccounts = (users = []) =>
  users.filter((u) => u.status === USER_STATUS.PENDING)

/**
 * Update a profile.
 *
 * A user may edit their own details; changing anyone else's — and changing any
 * role or status at all — is an administrator action. Neither the email address
 * nor the password is editable here: both belong to the auth layer.
 */
export async function updateUser(id, input, actor) {
  if (actor?.id !== id) {
    assertCan(actor, PERM.USER_EDIT, 'You are not allowed to edit user accounts.')
  }

  const current = await getById(id)
  if (!current) throw new Error('User not found.')

  // An administrator's account is not part of the directory an instructor
  // keeps: only an administrator edits another administrator. Checked before
  // anything else, so the reason is the real one.
  if (actor?.id !== id && !canManageAccount(actor, current)) {
    throw new PermissionError('You are not allowed to edit that account.')
  }

  // Guard the laboratory's last administrator before field validation, so the
  // caller gets the real reason rather than a downstream "student ID required".
  const demoting = input.role && input.role !== current.role && current.role === ROLE.ADMIN
  const deactivating =
    input.status &&
    input.status !== current.status &&
    current.role === ROLE.ADMIN &&
    input.status !== USER_STATUS.ACTIVE
  if (demoting || deactivating) {
    assertCan(actor, PERM.USER_EDIT, 'Only an administrator can change a role.')
    await assertNotLastAdmin(id)
  }

  const merged = { ...current, ...input, email: current.email }
  const errors = await validate(merged, { isEdit: true, currentId: id, current })
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const next = buildProfile(id, merged, { actor, existing: current })

  // Only an administrator may change a role or an account status, so anything
  // else is forced back to the stored value.
  const changingRole = input.role && input.role !== current.role
  const changingStatus = input.status && input.status !== current.status
  if (changingRole || changingStatus) {
    assertCan(actor, PERM.USER_EDIT, 'You are not allowed to change a role or an account status.')
  }
  // Promotion to `Admin` is an administrator's decision alone — otherwise
  // `USER_EDIT` would be a one-step route from instructor to administrator.
  if (changingRole && !canAssignRole(actor, input.role)) {
    throw new PermissionError('You are not allowed to assign that role.')
  }
  if (!changingRole) next.role = current.role
  if (!changingStatus) next.status = current.status

  // Identity and provenance fields are never part of an update. `createdBy` in
  // particular must not be re-derived: on a profile created outside the app it
  // would change value, and the rules only let a self-edit touch personal
  // details — the write would be refused.
  const {
    id: _id,
    uid: _uid,
    email: _email,
    createdAt: _createdAt,
    createdBy: _createdBy,
    lastLoginAt: _lastLoginAt,
    ...patch
  } = next
  const saved = await db.update(COLLECTIONS.users, id, patch)

  await activity
    .log({
      action: ACTIVITY.USER_UPDATED,
      userId: actor?.id,
      userName: actor?.fullName,
      message: `${saved.fullName}'s account was updated.`,
      meta: { targetUserId: id },
    })
    .catch(() => {})

  return saved
}

async function assertNotLastAdmin(excludingId) {
  const admins = (await db.list(COLLECTIONS.users)).filter(
    (u) => u.role === ROLE.ADMIN && u.status === USER_STATUS.ACTIVE && u.id !== excludingId,
  )
  if (!admins.length) {
    throw new Error('The laboratory must keep at least one active administrator.')
  }
}

/**
 * Deactivate or delete an account.
 *
 * Deleting the profile revokes application access immediately — with
 * no profile there is no role, and the session is rejected at sign-in. The
 * sign-in credential goes with it, so the
 * recommended route is `setStatus(id, 'Inactive')`, which keeps the audit trail
 * intact.
 */
export async function remove(id, actor, { force = false } = {}) {
  assertCan(actor, PERM.USER_DELETE, 'You are not allowed to delete user accounts.')

  const user = await getById(id)
  if (!user) throw new Error('User not found.')
  if (user.id === actor?.id) throw new Error('You cannot delete your own account.')
  if (!canManageAccount(actor, user)) {
    throw new PermissionError('You are not allowed to delete that account.')
  }
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
  await activity
    .log({
      action: ACTIVITY.USER_DELETED,
      userId: actor?.id,
      userName: actor?.fullName,
      message: `${user.fullName} (${user.role}) was removed from the directory.`,
      meta: { targetUserId: id },
    })
    .catch(() => {})
  return true
}

/** Activate / deactivate / suspend an account. */
export async function setStatus(id, status, actor) {
  assertCan(actor, PERM.USER_EDIT, 'You are not allowed to change an account status.')
  if (!USER_STATUSES.includes(status)) throw new Error(`Unknown status "${status}".`)

  const user = await getById(id)
  if (!user) throw new Error('User not found.')
  if (!canManageAccount(actor, user)) {
    throw new PermissionError('You are not allowed to change that account.')
  }
  if (user.role === ROLE.ADMIN && status !== USER_STATUS.ACTIVE) await assertNotLastAdmin(id)

  const saved = await db.update(COLLECTIONS.users, id, { status, updatedAt: nowISO() })
  await activity
    .log({
      action: ACTIVITY.USER_UPDATED,
      userId: actor?.id,
      userName: actor?.fullName,
      message: `${user.fullName}'s account was set to ${status}.`,
      meta: { targetUserId: id, status },
    })
    .catch(() => {})
  return saved
}

/**
 * Request a password reset.
 *
 * This is how an administrator "changes" someone's password: the app never sees
 * it. Resetting your own works the same way.
 */
export async function requestPasswordReset(email, actor) {
  if (actor && actor.email?.toLowerCase() !== String(email).toLowerCase()) {
    assertCan(actor, PERM.USER_EDIT, 'You are not allowed to reset another account.')
    // Resetting a password is an account action like any other, so it obeys the
    // same directory boundary: an instructor may do it for a student and for
    // nobody else. An address that is not in the directory they can read gives
    // no row here, and is refused rather than guessed at.
    const target = await findByEmail(email)
    if (!canManageAccount(actor, target)) {
      throw new PermissionError('You are not allowed to reset that account.')
    }
  }
  await sendPasswordReset(email)
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

/* ------------------------------------------------------------------ *
 * Student profile changes, reviewed by an administrator
 *
 * The live profile columns are the *approved* profile. A student's edit is
 * stored as a patch in `pendingProfile` and only reaches the live columns when
 * an administrator approves it — `0006_profile_change_review.sql` enforces that
 * in the database, so this layer is the friendly path, not the boundary.
 *
 * Students only. An instructor's profile flow is unchanged.
 * ------------------------------------------------------------------ */

/** Review states, mirroring the CHECK constraint on `profile_review_status`. */
export const PROFILE_REVIEW = {
  APPROVED: 'Approved',
  PENDING: 'Pending',
  REJECTED: 'Rejected',
}

/** What a student may put up for review. Email is the sign-in identity. */
export const SELF_EDITABLE_FIELDS = [
  'firstName',
  'lastName',
  'studentId',
  'course',
  'yearLevel',
  'department',
  'contact',
]

/** The profile as the student should see it: approved values, patched by any pending edit. */
export function effectiveProfile(user) {
  if (!user) return null
  return user.pendingProfile ? { ...user, ...user.pendingProfile } : user
}

/** Only the fields that actually differ from the approved profile. */
function changedFields(current, input) {
  const patch = {}
  for (const field of SELF_EDITABLE_FIELDS) {
    if (input[field] === undefined) continue
    const next = String(input[field] ?? '').trim()
    if (next !== String(current[field] ?? '').trim()) patch[field] = next
  }
  return patch
}

/**
 * Submit the signed-in student's own edits for review.
 *
 * Nothing is applied here: the patch is parked and the account carries on
 * working exactly as before while it waits.
 */
/* ------------------------------------------------------------------ *
 * Profile photo
 * ------------------------------------------------------------------ */

/** Whether this database has the column `0022_profile_photos.sql` adds. */
export const avatarsAvailable = () => db.supportsColumn(COLLECTIONS.users, 'avatarUrl')

/**
 * Set — or clear — an account's own picture.
 *
 * An administrator's own picture is written straight to their row: they are the
 * reviewer, so there is nobody to ask. Everybody else's — a student's and an
 * instructor's alike — is parked in the same `pendingProfile` patch a name
 * change goes into and only reaches the account when an administrator approves
 * it, alongside whatever else is waiting.
 *
 * @param {string} userId
 * @param {string|null} avatarUrl  a public URL from `storage.uploadAvatar`, or
 *                                 null to go back to the initials tile
 * @param {object} actor
 * @returns {Promise<{ saved: object, review: boolean }>}
 */
export async function setAvatar(userId, avatarUrl, actor) {
  const own = userId === actor?.id
  const admin = actor?.role === ROLE.ADMIN
  if (!own && !admin) {
    throw new Error('You can only change your own profile picture.')
  }
  if (!(await avatarsAvailable())) {
    throw new Error(
      'Profile photos are not set up on this database yet. Ask an administrator to apply the latest migration.',
    )
  }

  const timestamp = nowISO()

  // The reviewer, or an administrator clearing somebody else's: applied now.
  if (admin) {
    const saved = await db.update(COLLECTIONS.users, userId, {
      avatarUrl: avatarUrl ?? null,
      updatedAt: timestamp,
    })
    return { saved, review: false }
  }

  const current = await getById(userId)
  if (!current) throw new Error('Your profile could not be loaded.')

  const saved = await db.update(COLLECTIONS.users, userId, {
    pendingProfile: { ...(current.pendingProfile ?? {}), avatarUrl: avatarUrl ?? null },
    profileReviewStatus: PROFILE_REVIEW.PENDING,
    profileSubmittedAt: timestamp,
    profileReviewNote: null,
    updatedAt: timestamp,
  })

  await activity
    .log({
      action: ACTIVITY.USER_UPDATED,
      userId: actor.id,
      userName: actor.fullName,
      message: `${actor.fullName} submitted a profile picture for approval.`,
      meta: { targetUserId: userId, fields: ['avatarUrl'] },
    })
    .catch(() => {})

  return { saved, review: true }
}

/** The picture to draw for this account: the approved one, or the pending one to its owner. */
export const effectiveAvatar = (user) =>
  user?.pendingProfile && 'avatarUrl' in user.pendingProfile
    ? user.pendingProfile.avatarUrl
    : (user?.avatarUrl ?? null)

export async function submitProfileChanges(input, actor) {
  if (!actor?.id) throw new Error('Sign in to edit your profile.')
  if (actor.role !== ROLE.STUDENT) {
    throw new Error('Profile review applies to student accounts.')
  }

  const current = await getById(actor.id)
  if (!current) throw new Error('Your profile could not be loaded.')

  const patch = changedFields(current, input)
  if (!Object.keys(patch).length) {
    const err = new Error('Nothing has changed.')
    err.name = 'NoChangesError'
    throw err
  }

  // Validate the merged result, so a submission cannot park an invalid profile.
  const errors = await validate(
    { ...current, ...patch },
    { isEdit: true, currentId: actor.id, current },
  )
  const relevant = Object.fromEntries(
    Object.entries(errors).filter(([field]) => SELF_EDITABLE_FIELDS.includes(field)),
  )
  if (Object.keys(relevant).length) throw new ValidationError(relevant)

  const saved = await db.update(COLLECTIONS.users, actor.id, {
    pendingProfile: patch,
    profileReviewStatus: PROFILE_REVIEW.PENDING,
    profileSubmittedAt: nowISO(),
    profileReviewNote: null,
    updatedAt: nowISO(),
  })

  await activity
    .log({
      action: ACTIVITY.USER_UPDATED,
      userId: actor.id,
      userName: actor.fullName,
      message: `${actor.fullName} submitted profile changes for approval.`,
      meta: { targetUserId: actor.id, fields: Object.keys(patch) },
    })
    .catch(() => {})

  return saved
}

/** Students waiting on a review — the administrator's queue. */
export const pendingProfileChanges = (users = []) =>
  users.filter((u) => u.profileReviewStatus === PROFILE_REVIEW.PENDING && u.pendingProfile)

/** Apply a submitted patch to the official profile. */
export async function approveProfileChanges(id, actor) {
  assertCan(actor, PERM.USER_EDIT, 'You are not allowed to approve profile changes.')

  const user = await getById(id)
  if (!user) throw new Error('User not found.')
  const patch = user.pendingProfile
  if (!patch || user.profileReviewStatus !== PROFILE_REVIEW.PENDING) {
    throw new Error('There are no changes waiting for approval.')
  }

  // `fullName` is derived, so it follows the names rather than being submitted.
  const merged = { ...user, ...patch }
  const fullName = `${merged.firstName ?? ''} ${merged.lastName ?? ''}`.replace(/\s+/g, ' ').trim()

  const saved = await db.update(COLLECTIONS.users, id, {
    ...patch,
    ...(fullName ? { fullName, displayName: fullName } : {}),
    pendingProfile: null,
    profileReviewStatus: PROFILE_REVIEW.APPROVED,
    profileReviewedAt: nowISO(),
    profileReviewedBy: actor?.id ?? null,
    profileReviewNote: null,
    updatedAt: nowISO(),
  })

  await activity
    .log({
      action: ACTIVITY.USER_UPDATED,
      userId: actor?.id,
      userName: actor?.fullName,
      message: `${user.fullName}'s profile changes were approved.`,
      meta: { targetUserId: id, fields: Object.keys(patch) },
    })
    .catch(() => {})

  await notifications
    .create({
      type: NOTIF_TYPE.SYSTEM,
      title: 'Profile changes approved',
      message: 'Your profile changes have been approved and are now on your account.',
      userId: id,
      dedupeKey: `profile-review:${id}:${Date.now()}`,
    })
    .catch(() => {})

  return saved
}

/** Discard a submitted patch; the approved profile is left exactly as it was. */
export async function rejectProfileChanges(id, actor, note = '') {
  assertCan(actor, PERM.USER_EDIT, 'You are not allowed to reject profile changes.')

  const user = await getById(id)
  if (!user) throw new Error('User not found.')
  if (user.profileReviewStatus !== PROFILE_REVIEW.PENDING) {
    throw new Error('There are no changes waiting for approval.')
  }

  const saved = await db.update(COLLECTIONS.users, id, {
    pendingProfile: null,
    profileReviewStatus: PROFILE_REVIEW.REJECTED,
    profileReviewedAt: nowISO(),
    profileReviewedBy: actor?.id ?? null,
    profileReviewNote: String(note ?? '').trim() || null,
    updatedAt: nowISO(),
  })

  await activity
    .log({
      action: ACTIVITY.USER_UPDATED,
      userId: actor?.id,
      userName: actor?.fullName,
      message: `${user.fullName}'s profile changes were rejected.`,
      meta: { targetUserId: id },
    })
    .catch(() => {})

  await notifications
    .create({
      type: NOTIF_TYPE.SYSTEM,
      title: 'Profile changes not approved',
      message:
        String(note ?? '').trim() ||
        'Your profile changes were not approved. Your previous details are unchanged.',
      userId: id,
      dedupeKey: `profile-review:${id}:${Date.now()}`,
    })
    .catch(() => {})

  return saved
}
