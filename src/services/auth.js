import * as db from './db'
import { COLLECTIONS } from './db'
import * as activity from './activity'
import * as localAuth from './localAuth'
import { AuthError } from './localAuth'
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
export const sendPasswordReset = localAuth.sendPasswordReset

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
  for (let attempt = 0; !document && attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400))
    document = await read()
  }

  // Registration writes the profile with the account, so a session without one
  // is a fault rather than a step somebody has to finish by hand.
  if (!document) {
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
