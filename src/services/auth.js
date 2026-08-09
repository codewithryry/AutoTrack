import * as db from './db'
import { COLLECTIONS } from './db'
import * as users from './users'
import * as activity from './activity'
import { ACTIVITY, USER_STATUS } from '../utils/constants'
import { nowISO } from '../utils/dates'

/**
 * Local demo authentication.
 *
 * Credentials live in the users collection as salted hashes; the session
 * pointer lives in localStorage so a refresh or a cold start keeps the
 * technician signed in. Only the id is persisted — the profile is re-read from
 * the database on boot so a role change takes effect immediately.
 */

const SESSION_KEY = 'stms.session'

export class AuthError extends Error {
  constructor(message, field) {
    super(message)
    this.name = 'AuthError'
    this.field = field
  }
}

function saveSession(user) {
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ userId: user.id, signedInAt: nowISO() }),
    )
  } catch {
    // Private browsing with storage disabled — the session simply won't persist.
  }
}

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

/** Strip credentials before a user object reaches the UI. */
export function publicUser(user) {
  if (!user) return null
  const { passwordHash, salt, ...rest } = user
  return rest
}

export async function login(username, password) {
  const name = String(username ?? '').trim()
  if (!name) throw new AuthError('Enter your username.', 'username')
  if (!password) throw new AuthError('Enter your password.', 'password')

  const user = await users.findByUsername(name)
  // Same message for both cases so the form does not confirm which usernames exist.
  if (!user) throw new AuthError('Incorrect username or password.', 'username')

  const ok = await users.verifyPassword(user, password)
  if (!ok) throw new AuthError('Incorrect username or password.', 'password')

  if (user.status === USER_STATUS.SUSPENDED) {
    throw new AuthError('This account is suspended. Contact the laboratory administrator.')
  }
  if (user.status === USER_STATUS.INACTIVE) {
    throw new AuthError('This account is inactive. Contact the laboratory administrator.')
  }

  saveSession(user)
  await db.update(COLLECTIONS.users, user.id, { lastLoginAt: nowISO() })
  await activity.log({
    action: ACTIVITY.LOGIN,
    userId: user.id,
    userName: user.fullName,
    message: `${user.fullName} signed in as ${user.role}.`,
  })

  return publicUser(await users.getById(user.id))
}

/** Resolve the persisted session into a live user, or null. */
export async function restore() {
  const session = readSession()
  if (!session?.userId) return null
  const user = await users.getById(session.userId)
  if (!user || user.status !== USER_STATUS.ACTIVE) {
    clearSession()
    return null
  }
  return publicUser(user)
}

export function logout() {
  clearSession()
}

/** Demo credentials advertised on the login screen. */
export const DEMO_ACCOUNTS = [
  {
    username: 'admin',
    password: 'admin123',
    role: 'Admin',
    label: 'Laboratory Administrator',
    blurb: 'Full control over tools, users, reports and settings.',
  },
  {
    username: 'instructor',
    password: 'instructor123',
    role: 'Instructor',
    label: 'Automotive Instructor',
    blurb: 'Issue and receive tools, oversee student borrowing.',
  },
  {
    username: 'student',
    password: 'student123',
    role: 'Student',
    label: 'Automotive Student',
    blurb: 'Scan, borrow and return tools for laboratory activities.',
  },
]
