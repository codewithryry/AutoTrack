import * as db from './db'
import { COLLECTIONS } from './db'
import { PRESENCE_WINDOW_MS } from '../utils/constants'
import { nowISO } from '../utils/dates'

/**
 * Who is around.
 *
 * Two halves, because "online" and "last seen" are different questions.
 * Realtime Presence answers the first exactly: it is a property of an open
 * connection, so it appears when someone opens the app and disappears when they
 * close it, with nothing to clean up. The second is for everyone else, and is a
 * stamp on the profile — written by the account itself, on the same terms as
 * any other field it owns.
 */

/** Announce this account, and hear about everyone else. Returns a leave function. */
export const join = (user, onChange) =>
  db.joinPresence(
    { uid: user?.id, name: user?.fullName, role: user?.role },
    onChange,
  )

/**
 * Stamp "I was here" on my own profile.
 *
 * Throttled by the caller, and deliberately best-effort: a failed stamp means a
 * slightly stale "last seen", never a failed action.
 */
export async function touch(user) {
  if (!user?.id) return null
  try {
    return await db.update(COLLECTIONS.users, user.id, { lastSeenAt: nowISO() })
  } catch (err) {
    console.warn('[presence] last-seen was not recorded', err)
    return null
  }
}

/**
 * Is this account present?
 *
 * Connected now, or seen within the window — which is what keeps somebody who
 * has just locked their phone from reading as gone.
 */
export function isOnline(userOrId, { online = [], profile = null, now = Date.now() } = {}) {
  const id = typeof userOrId === 'string' ? userOrId : userOrId?.id
  if (!id) return false
  if (online.includes(id)) return true

  const seen = (profile ?? (typeof userOrId === 'object' ? userOrId : null))?.lastSeenAt
  if (!seen) return false
  return now - new Date(seen).getTime() < PRESENCE_WINDOW_MS
}

/** "Online", or how long ago they were last around. */
export function presenceLabel(user, { online = [], now = Date.now() } = {}) {
  if (isOnline(user, { online, now })) return 'Online'
  if (!user?.lastSeenAt) return 'Offline'

  const minutes = Math.floor((now - new Date(user.lastSeenAt).getTime()) / 60000)
  if (minutes < 60) return `Last seen ${Math.max(1, minutes)} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Last seen ${hours} hr ago`
  return `Last seen ${Math.floor(hours / 24)} d ago`
}
