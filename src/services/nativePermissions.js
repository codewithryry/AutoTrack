/**
 * The real Android permission state, read from the OS.
 *
 * In the APK `navigator.permissions` answers for the *WebView page*, not for the
 * application: it will happily report `granted` for a permission Android has
 * never been asked for, and it does not change when somebody grants or revokes
 * one in Android Settings. That is why a permission turned on outside the app
 * kept reading as off on the way back in, and why a state once shown could
 * survive a revocation.
 *
 * Everything here asks the OS instead, through the plugin that owns each
 * permission. Nothing is cached, and nothing is stored: the answer is fetched
 * each time it is wanted, so the source of truth is always Android itself rather
 * than anything this app remembered.
 *
 * The browser build never reaches any of it — `isNative()` is false there, and
 * `DeviceAccess` keeps using the Permissions API exactly as before.
 */

import { isNative } from '../utils/native'

/** The vocabulary the UI already speaks. */
const GRANTED = 'granted'
const DENIED = 'denied'
const PROMPT = 'prompt'
const UNKNOWN = 'unknown'

/**
 * Capacitor reports `prompt-with-rationale` for "refused once, will ask again".
 * The UI has no separate state for it and should not: it still means the prompt
 * can be shown, which is what `prompt` means here.
 */
const normalise = (value) => {
  if (value === 'granted') return GRANTED
  if (value === 'denied') return DENIED
  if (value === 'prompt' || value === 'prompt-with-rationale') return PROMPT
  return UNKNOWN
}

/* ------------------------------------------------------------------ *
 * Location
 * ------------------------------------------------------------------ */

export async function locationState() {
  if (!isNative()) return UNKNOWN

  try {
    const { Geolocation } = await import('@capacitor/geolocation')
    return fromLocationStatus(await Geolocation.checkPermissions())
  } catch (err) {
    // The plugin refuses to answer `checkPermissions` at all when the device's
    // location *services* (the GPS toggle) are switched off — it throws
    // "Location services are not enabled" instead of reporting the permission,
    // which is a different thing entirely. Treating that as unknown is what made
    // a granted permission read as off: the grant is still there, the radio is
    // simply turned off.
    //
    // Android's own permission API has no such condition, so it is asked
    // directly through the same plugin's alias-level check.
    const disabled = /not enabled|location services|disabled/i.test(err?.message ?? '')
    if (disabled) {
      const viaPermissions = await locationStateViaPermissionsApi()
      if (viaPermissions !== UNKNOWN) return viaPermissions
    }
    console.warn('[perm] the native location state could not be read', err)
    return UNKNOWN
  }
}

/** The two aliases the plugin declares, folded into one answer. */
function fromLocationStatus(status) {
  // Coarse-only is a grant: a fix is still available, and `isApproximate`
  // already labels a low-accuracy reading wherever it is shown.
  if (status?.location === 'granted' || status?.coarseLocation === 'granted') return GRANTED
  return normalise(status?.location ?? status?.coarseLocation)
}

/**
 * The permission alone, with location services out of the picture.
 *
 * The WebView's Permissions API is the wrong source for most things here, but
 * for geolocation on Android it does reflect the app's own grant — and unlike
 * the plugin it answers whether or not the GPS toggle is on. Used only as the
 * fallback above, never as the primary reader.
 */
async function locationStateViaPermissionsApi() {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' })
    return status ? normalise(status.state) : UNKNOWN
  } catch {
    return UNKNOWN
  }
}

/** Ask Android for location. Returns the state it settled on. */
export async function requestLocation() {
  if (!isNative()) return UNKNOWN
  try {
    const { Geolocation } = await import('@capacitor/geolocation')
    return fromLocationStatus(await Geolocation.requestPermissions({ permissions: ['location'] }))
  } catch (err) {
    // `requestPermissions` refuses for the same reason `checkPermissions` does:
    // location services are off, which is not an answer about the permission.
    // The grant may already be there, so it is read rather than reported as a
    // failed request.
    if (/not enabled|location services|disabled/i.test(err?.message ?? '')) {
      const current = await locationStateViaPermissionsApi()
      if (current !== UNKNOWN) return current
    }
    console.warn('[perm] the native location request failed', err)
    return UNKNOWN
  }
}

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */

export async function notificationState() {
  if (!isNative()) return UNKNOWN
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const { display } = await LocalNotifications.checkPermissions()
    return normalise(display)
  } catch (err) {
    console.warn('[perm] the native notification state could not be read', err)
    return UNKNOWN
  }
}

export async function requestNotifications() {
  if (!isNative()) return UNKNOWN
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    let { display } = await LocalNotifications.checkPermissions()
    if (display !== 'granted') ({ display } = await LocalNotifications.requestPermissions())
    return normalise(display)
  } catch (err) {
    console.warn('[perm] the native notification request failed', err)
    return UNKNOWN
  }
}

/* ------------------------------------------------------------------ *
 * Camera
 * ------------------------------------------------------------------ */

/**
 * Android's own CAMERA grant, read without touching the camera.
 *
 * An earlier version answered this by opening a video stream and closing it
 * again, on the reasoning that the scanner uses `getUserMedia` so the same call
 * was the honest test. That was wrong for the case that matters: on resume there
 * is no user gesture, and the WebView may refuse a `getUserMedia` on the app's
 * behalf without ever asking Android — which reported Blocked for a permission
 * Android had granted, and is the reason an enabled camera kept reverting.
 *
 * The plugin asks the OS directly. No stream is opened, no gesture is needed,
 * and the camera indicator never lights up just to read a status.
 */
export async function cameraState() {
  if (!isNative()) return UNKNOWN
  try {
    const { Camera } = await import('@capacitor/camera')
    const status = await Camera.checkPermissions()
    // Only the camera itself. `photos` is the gallery permission, which this app
    // does not use and which would otherwise drag the answer down with it.
    return normalise(status?.camera)
  } catch (err) {
    console.warn('[perm] the native camera state could not be read', err)
    return UNKNOWN
  }
}

/**
 * Ask Android for the camera.
 *
 * Deliberately the plugin rather than `getUserMedia`: the WebView only forwards
 * a `getUserMedia` call to Android's dialog when it decides to, and outside a
 * user gesture it can refuse on the app's behalf without asking anybody. The
 * plugin asks Android directly, every time.
 */
export async function requestCamera() {
  if (!isNative()) return UNKNOWN
  try {
    const { Camera } = await import('@capacitor/camera')
    let status = await Camera.checkPermissions()
    if (status?.camera !== 'granted') {
      status = await Camera.requestPermissions({ permissions: ['camera'] })
    }
    return normalise(status?.camera)
  } catch (err) {
    console.warn('[perm] the native camera request failed', err)
    return UNKNOWN
  }
}

/* ------------------------------------------------------------------ *
 * Resume
 * ------------------------------------------------------------------ */

/**
 * Run `callback` whenever the app comes back to the foreground.
 *
 * This is what fixes the reported behaviour: somebody leaves for Android
 * Settings, changes a permission, and comes back — at which point the app has to
 * ask the OS again, because nothing tells it what changed while it was away.
 *
 * Two sources, because neither alone is enough. Capacitor's `appStateChange`
 * fires when the *app* is resumed; `visibilitychange` fires when the WebView is
 * shown again, which also covers returning from an in-app browser tab. Both are
 * harmless to receive twice — the callback only re-reads state.
 *
 * @returns {() => void} stop listening
 */
export function onResume(callback) {
  if (!isNative()) return () => {}

  let cancelled = false
  let removeApp = null

  const onVisible = () => {
    if (document.visibilityState === 'visible') callback()
  }
  document.addEventListener('visibilitychange', onVisible)

  import('@capacitor/app')
    .then(async ({ App }) => {
      const listener = await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) callback()
      })
      if (cancelled) {
        listener.remove()
        return
      }
      removeApp = () => listener.remove()
    })
    .catch((err) => console.warn('[perm] the resume listener was not registered', err))

  return () => {
    cancelled = true
    document.removeEventListener('visibilitychange', onVisible)
    removeApp?.()
  }
}
