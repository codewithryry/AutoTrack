import { useEffect, useState } from 'react'
import { Bell, Camera, Copy, Download, MapPin, Share2, Smartphone } from 'lucide-react'
import { Badge, SectionCard } from './ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import * as pushService from '../services/push'
import { isStandalone } from '../utils/pwa'

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

/** Reads one permission and keeps it current while the page is open. */
function usePermissionState(name, supported) {
  const [state, setState] = useState(supported ? 'unknown' : 'unsupported')

  useEffect(() => {
    if (!supported) return
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

  const secure = secureContext()
  const locationSupported =
    secure && typeof navigator !== 'undefined' && 'geolocation' in navigator
  const cameraSupported =
    secure && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  const [location, setLocation] = usePermissionState('geolocation', locationSupported)
  const [camera, setCamera] = usePermissionState('camera', cameraSupported)
  const [busy, setBusy] = useState(null)

  const askLocation = async () => {
    setBusy('location')
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
        toast.info('Camera access is blocked. Allow it from your browser’s site settings.')
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
            ? 'Needed to scan a tool’s QR label from the Scan page.'
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
  const [state, setState] = useState('unknown')
  const [busy, setBusy] = useState(false)

  const available = pushService.isAvailable()

  useEffect(() => {
    let active = true
    if (!pushService.isSupported()) {
      setState('unsupported')
      return
    }
    pushService.isSubscribed().then((on) => {
      if (!active) return
      // `granted` on this device but not subscribed is still something to
      // switch on, so the row reports the subscription, not just the permission.
      setState(on ? 'granted' : pushService.permissionState() === 'denied' ? 'denied' : 'prompt')
    })
    return () => {
      active = false
    }
  }, [])

  const enable = async () => {
    setBusy(true)
    try {
      await pushService.subscribe(user)
      setState('granted')
      toast.success('Notifications are on for this device.')
    } catch (err) {
      if (pushService.permissionState() === 'denied') setState('denied')
      toast.info(err.message ?? 'Notifications could not be turned on.')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      await pushService.unsubscribe()
      setState('prompt')
      toast.info('Notifications are off for this device.')
    } catch (err) {
      toast.info(err.message ?? 'Notifications could not be turned off.')
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
      stateLabel={available && state === 'granted' ? 'On' : undefined}
      action={
        available &&
        state !== 'denied' &&
        state !== 'unknown' && (
          <button
            type="button"
            onClick={state === 'granted' ? disable : enable}
            className="btn btn-outline btn-sm shrink-0"
            disabled={busy}
          >
            {state === 'granted' ? 'Turn off' : 'Enable'}
          </button>
        )
      }
    />
  )
}

/**
 * The install card, shown to every role as its own section under Device and
 * app. It holds the deferred `beforeinstallprompt` event the browser handed
 * over, so a dismissed install banner can still be completed from here — and
 * when the browser never offered one (iOS Safari has no such event), it keeps
 * the option alive with hand-done instructions instead of disappearing.
 */
export function InstallAppCard() {
  const toast = useToast()
  const [installed, setInstalled] = useState(isStandalone())
  const [deferred, setDeferred] = useState(null)

  // The address this copy of the app is served from — the same source
  // `localAuth` uses for its reset link, so there is no second URL to keep in
  // step with the deployment.
  const appUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/`
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault()
      setDeferred(event)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = async () => {
    if (!deferred) return
    deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') setInstalled(true)
    setDeferred(null)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(appUrl)
      toast.success('App link copied.')
    } catch {
      // No clipboard permission, or a page served over plain http.
      toast.error('The link could not be copied. Copy it from the address bar.')
    }
  }

  /** Hand the app's address to the device's own share sheet, or copy it. */
  const share = async () => {
    if (!canShare) return copyLink()
    try {
      await navigator.share({ title: 'ToolTrack AutoLab', url: appUrl })
    } catch (err) {
      // Dismissing the sheet is a choice, not a failure.
      if (err?.name !== 'AbortError') await copyLink()
    }
  }

  // iOS Safari never fires `beforeinstallprompt`, so the install has to be done
  // by hand there — the instructions below are that fallback, and they keep the
  // option available to students, instructors and administrators alike even when
  // the install popup never appears.
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)

  return (
    <SectionCard title="Install app" description="Running this app from your home screen">
      {installed ? (
        <AccessRow
          icon={Smartphone}
          title="This device"
          description="Runs full screen from your home screen, and keeps working offline."
          state="granted"
          stateLabel="Installed"
        />
      ) : deferred ? (
        <AccessRow
          icon={Smartphone}
          title="This device"
          description="Runs full screen from your home screen, and keeps working offline."
          state="prompt"
          stateLabel="Available"
        />
      ) : (
        <>
          <AccessRow
            icon={Smartphone}
            title="Add to your home screen"
            description="Run this app full screen from your home screen, and keep working offline."
            state="prompt"
            stateLabel="Not installed"
          />
          <div
            className="mt-3 rounded-lg border px-3.5 py-3"
            style={{ background: 'rgb(var(--surface-2))' }}
          >
            <p className="text-xs font-bold">
              {isIOS ? 'Install from Safari' : 'Install from the browser menu'}
            </p>
            <ol className="subtle mt-1.5 space-y-1 text-xs leading-relaxed">
              {isIOS ? (
                <>
                  <li>1. Tap the <strong>Share</strong> button in the browser bar.</li>
                  <li>2. Choose <strong>Add to Home Screen</strong>.</li>
                  <li>3. Tap <strong>Add</strong>.</li>
                </>
              ) : (
                <>
                  <li>1. Open the browser menu — the three dots (⋮).</li>
                  <li>2. Choose <strong>Add to Home Screen</strong> or <strong>Install app</strong>.</li>
                  <li>3. Confirm the install, then open it from your home screen.</li>
                </>
              )}
            </ol>
          </div>
        </>
      )}

      {/* Both actions in one row, full width on a phone and side by side from
          `sm`. Install only appears while the browser is actually offering it —
          the instructions above are the fallback when it is not. */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {deferred && !installed && (
          <button type="button" onClick={install} className="btn btn-primary flex-1">
            <Download className="h-4 w-4" />
            Install app
          </button>
        )}
        <button type="button" onClick={share} className="btn btn-outline flex-1">
          {canShare ? <Share2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {canShare ? 'Share app' : 'Copy link'}
        </button>
      </div>
    </SectionCard>
  )
}
