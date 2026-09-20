import * as db from './db'
import { accessToken } from './localAuth'
import { apiUrl, isNative } from '../utils/native'
import * as native from './nativeNotifications'

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

/**
 * Does this platform have the pieces an alert needs?
 *
 * Two different answers for two different mechanisms. In the browser it is Web
 * Push: a service worker, a push manager and `Notification`. In the Android
 * shell none of those exist — the WebView implements neither the Push API nor
 * `Notification`, and the native build ships without a service worker on
 * purpose — so the question is instead whether the local-notification plugin is
 * there. That is why Notifications did nothing in the APK: every check here used
 * to be a browser check, and every one of them was false.
 */
export function isSupported() {
  if (isNative()) return native.isSupported()
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/**
 * Configured *and* supported — the only state in which turning alerts on works.
 *
 * The VAPID key is a Web Push requirement and has no bearing on the native path,
 * which posts its notifications locally and needs no server key at all.
 */
export const isAvailable = () => (isNative() ? native.isSupported() : isSupported() && !!vapidPublicKey)

/**
 * `granted` | `denied` | `default` | `unsupported`
 *
 * Synchronous, and therefore the WEB answer only: `Notification.permission` is
 * already a value rather than a promise.
 *
 * There is deliberately no native branch and no cached mirror here any more.
 * A mirror is a second copy of something Android already knows, and the copy
 * went stale — the settings row could report "not set" moments after the
 * permission had been granted, because nothing had refreshed it in between.
 * Native callers ask `services/nativePermissions.notificationState()`, which
 * reads the OS every time, exactly as the Camera and Location rows do.
 */
export function permissionState() {
  if (isNative()) return 'unsupported'
  if (!isSupported()) return 'unsupported'
  return Notification.permission
}

/**
 * The real permission, from whichever platform owns it.
 *
 * Asynchronous because the Android answer is. Kept so existing callers have one
 * function to ask, rather than each deciding which platform they are on.
 */
export async function syncPermissionState() {
  if (isNative()) return native.permissionState()
  return permissionState()
}

/**
 * Whether an alert can arrive while the app is fully closed.
 *
 * True on the web, where the service worker receives a push with the app shut.
 * False in the APK, which posts its notifications itself and therefore has to be
 * running: that needs Firebase Cloud Messaging, which this project has not set
 * up. Exposed so the settings row can describe what it actually does.
 */
export const isRemoteCapable = () => (isNative() ? native.isRemoteCapable() : isSupported())

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
  // Natively the permission is the whole subscription; there is no endpoint.
  if (isNative()) return (await syncPermissionState()) === 'granted'
  return permissionState() === 'granted' && !!(await currentSubscription())
}

/**
 * Ask for permission, subscribe, and record the endpoint against the account.
 *
 * @throws {Error} with a sentence the settings card can show
 */
export async function subscribe(user) {
  // The Android shell asks the OS instead. There is no endpoint to register and
  // no row to store: a local notification is posted by this app on this device,
  // so the permission *is* the subscription.
  if (isNative()) {
    const state = await native.requestPermission()
    if (state !== 'granted') {
      throw new Error(
        state === 'denied'
          ? 'Notifications are blocked for this app. Turn them on in Android Settings › Apps › ' +
            'ToolTrack › Notifications, then try again.'
          : 'Notifications were not allowed.',
      )
    }
    return true
  }

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
  // Nothing to revoke natively: the permission belongs to Android, and only the
  // person can withdraw it from the system settings. Saying so is better than
  // pretending a toggle here did something.
  if (isNative()) return false

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
export async function deliver(notification) {
  // Called with the whole record, or with just its id by anything older.
  const record = typeof notification === 'string' ? { id: notification } : notification
  const notificationId = record?.id
  if (!notificationId) return false

  // In the APK there is no push service to ask: `/api/push` sends Web Push to a
  // service-worker subscription, and this device has neither. The alert is
  // posted here instead, by the app, on this device. Only the recipient's own
  // device is running this code, so the addressing the server would have done is
  // already correct.
  if (isNative()) {
    return native.show({
      id: notificationId,
      title: record.title ?? 'ToolTrack',
      body: record.message ?? '',
      url: record.link ?? '/notifications',
    })
  }

  try {
    const token = await accessToken()
    if (!token) return false

    const response = await fetch(apiUrl('/api/push'), {
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
