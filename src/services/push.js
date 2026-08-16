import * as db from './db'
import { accessToken } from './localAuth'

/**
 * Web Push — the phone-level half of the notification centre.
 *
 * The records in `notifications` are unchanged and remain the source of truth;
 * this only registers *where* an alert for one of them should be delivered when
 * the app is not open. Everything here is optional: with no VAPID key
 * configured, an unsupported browser or a denied permission, the app behaves
 * exactly as it did before and the in-app centre carries on alone.
 *
 * The subscription belongs to the device, not the session — one row per
 * browser, keyed by the endpoint the push service issues.
 */

/** The public half of the VAPID pair. Absent means push is simply not set up. */
export const vapidPublicKey = String(import.meta.env?.VITE_VAPID_PUBLIC_KEY ?? '').trim()

/** Does this browser have the three pieces a push needs? */
export function isSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** Configured *and* supported — the only state in which subscribing can work. */
export const isAvailable = () => isSupported() && !!vapidPublicKey

/** `granted` | `denied` | `default` | `unsupported` */
export function permissionState() {
  if (!isSupported()) return 'unsupported'
  return Notification.permission
}

/** The push service wants the key as bytes, not base64url. */
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = window.atob(padded)
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

/** The subscription this device already holds, if any. */
export async function currentSubscription() {
  if (!isSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  return (await registration?.pushManager.getSubscription()) ?? null
}

/** Is this device already receiving pushes? */
export async function isSubscribed() {
  return permissionState() === 'granted' && !!(await currentSubscription())
}

/**
 * Ask for permission, subscribe, and record the endpoint against the account.
 *
 * @throws {Error} with a sentence the settings card can show
 */
export async function subscribe(user) {
  if (!isSupported()) throw new Error('This browser cannot show push notifications.')
  if (!vapidPublicKey) {
    throw new Error('Push notifications are not configured for this installation.')
  }
  if (!user?.id) throw new Error('Sign in to turn on notifications.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in the browser settings, then try again.'
        : 'Notifications were not allowed.',
    )
  }

  // `ready` rather than `getRegistration`: the worker may still be installing on
  // a first visit, and subscribing needs an active one.
  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }))

  const json = subscription.toJSON()
  try {
    await db.savePushSubscription({
      endpoint: subscription.endpoint,
      user_id: user.id,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
      user_agent: navigator.userAgent.slice(0, 300),
      updated_at: new Date().toISOString(),
    })
  } catch (err) {
    // A row that cannot be stored is a subscription nothing can deliver to, so
    // do not leave the browser holding one. The reason goes to the console
    // rather than the screen.
    console.warn('[push] the subscription could not be saved', err)
    await subscription.unsubscribe().catch(() => {})
    throw new Error('The subscription could not be saved. Please try again.')
  }

  return subscription
}

/** Stop this device receiving pushes, and drop its row. */
export async function unsubscribe() {
  const subscription = await currentSubscription()
  if (!subscription) return false
  await db.removePushSubscription(subscription.endpoint)
  await subscription.unsubscribe().catch(() => {})
  return true
}

/**
 * Ask the server to deliver a stored notification to its recipient's devices.
 *
 * Best-effort and deliberately thin: the notification is already written, so a
 * failure here costs the phone alert and nothing else. The server re-reads the
 * row and decides who it is for — the browser cannot address a push at somebody
 * by asking.
 */
export async function deliver(notificationId) {
  if (!notificationId) return false
  try {
    const token = await accessToken()
    if (!token) return false

    const response = await fetch('/api/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ notificationId }),
    })
    return response.ok
  } catch (err) {
    console.warn('[push] the notification was stored but not pushed', err)
    return false
  }
}
