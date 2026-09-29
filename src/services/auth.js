import * as db from './db'
import { COLLECTIONS } from './db'
import * as activity from './activity'
import * as localAuth from './localAuth'
import { AuthError } from './localAuth'
import { SIGNUP_ROLES, signupStatusFor } from './users'
import { ValidationError } from './tools'
import { ACTIVITY, ACTIVE_TXN_STATUSES, ROLE, USER_STATUS } from '../utils/constants'
import { nowISO } from '../utils/dates'

/**
 * Authentication service.
 *
 * The local auth layer owns credentials and the session; the data layer owns the
 * profile. A signed-in user is *not* yet an application user: the
 * `users/{uid}` document supplies the role, and an account without one — or one
 * that is not active — is signed straight back out. That is what stops the
 * frontend from ever deciding its own role.
 *
 * No password, hash or salt is written to the directory by anything in this file.
 */

export { AuthError }

export const onAuthChange = localAuth.onAuthChange
// Changing your own password is a credential operation, so it lives in the
// auth layer with the rest of them and is only re-exported here — the UI talks
// to one service, as it already did for sign-in and the reset email.
export const changePassword = localAuth.changePassword
export const MIN_PASSWORD_LENGTH = localAuth.MIN_PASSWORD_LENGTH
export const sendPasswordReset = localAuth.sendPasswordReset
export const signInWithGoogle = localAuth.signInWithGoogle
export const OAUTH_ERROR_EVENT = localAuth.OAUTH_ERROR_EVENT
export const hasPendingOAuth = localAuth.hasPendingOAuth
export const clearPendingOAuth = localAuth.clearPendingOAuth

/** Merge the session identity into the stored profile the UI renders. */
export function toProfile(sessionUser, document) {
  if (!document) return null
  const fullName = document.fullName ?? document.displayName ?? sessionUser?.displayName ?? ''
  return {
    ...document,
    id: document.id ?? sessionUser?.uid,
    uid: document.id ?? sessionUser?.uid,
    email: document.email ?? sessionUser?.email ?? '',
    fullName,
    displayName: document.displayName ?? fullName,
    emailVerified: sessionUser?.emailVerified ?? false,
  }
}

/**
 * Load the profile behind a session.
 *
 * Reads `users/{uid}` directly rather than through the scoped stream, because
 * the scope cannot be set until the role is known.
 *
 * @throws {AuthError} when there is no profile, or the account is not active
 */
export async function loadProfile(sessionUser) {
  if (!sessionUser?.uid) return null

  // Registration signs the account in *before* its profile row is written, so
  // the session change fires while the insert is still in flight and the first
  // read comes back empty. Only a missing row is retried — a read that fails,
  // or a profile that exists but is not usable, is reported at once as before.
  const read = async () => {
    try {
      return await db.getDirect(COLLECTIONS.users, sessionUser.uid)
    } catch (err) {
      // The reason is for the console, not the screen: a database error carries
      // table names, column names and policy details, and the person reading it
      // can act on none of them.
      console.warn('[auth] the profile could not be read', err)
      // In practice this is what a newly registered instructor sees. The account
      // is created and then signed straight back out because it is `Pending`,
      // and a read that races that sign-out runs as `anon` — which 0002 revokes
      // from every table, so it fails here rather than returning the row that
      // would have produced the pending message below. Leading with the account
      // status says the true thing to the instructor who is waiting, and the
      // second sentence still fits the rarer case of a genuine read failure.
      throw new AuthError(
        'Your account is pending approval. Please wait for an administrator to approve your ' +
          'account. If you have signed in before, this may be a temporary problem — please try again.',
      )
    }
  }

  let document = await read()
  if (sessionUser.provider === 'google') {
    // A Google sign-in started on this device only ever sets up an account
    // that has no profile; an existing one is used as it is.
    if (document) localAuth.clearPendingOAuth()
    else document = await provisionGoogleProfile(sessionUser, localAuth.readPendingOAuth(), read)
  }
  for (let attempt = 0; !document && attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400))
    document = await read()
  }

  // Registration writes the profile with the account, so a session without one
  // is a fault rather than a step somebody has to finish by hand.
  if (!document) {
    // No connection and no copy on this device is not a problem with the
    // account, so it is not reported as one.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new AuthError(
        'Your laboratory profile is not stored on this device yet. Connect to the internet once to finish signing in.',
      )
    }
    throw new AuthError('This account cannot be used right now. Contact the laboratory administrator.')
  }

  // Only an active account authorises anything. Each state gets its own wording
  // so the person knows whether to wait, or to go and talk to somebody.
  if (document.status === USER_STATUS.PENDING) {
    const error = new AuthError(
      'Your account is pending approval. Please wait for an administrator to approve your account.',
    )
    error.status = USER_STATUS.PENDING
    throw error
  }
  if (document.status === USER_STATUS.SUSPENDED) {
    throw new AuthError('This account is suspended. Contact the laboratory administrator.')
  }
  if (document.status && document.status !== USER_STATUS.ACTIVE) {
    throw new AuthError(
      'Your account is currently inactive. Please contact an administrator.',
    )
  }
  if (!document.role) {
    throw new AuthError('This account has no role assigned. Contact the laboratory administrator.')
  }

  return toProfile(sessionUser, document)
}

/**
 * Create the profile for a new Google account, with the role chosen on the
 * Create Account screen before leaving for Google.
 *
 * Only ever called when the account has no profile, so an existing account
 * keeps its stored role — choosing Instructor on a later visit changes
 * nothing. The identity comes from the auth server (`getUser`), not from the
 * stored session. The role is limited to `SIGNUP_ROLES` with the status
 * derived here, and the database enforces the same thing regardless:
 * `profiles_insert` accepts only the caller's own row as `Student`/`Active` or
 * `Instructor`/`Pending`, the primary key is the auth id and the email is
 * unique, so the same person cannot end up with two profiles.
 *
 * @returns the profile, or null when this was a sign-in rather than a sign-up
 */
async function provisionGoogleProfile(sessionUser, pending, read) {
  if (pending?.intent !== 'signup') {
    localAuth.clearPendingOAuth()
    throw new AuthError(
      'No Tool Track account uses this Google account yet. Choose Create an account, ' +
        'pick Student or Instructor, then continue with Google.',
    )
  }

  const identity = await googleIdentity(sessionUser)
  const role = SIGNUP_ROLES.includes(pending.role) ? pending.role : ROLE.STUDENT

  // A student account is not created until its student details are in: the
  // app asks for them first (`ProfileSetupDialog`), then calls
  // `completeStudentGoogleSignUp`. A student cannot change these fields on
  // their own profile afterwards without an administrator's review, so they
  // are written with the account instead.
  if (role === ROLE.STUDENT) {
    const error = new AuthError('Complete your student details to finish creating your account.')
    error.code = PROFILE_SETUP_REQUIRED
    error.setup = { role, fullName: identity.fullName, email: identity.email }
    throw error
  }

  return insertGoogleProfile(identity, role, {}, read)
}

/** Thrown by `loadProfile` while a new Google student account needs its details. */
export const PROFILE_SETUP_REQUIRED = 'profile_setup_required'

/** The Google account's identity, as the auth server reports it right now. */
async function googleIdentity(sessionUser) {
  const user = await localAuth.verifiedUser()
  if (!user || user.id !== sessionUser.uid || !user.email) {
    throw new AuthError('Google sign-in could not be completed. Please try again.')
  }
  const meta = user.user_metadata ?? {}
  const fullName = String(meta.full_name ?? meta.name ?? user.email.split('@')[0])
    .replace(/\s+/g, ' ')
    .trim()
  const [firstName, ...rest] = fullName.split(' ')
  return {
    id: user.id,
    email: user.email.toLowerCase(),
    fullName,
    firstName: meta.given_name ?? firstName ?? '',
    lastName: meta.family_name ?? rest.join(' '),
  }
}

/**
 * Write the new profile — the same shape `users.signUp()` writes, with `N/A`
 * for what this role has no value for. The pending request is used up here.
 */
async function insertGoogleProfile(identity, role, details, read) {
  const isStudent = role === ROLE.STUDENT
  const timestamp = nowISO()
  try {
    await db.insert(COLLECTIONS.users, {
      id: identity.id,
      email: identity.email,
      firstName: identity.firstName,
      lastName: identity.lastName,
      fullName: identity.fullName,
      displayName: identity.fullName,
      role,
      status: signupStatusFor(role),
      studentId: isStudent ? details.studentId : 'N/A',
      course: isStudent ? details.department : 'N/A',
      yearLevel: 'N/A',
      employeeId: 'N/A',
      department: details.department ?? 'N/A',
      contact: details.contact ?? '',
      registeredSelf: true,
      createdAt: timestamp,
      createdBy: null,
      updatedAt: timestamp,
      lastLoginAt: null,
    })
  } catch (err) {
    console.warn('[auth] the Google profile could not be saved', err)
    // Another tab may have written it first; that row stands as it is.
    const existing = await read()
    if (existing) {
      localAuth.clearPendingOAuth()
      return existing
    }
    throw new AuthError(
      'This Google account could not be set up. If this email already has a Tool Track ' +
        'account, sign in with your email and password instead.',
    )
  }
  localAuth.clearPendingOAuth()
  return read()
}

/** The student details the setup dialog asks for, checked like the sign-up form. */
export function validateStudentDetails(details) {
  const errors = {}
  if (!details.studentId?.trim()) errors.studentId = 'Please enter your student ID.'
  if (!details.department?.trim()) errors.department = 'Please enter your programme.'
  if (details.contact?.trim() && !/^[0-9+()\-\s]{7,20}$/.test(details.contact.trim())) {
    errors.contact = 'Please enter a valid contact number.'
  }
  return errors
}

/**
 * Finish a new Google student account with the details from the setup dialog.
 *
 * Only for the signed-in Google account, only while it has no profile, and
 * only when this device started a student sign-up — the role never comes from
 * the dialog. The database's `profiles_insert` policy holds regardless.
 */
export async function completeStudentGoogleSignUp(details) {
  const errors = validateStudentDetails(details)
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const sessionUser = localAuth.currentUser()
  const pending = localAuth.readPendingOAuth()
  if (
    !sessionUser ||
    sessionUser.provider !== 'google' ||
    pending?.intent !== 'signup' ||
    pending.role !== ROLE.STUDENT
  ) {
    throw new AuthError('This sign-up has expired. Start again from Create an account.')
  }

  const read = () => db.getDirect(COLLECTIONS.users, sessionUser.uid)
  if (await read()) {
    localAuth.clearPendingOAuth()
    return
  }

  const identity = await googleIdentity(sessionUser)
  await insertGoogleProfile(
    identity,
    ROLE.STUDENT,
    {
      studentId: details.studentId.trim(),
      department: details.department.trim(),
      contact: details.contact?.trim() ?? '',
    },
    read,
  )
}

/** Leave a new Google sign-up without creating an account. */
export async function cancelGoogleSignUp() {
  localAuth.clearPendingOAuth()
  await logout()
}

/**
 * Finish a Google sign-in that returned to `/auth/callback`.
 *
 * Only establishes the session. The profile — and with it the role — is then
 * loaded by the app's ordinary session handling (`loadProfile`), exactly as
 * for a password sign-in.
 *
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function completeGoogleCallback(url) {
  const error = localAuth.oauthErrorFrom(url)
  if (error) {
    localAuth.clearPendingOAuth()
    return { ok: false, error }
  }
  const ok = await localAuth.completeAuthFromUrl(url)
  if (!ok) {
    localAuth.clearPendingOAuth()
    return { ok: false, error: 'Google sign-in could not be completed. Please try again.' }
  }
  return { ok: true }
}

/**
 * Sign in and resolve the application profile.
 *
 * A credential that authenticates but has no usable profile is signed out again
 * so the app is never left holding a session it cannot authorise.
 */
export async function login(email, password) {
  const sessionUser = await localAuth.signIn(email, password)

  let profile
  try {
    profile = await loadProfile(sessionUser)
  } catch (err) {
    await localAuth.signOut().catch(() => {})
    throw err
  }

  // Best-effort bookkeeping: a failure here must not block the sign-in.
  recordSignIn(profile).catch((err) => console.warn('[auth] sign-in not recorded', err))

  return profile
}

async function recordSignIn(profile) {
  db.setScope({ uid: profile.id, role: profile.role })
  await db.update(COLLECTIONS.users, profile.id, { lastLoginAt: nowISO() })
  await activity.log({
    action: ACTIVITY.LOGIN,
    userId: profile.id,
    userName: profile.fullName,
    message: `${profile.fullName} signed in as ${profile.role}.`,
  })
}

/** Sign out and drop every scoped listener with the session. */
export async function logout() {
  try {
    await localAuth.signOut()
  } finally {
    db.clearScope()
  }
}

/**
 * Delete the signed-in user's own account — permanently.
 *
 * The credential and the profile row go together: the app deletes the sign-in
 * account (the profile cascades with it), so the email can be registered again
 * and nothing usable is left behind. That cannot be done with the anon key and
 * Row Level Security — a user is deliberately not allowed to delete their own
 * `profiles` row — so it runs as a SECURITY DEFINER function on the server.
 *
 * The guards here are the friendly layer over the ones the database enforces:
 * an account with tools still out is refused (the loan record survives by
 * design, so the tool must not be stranded), and the last active administrator
 * cannot remove themselves. Borrowing history is deliberately *not* touched —
 * `transactions.user_id` is text for exactly this reason.
 *
 * @throws when the account cannot be deleted, with a message the UI can show
 */
export async function deleteAccount(user) {
  if (!user?.id) throw new Error('Sign in to delete your account.')

  if (user.role === ROLE.ADMIN) {
    const admins = (await db.list(COLLECTIONS.users)).filter(
      (u) => u.role === ROLE.ADMIN && u.status === USER_STATUS.ACTIVE && u.id !== user.id,
    )
    if (!admins.length) {
      throw new Error('The laboratory must keep at least one active administrator.')
    }
  }

  const open = await db.query(
    COLLECTIONS.transactions,
    (t) => t.userId === user.id && ACTIVE_TXN_STATUSES.includes(t.status),
  )
  if (open.length) {
    throw new Error(
      `You still have ${open.length} tool${open.length === 1 ? '' : 's'} on loan. ` +
        'Return them before deleting your account.',
    )
  }

  await db.rpc('delete_own_account')

  // The session cannot be trusted once its account is gone. Sign out best-effort
  // — the account no longer exists, so the endpoint may refuse — and clear the
  // data scope either way.
  try {
    await localAuth.signOut()
  } catch (err) {
    console.warn('[auth] sign-out after account deletion', err)
  }
  db.clearScope()
}

export const currentSessionUser = localAuth.currentUser
