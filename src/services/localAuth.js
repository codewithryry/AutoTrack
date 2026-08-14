import { createClient } from '@supabase/supabase-js'
import { supabase, supabaseAnonKey, supabaseUrl } from '../supabase/config'
import * as db from './db'
import { COLLECTIONS } from './db'

/**
 * Session and credentials — Supabase Auth.
 *
 * Keeps the shape the rest of the application already expects: `signIn`,
 * `signOut`, `onAuthChange`, `currentUser`, `registerAccount`,
 * `createAuthAccount`, and an `AuthError` carrying a `field` hint, so
 * `services/auth.js`, `services/users.js` and the login form are unchanged.
 *
 * Supabase Auth owns credentials and the session; the `profiles` table owns the
 * role. A signed-in user is *not* yet an application user — `services/auth.js`
 * loads the profile and refuses a session that has no usable one. Passwords go
 * to Supabase Auth and nowhere else: they are never written to a table, never
 * logged, and never kept in application state after a submit.
 *
 * The module name is unchanged so the swap touched one file rather than five.
 */

export class AuthError extends Error {
  /** @param {string} message @param {'email'|'password'|undefined} field */
  constructor(message, field) {
    super(message)
    this.name = 'AuthError'
    this.field = field
  }
}

/** Supabase persists and refreshes the session itself; nothing to await. */
export function ensurePersistence() {
  return Promise.resolve()
}

/**
 * Friendly, non-enumerating messages.
 *
 * `invalid_credentials` covers a wrong password *and* an unknown account — one
 * wording, so the form never confirms which addresses exist.
 */
const CODE_MESSAGES = {
  invalid_credentials: ['Incorrect email or password.', 'password'],
  email_not_confirmed: ['Confirm your email address before signing in.', 'email'],
  user_banned: ['This account has been disabled. Contact the laboratory administrator.'],
  over_request_rate_limit: [
    'Too many attempts. Wait a moment before trying again, or reset the password.',
  ],
  over_email_send_rate_limit: ['Too many emails requested. Wait a moment and try again.'],
  user_already_exists: ['That email address already has an account.', 'email'],
  email_exists: ['That email address already has an account.', 'email'],
  weak_password: ['Use at least 6 characters.', 'password'],
  validation_failed: ['Enter a valid email address.', 'email'],
  signup_disabled: ['Sign-up is not enabled for this project.'],
  email_provider_disabled: ['Email and password sign-in is not enabled for this project.'],
  session_expired: ['Your session has expired. Sign in again to continue.'],
}

/** Fallbacks for responses that carry only a message. */
const MESSAGE_PATTERNS = [
  [/invalid login credentials/i, ['Incorrect email or password.', 'password']],
  [/email not confirmed/i, ['Confirm your email address before signing in.', 'email']],
  [/already registered|already been registered/i, [
    'That email address already has an account.',
    'email',
  ]],
  [/password should be at least/i, ['Use at least 6 characters.', 'password']],
  [/rate limit|too many requests/i, [
    'Too many attempts. Wait a moment before trying again, or reset the password.',
  ]],
  [/failed to fetch|network/i, [
    'Cannot reach the laboratory server. Check the internet connection and try again.',
  ]],
]

export function toAuthError(err) {
  if (err instanceof AuthError) return err
  const mapped = CODE_MESSAGES[err?.code ?? err?.error_code]
  if (mapped) return new AuthError(mapped[0], mapped[1])
  const text = err?.message ?? ''
  for (const [pattern, [message, field]] of MESSAGE_PATTERNS) {
    if (pattern.test(text)) return new AuthError(message, field)
  }
  return new AuthError(text || 'Unable to sign in.', undefined)
}

/**
 * The identity half of an account, in the shape the application expects:
 * `uid`, `email`, `emailVerified`. The profile comes from `users` separately.
 */
const toSessionUser = (user) =>
  user
    ? {
        uid: user.id,
        id: user.id,
        email: user.email ?? '',
        emailVerified: !!user.email_confirmed_at,
        displayName: user.user_metadata?.full_name ?? '',
      }
    : null

/* ------------------------------------------------------------------ *
 * Session
 * ------------------------------------------------------------------ */

export async function signIn(email, password) {
  const address = String(email ?? '').trim()
  if (!address) throw new AuthError('Enter your email address.', 'email')
  if (!password) throw new AuthError('Enter your password.', 'password')

  const { data, error } = await supabase.auth.signInWithPassword({ email: address, password })
  if (error) throw toAuthError(error)
  return toSessionUser(data.user)
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  // An already-expired session cannot be signed out again; the caller clears
  // local state either way, so that is not worth surfacing.
  if (error && !/session|missing/i.test(error.message ?? '')) throw toAuthError(error)
}

/**
 * Subscribe to the session.
 *
 * Fires once with the restored user (or null) as soon as Supabase has read its
 * storage — which is what ends the app's boot state. `onAuthStateChange` does
 * not guarantee that first call, so the current session is fetched explicitly
 * and delivered first.
 */
export function onAuthChange(callback) {
  let cancelled = false
  let delivered = false

  const deliver = (user) => {
    if (cancelled) return
    delivered = true
    callback(user)
  }

  supabase.auth
    .getSession()
    .then(({ data, error }) => {
      if (error) console.error('[auth] could not restore the session', error)
      if (!delivered) deliver(toSessionUser(data?.session?.user ?? null))
    })
    .catch((err) => {
      console.error('[auth] session lookup failed', err)
      if (!delivered) deliver(null)
    })

  const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
    // INITIAL_SESSION duplicates the getSession() above.
    if (event === 'INITIAL_SESSION' && delivered) return
    deliver(toSessionUser(session?.user ?? null))
  })

  return () => {
    cancelled = true
    subscription?.subscription?.unsubscribe?.()
  }
}

/**
 * The signed-in user, synchronously — the contract `currentUser()` has always
 * had. Supabase's own accessor is async, so the session is mirrored here from
 * the auth event stream and read from that mirror.
 */
let sessionUserCache = null
supabase.auth.getSession().then(({ data }) => {
  sessionUserCache ??= toSessionUser(data?.session?.user ?? null)
})
supabase.auth.onAuthStateChange((_event, session) => {
  sessionUserCache = toSessionUser(session?.user ?? null)
})

export const currentUser = () => sessionUserCache

export async function sendPasswordReset(email) {
  const address = String(email ?? '').trim()
  const { error } = await supabase.auth.resetPasswordForEmail(address, {
    redirectTo: `${window.location.origin}/login`,
  })
  if (error) throw toAuthError(error)
}

/* ------------------------------------------------------------------ *
 * Account creation
 * ------------------------------------------------------------------ */

/**
 * Register a new account and its profile, for the public sign-up form.
 *
 * `signUp` signs the new user in, which is exactly what the profile insert
 * needs: the `profiles_insert` policy requires `id = auth.uid()`, so the row can
 * only be written from the new account's own session — and the same policy
 * refuses any attempt to ask for the `Admin` role.
 */
export async function registerAccount({ email, password, displayName, profile }) {
  const address = String(email ?? '').trim().toLowerCase()

  let { data, error } = await supabase.auth.signUp({
    email: address,
    password,
    options: { data: { full_name: displayName } },
  })

  // Retrying a sign-up that half-succeeded — the account was created but the
  // profile write failed — must not be a dead end. If the credentials match the
  // existing account, sign in with them and carry on to the profile step; the
  // upsert below then completes the registration instead of duplicating it.
  if (error && /already registered|already been registered|user_already_exists/i.test(
      `${error.message ?? ''} ${error.code ?? ''}`)) {
    const retry = await supabase.auth.signInWithPassword({ email: address, password })
    if (retry.error) {
      // A different password: this address genuinely belongs to someone else.
      throw new AuthError('That email address already has an account.', 'email')
    }
    data = retry.data
    error = null
  }
  if (error) throw toAuthError(error)

  const uid = data?.user?.id
  if (!uid) {
    throw new AuthError('The account was created but no session was returned. Try signing in.')
  }

  // Without a session the profile insert has no `auth.uid()`, so the policy
  // refuses it. That happens when the project still requires email
  // confirmation — say which of the two it is rather than reporting a
  // permission error the person cannot act on.
  if (!data.session) {
    throw new AuthError(
      `Your account was created, but it needs the email address at ${address} to be ` +
        `confirmed before it can be set up. Open the confirmation link, then sign in.`,
    )
  }

  try {
    // Upsert, not insert: a retry after a failed profile write must complete the
    // registration rather than collide with the row it left behind.
    await db.upsert(COLLECTIONS.users, profile(uid))
  } catch (err) {
    // The sign-in account exists but has no usable profile. Removing it needs
    // the service role, so say plainly what must happen next.
    throw new AuthError(
      `The sign-in account for ${address} was created, but its laboratory profile ` +
        `could not be saved (${err.message}). Sign up again with the same email and ` +
        `password to finish setting it up, or ask an administrator for help.`,
    )
  }

  return { uid }
}

/**
 * Create an account *for somebody else* — an administrator provisioning a user.
 *
 * The obvious route, Supabase's admin API, needs the service-role key: it
 * bypasses RLS and must never reach a bundle. This avoids it entirely.
 *
 * `signUp` signs the new account in on whichever client it is called against,
 * which on the shared client would silently replace the administrator's own
 * session mid-form. So it runs on a short-lived *secondary* client with its own
 * storage key and no session persistence — the administrator's session is never
 * touched, and the throwaway one is discarded immediately.
 *
 * Only the credential is created here. The profile is written by the caller,
 * from the administrator's own session, which is what allows any role —
 * including `Admin` — to be assigned: `profiles_insert` permits `is_admin()` to
 * insert anything, while a self-registration may only ever be Instructor or
 * Student. That is also why creating an administrator this way does not weaken
 * the boundary: it still takes an existing administrator to do it.
 */
export async function createAuthAccount({ email, password, displayName }) {
  const address = String(email ?? '').trim().toLowerCase()
  if (!address) throw new AuthError('Enter an email address.', 'email')
  if (!password) throw new AuthError('Enter a password.', 'password')

  const secondary = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // The whole point: a separate storage key and no persistence, so this
      // never writes over the administrator's session.
      storageKey: `stms.provision.${Date.now()}`,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  try {
    const { data, error } = await secondary.auth.signUp({
      email: address,
      password,
      options: { data: { full_name: displayName } },
    })
    if (error) throw toAuthError(error)
    const uid = data.user?.id
    if (!uid) throw new AuthError('The account could not be created.')
    return { uid }
  } finally {
    await secondary.auth.signOut().catch(() => {})
  }
}
