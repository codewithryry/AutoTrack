import { useEffect, useState } from 'react'
import { Bell, Camera, MapPin } from 'lucide-react'
import { Badge } from './ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import * as pushService from '../services/push'
import * as nativePermissions from '../services/nativePermissions'
import { isNative } from '../utils/native'

/**
 * Device access and installation, in one place.
 *
 * The scanner needs the camera and a borrow record can carry a location, so a
 * student needs somewhere to see whether the browser has granted either — and a
 * way to ask again. Nothing here changes what the features do; it only reports
 * the browser's own permission state and re-triggers its prompt.
 */

const STATE_STYLES = {
  granted:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  denied:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
}

const STATE_LABELS = {
  granted: 'Allowed',
  denied: 'Blocked',
  prompt: 'Not set',
  unsupported: 'Unavailable',
  unknown: 'Unknown',
}

/**
 * Both permissions are secure-context features: served over plain http (a LAN
 * address during development, say) the browser refuses the camera outright and
 * never answers a location request, whatever the app does. Saying so is the
 * difference between a control that looks broken and one that explains itself.
 */
const secureContext = () => typeof window === 'undefined' || window.isSecureContext

/**
 * Which native reader answers for each permission, by its Permissions API name.
 * Absent from this map means there is no native equivalent and the browser path
 * is the only one.
 */
const NATIVE_READERS = {
  geolocation: nativePermissions.locationState,
  camera: nativePermissions.cameraState,
  notifications: nativePermissions.notificationState,
}

/**
 * Reads one permission and keeps it current while the page is open.
 *
 * Two entirely separate implementations behind one hook:
 *
 *   • In a browser, the Permissions API, with its `change` event — unchanged.
 *   • In the Android shell, the OS itself, re-read every time the app resumes.
 *
 * The native half exists because `navigator.permissions` inside the WebView
 * answers for the page rather than the app: it reports a state Android may never
 * have been asked for, and it does not change when somebody grants or revokes a
 * permission in Android Settings. Re-reading on resume is what makes leaving for
 * Settings and coming back show the truth.
 *
 * Nothing is persisted on either path. A remount re-reads rather than restoring
 * a remembered answer, so the WebView being recreated cannot strand the UI on a
 * stale state.
 */
function usePermissionState(name, supported) {
  const [state, setState] = useState(supported ? 'unknown' : 'unsupported')

  useEffect(() => {
    if (!supported) return undefined

    const readNative = NATIVE_READERS[name]

    if (isNative() && readNative) {
      let alive = true
      // `unknown` while the first read is in flight, never a guess: a default of
      // `denied` would flash Blocked on every open for a permission that is in
      // fact granted.
      const sync = () => {
        readNative()
          .then((value) => alive && setState(value))
          .catch(() => alive && setState('unknown'))
      }

      sync()
      // The fix for the reported bug: re-read when the app comes back, so a
      // change made in Android Settings is picked up on return.
      const stop = nativePermissions.onResume(sync)

      return () => {
        alive = false
        stop()
      }
    }

    let status
    const sync = () => setState(status.state)
    navigator.permissions
      ?.query({ name })
      .then((result) => {
        status = result
        sync()
        result.addEventListener('change', sync)
      })
      // Safari has no Permissions API for the camera; the control still works,
      // it simply cannot say what the answer will be until it is asked.
      .catch(() => setState('unknown'))
    return () => status?.removeEventListener('change', sync)
  }, [name, supported])

  return [state, setState]
}

function AccessRow({ icon: Icon, title, description, state, stateLabel, action }) {
  return (
    // One row at every width: the icon, then the name beside it with its
    // description under, then the state badge on the right — level with the icon
    // rather than tucked in beside the name, so Allowed / Blocked / Unavailable
    // read down one column for both permissions.
    <div className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0 sm:gap-4">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
        style={{ background: 'rgb(var(--surface-3))' }}
      >
        <Icon className="h-4 w-4" style={{ color: 'rgb(var(--text-subtle))' }} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{title}</p>
        <p className="subtle mt-0.5 text-xs leading-snug">{description}</p>
      </div>
      {/* Badge then action on one line, so "Blocked · Enable" reads across
          rather than stacking and pushing the row taller than the icon. */}
      <div className="flex shrink-0 items-center gap-2">
        <Badge className={STATE_STYLES[state]}>
          {stateLabel ?? STATE_LABELS[state] ?? STATE_LABELS.unknown}
        </Badge>
        {action}
      </div>
    </div>
  )
}

export function DeviceAccessControl() {
  const toast = useToast()

  // The secure-context rule is a browser one. The native shell serves the app
  // from its own origin and asks Android for these permissions directly, so
  // gating on it there would report both as Unavailable in a perfectly capable
  // APK.
  const secure = isNative() || secureContext()
  const locationSupported =
    secure && typeof navigator !== 'undefined' && 'geolocation' in navigator
  const cameraSupported =
    secure && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  const [location, setLocation] = usePermissionState('geolocation', locationSupported)
  const [camera, setCamera] = usePermissionState('camera', cameraSupported)
  const [busy, setBusy] = useState(null)

  const askLocation = async () => {
    setBusy('location')

    // Android shows its own dialog, and only when the plugin asks for it. Going
    // through `getCurrentPosition` here would wait on a permission nothing had
    // requested, which is why Enable appeared to do nothing in the APK.
    if (isNative()) {
      try {
        const result = await nativePermissions.requestLocation()
        setLocation(result)
        if (result === 'granted') {
          toast.success('Location is allowed. Borrow and return records can carry a reading.')
        } else if (result === 'denied') {
          toast.info(
            'Location is blocked for this app. Turn it on in Android Settings › Apps › ' +
              'ToolTrack › Permissions, then come back.',
          )
        } else {
          toast.info('Location was not allowed.')
        }
      } finally {
        setBusy(null)
      }
      return
    }

    // One attempt in a promise so the fallback below can retry on the same
    // click rather than making the person press Enable twice.
    const getFix = (options) =>
      new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, options),
      )
    try {
      // High accuracy first; if this device cannot fix that way — common
      // indoors and on desktops with no GPS — retry with the default so the
      // permission is granted by a fix this device can actually produce.
      // Without that, the browser never registers the grant and Location stays
      // out of the site's permission list while the camera is already there.
      let position
      try {
        position = await getFix({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
      } catch (first) {
        // Code 1 is a refusal — retrying cannot help, so surface it directly.
        if (first?.code === 1) throw first
        position = await getFix({ enableHighAccuracy: false, timeout: 15000, maximumAge: 0 })
      }
      if (!position?.coords) throw { code: 2 }
      setLocation('granted')
      toast.success('Location is allowed. Borrow and return records can carry a reading.')
    } catch (error) {
      // Code 1 is a refusal; anything else — no fix, a timeout — leaves the
      // permission exactly as it was rather than reporting it as blocked.
      if (error?.code === 1) {
        setLocation('denied')
        // A block that never reached the address bar's site settings is usually
        // the device or browser refusing location outright (Location services
        // switched off), so name that too — the site settings alone will not
        // have an entry to fix.
        toast.warning(
          'Location is blocked. Turn on Location services on this device, allow Location for this site from the address bar’s site settings, then press Enable again.',
        )
      } else {
        toast.info('No location fix was available. Try again outdoors or nearer a window.')
      }
    } finally {
      setBusy(null)
    }
  }

  const askCamera = async () => {
    setBusy('camera')

    // Android's own dialog, through the plugin. `getUserMedia` below is the web
    // path: in the WebView it only reaches Android when the shell decides to
    // forward it, so asking the OS directly is what makes Enable work here.
    if (isNative()) {
      try {
        const result = await nativePermissions.requestCamera()
        setCamera(result)
        if (result === 'granted') {
          toast.success('Camera is allowed. The Scan page can read QR labels.')
        } else if (result === 'denied') {
          toast.info(
            'Camera access is blocked. Turn it on in Android Settings › Apps › ' +
              'ToolTrack › Permissions, then come back.',
          )
        } else {
          toast.info('Camera access was not allowed.')
        }
      } finally {
        setBusy(null)
      }
      return
    }

    try {
      // Asked for the back camera, the one the scanner uses, then handed
      // straight back — the permission is what this control is after, not a
      // stream.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      stream.getTracks().forEach((track) => track.stop())
      setCamera('granted')
      toast.success('Camera is allowed. The Scan page can read QR labels.')
    } catch (err) {
      if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
        toast.info('No camera was found on this device. Enter the Tool ID by hand on Scan.')
      } else if (err?.name === 'NotReadableError') {
        toast.info('The camera is in use by another app. Close it and try again.')
      } else {
        setCamera('denied')
        // The way back differs by platform, and pointing at the wrong one is
        // worse than saying nothing: there are no site settings in the APK.
        toast.info(
          isNative()
            ? 'Camera access is blocked. Turn it on in Android Settings › Apps › ' +
              'ToolTrack › Permissions, then come back.'
            : 'Camera access is blocked. Allow it from your browser’s site settings.',
        )
      }
    } finally {
      setBusy(null)
    }
  }

  const canAsk = (state) => state !== 'granted' && state !== 'unsupported'

  return (
    <div className="divide-y">
      <AccessRow
        icon={MapPin}
        title="Location"
        description={
          secure
            ? 'Used to record where a tool was taken out or handed back.'
            : 'Needs a secure (https) connection — the browser will not answer over http.'
        }
        state={location}
        stateLabel={secure ? undefined : 'Needs HTTPS'}
        action={
          canAsk(location) && (
            <button
              type="button"
              onClick={askLocation}
              className="btn btn-outline btn-sm shrink-0"
              disabled={busy === 'location'}
            >
              Enable
            </button>
          )
        }
      />
      <AccessRow
        icon={Camera}
        title="Camera"
        description={
          secure
            ? 'Required to scan tool, borrow, and return QR codes from the Scan page.'
            : 'Needs a secure (https) connection — the browser blocks the camera over http.'
        }
        state={camera}
        stateLabel={secure ? undefined : 'Needs HTTPS'}
        action={
          canAsk(camera) && (
            <button
              type="button"
              onClick={askCamera}
              className="btn btn-outline btn-sm shrink-0"
              disabled={busy === 'camera'}
            >
              Enable
            </button>
          )
        }
      />
      <PushNotificationRow />
    </div>
  )
}

/**
 * Phone notifications for this device.
 *
 * A third permission row alongside the camera and location, because that is
 * what it is: the browser's own permission, asked for and reported here. The
 * notification centre inside the app is untouched and keeps working whatever
 * this says — turning it on only adds the alert that arrives when the app is
 * closed.
 */
function PushNotificationRow() {
  const toast = useToast()
  const { user } = useApp()
  const [state, setState] = useState('prompt')
  const [busy, setBusy] = useState(false)

  const available = pushService.isAvailable()

  useEffect(() => {
    if (!available) {
      setState('unsupported')
      return
    }

    let alive = true

    // Exactly what the Camera and Location rows do, and for the same reason.
    //
    // This used to read `pushService.syncPermissionState()`, which answers from
    // a module-level mirror that it refreshes as a side effect. A mirror is a
    // second copy of something Android already knows, and the copy could be
    // stale: the row could report "not set" moments after the person had
    // granted the permission, because nothing had refreshed the mirror in
    // between. `nativePermissions.notificationState()` asks the OS every time,
    // which is the rule the other two rows already follow.
    //
    // This reads the OS *permission*, not whether a Web Push subscription
    // exists. The two are separate: on the web a permission can be granted with
    // no subscription stored, and in the APK there is no subscription at all
    // because the alerts are posted locally. This row reports the permission.
    const sync = () => {
      const read = isNative()
        ? nativePermissions.notificationState()
        : Promise.resolve(pushService.permissionState())

      read
        .then((permission) => {
          if (!alive) return
          setState(
            permission === 'granted' ? 'granted' : permission === 'denied' ? 'denied' : 'prompt',
          )
        })
        .catch(() => alive && setState('prompt'))
    }

    sync()
    // Re-read when the app comes back, so turning notifications on or off in
    // Android Settings is reflected on return rather than showing whatever was
    // true when this row first rendered. Same listener the other two rows use.
    const stop = nativePermissions.onResume(sync)

    return () => {
      alive = false
      stop()
    }
  }, [available])

  const enable = async () => {
    setBusy(true)

    // Android's own dialog, through the plugin — the same shape as the Location
    // and Camera handlers above. The state is taken from what the OS answered
    // rather than assumed from the call having returned, so tapping "Don't
    // allow" shows Blocked instead of silently reading as granted.
    if (isNative()) {
      try {
        const result = await nativePermissions.requestNotifications()
        setState(result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'prompt')
        if (result === 'granted') {
          toast.success('Notifications are on for this device.')
        } else if (result === 'denied') {
          toast.info(
            'Notifications are blocked for this app. Turn them on in Android Settings › Apps › ' +
              'ToolTrack › Notifications, then come back.',
          )
        } else {
          toast.info('Notifications were not allowed.')
        }
      } catch (err) {
        // A failure to ask is not an answer about the permission, so the row is
        // re-read rather than guessed at.
        setState(await nativePermissions.notificationState().catch(() => 'prompt'))
        toast.info(err?.message ?? 'Notifications could not be turned on.')
      } finally {
        setBusy(false)
      }
      return
    }

    try {
      await pushService.subscribe(user)
      setState('granted')
      toast.success('Notifications are on for this device.')
    } catch (err) {
      const permission = await pushService.syncPermissionState().catch(() => 'default')
      if (permission === 'denied') setState('denied')
      else setState('prompt')
      toast.info(err.message ?? 'Notifications could not be turned on.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AccessRow
      icon={Bell}
      title="Notifications"
      description={
        available
          ? 'Alerts about your loans arrive on this device even when the app is closed.'
          : 'This browser cannot deliver alerts while the app is closed. The notification centre inside the app still works.'
      }
      state={available ? state : 'unsupported'}
      // All three permission rows use the same shared labels — `Allowed`,
      // `Blocked`, `Not set` — so Notifications reads exactly like Location
      // and Camera. (The old `On`/`Off` names were dropped for that reason.)
      action={
        available &&
        state !== 'granted' &&
        state !== 'unsupported' && (
          <button
            type="button"
            onClick={enable}
            className="btn btn-outline btn-sm shrink-0"
            disabled={busy}
          >
            Enable
          </button>
        )
      }
    />
  )
}
