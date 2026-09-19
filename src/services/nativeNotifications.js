/**
 * Notifications in the Android shell.
 *
 * The web app delivers alerts with Web Push: a service worker holds a
 * subscription, and `api/push.js` sends to it with VAPID. None of that reaches
 * the APK. Android's System WebView implements neither the Push API nor
 * `Notification`, and the native build deliberately ships without a service
 * worker (it would fight Capacitor for the assets), so every piece Web Push
 * needs is absent. That is why Notifications appeared to do nothing here while
 * working in a browser.
 *
 * What replaces it is a *local* notification: the same alert, posted by the app
 * on the device rather than pushed to it by a server. The notification records
 * in `notifications` are unchanged and remain the source of truth — this only
 * decides how one of them is shown on the phone.
 *
 * The honest limit, stated rather than hidden: a local notification is posted by
 * the running app, so it covers alerts raised while the app is open or in the
 * background. Delivery to a fully closed app needs Firebase Cloud Messaging,
 * which needs a Firebase project and a sender in `api/push.js` — neither exists
 * yet. `isRemoteCapable()` below reports that plainly so the UI never promises
 * more than the platform gives.
 */

import { isNative } from '../utils/native'

/** Android needs every notification to belong to a channel it can name. */
const CHANNEL = {
  id: 'tooltrack-alerts',
  name: 'Loan alerts',
  description: 'Approvals, due dates and returns for the tools you have borrowed.',
  importance: 4, // HIGH — shows as a heads-up banner
  visibility: 1, // PUBLIC — readable on the lock screen
}

let channelReady = false

async function plugin() {
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  return LocalNotifications
}

/**
 * Create the channel once.
 *
 * On Android 8 and later a notification posted to a channel that does not exist
 * is dropped without a word — one of the two ways "permission is granted but
 * nothing appears" happens. (The other is the runtime permission below.)
 */
async function ensureChannel(LocalNotifications) {
  if (channelReady) return
  try {
    await LocalNotifications.createChannel(CHANNEL)
    channelReady = true
  } catch (err) {
    // `createChannel` is Android-only; a failure here must not stop a post.
    console.warn('[notify] the channel could not be created', err)
  }
}

/** Whether this build can post a notification at all. */
export const isSupported = () => isNative()

/**
 * Whether an alert can arrive with the app fully closed.
 *
 * False here, and deliberately so: see the note at the top. Kept as a named
 * function so the day FCM is added, one return value changes and the UI follows.
 */
export const isRemoteCapable = () => false

/** `granted` | `denied` | `prompt` | `unsupported` */
export async function permissionState() {
  if (!isNative()) return 'unsupported'
  try {
    const LocalNotifications = await plugin()
    const { display } = await LocalNotifications.checkPermissions()
    if (display === 'prompt-with-rationale') return 'prompt'
    return display ?? 'prompt'
  } catch (err) {
    console.warn('[notify] the permission state could not be read', err)
    return 'unsupported'
  }
}

/**
 * Ask Android for permission to post notifications.
 *
 * Android 13 introduced POST_NOTIFICATIONS as a runtime permission. Without it
 * every notification is discarded silently — the app is not told, which is the
 * failure that looks like nothing happening at all.
 *
 * @returns {Promise<'granted'|'denied'|'prompt'>}
 */
export async function requestPermission() {
  if (!isNative()) return 'unsupported'
  const LocalNotifications = await plugin()

  let { display } = await LocalNotifications.checkPermissions()
  if (display !== 'granted') {
    ;({ display } = await LocalNotifications.requestPermissions())
  }
  if (display === 'granted') await ensureChannel(LocalNotifications)
  return display === 'prompt-with-rationale' ? 'prompt' : display
}

/**
 * Post one notification now.
 *
 * Best-effort by design, like the Web Push path it stands in for: the record is
 * already stored, so a failure here costs the banner and nothing else.
 *
 * @returns {Promise<boolean>} whether it was actually posted
 */
export async function show({ title, body, id, url }) {
  if (!isNative()) return false

  try {
    const LocalNotifications = await plugin()

    // Posting without permission is the silent-drop case; check rather than
    // assume, so a refusal is visible in the console instead of invisible.
    const { display } = await LocalNotifications.checkPermissions()
    if (display !== 'granted') {
      console.info('[notify] not posted — permission is', display)
      return false
    }

    await ensureChannel(LocalNotifications)

    await LocalNotifications.schedule({
      notifications: [
        {
          // An Android notification id must be a 32-bit int. The stored id is a
          // uuid, so it is hashed down to one — stable, so re-posting the same
          // notification replaces its banner rather than stacking a duplicate.
          id: toNotificationId(id),
          channelId: CHANNEL.id,
          title: title || 'ToolTrack',
          body: body || '',
          // Must name a real drawable: Android drops a notification whose small
          // icon cannot be resolved, without telling the app. See
          // `android/app/src/main/res/drawable/ic_stat_tooltrack.xml`.
          smallIcon: 'ic_stat_tooltrack',
          // Carried so the tap handler can route to the right screen.
          extra: { url: url ?? '/notifications' },
        },
      ],
    })
    return true
  } catch (err) {
    console.warn('[notify] the notification could not be posted', err)
    return false
  }
}

/** A uuid (or anything) folded into a stable positive 32-bit integer. */
function toNotificationId(value) {
  const text = String(value ?? Date.now())
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % 2147483647
}

/**
 * Route a tapped notification to the screen it belongs to.
 *
 * Registered once at start-up, beside the deep-link listener, because a tap can
 * arrive before any screen has mounted.
 *
 * @param {(url: string) => void} navigate
 * @returns {() => void} stop listening
 */
export function onNotificationTap(navigate) {
  if (!isNative()) return () => {}

  let removal = null
  let cancelled = false

  plugin()
    .then(async (LocalNotifications) => {
      const listener = await LocalNotifications.addListener(
        'localNotificationActionPerformed',
        (event) => {
          const url = event?.notification?.extra?.url
          if (url) navigate(url)
        },
      )
      if (cancelled) {
        listener.remove()
        return
      }
      removal = () => listener.remove()
    })
    .catch((err) => console.warn('[notify] the tap listener was not registered', err))

  return () => {
    cancelled = true
    removal?.()
  }
}
