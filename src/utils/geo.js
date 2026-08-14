/**
 * One-shot location readings.
 *
 * Every function here takes a single fix and stops. There is deliberately no
 * `watchPosition`, no interval, no service-worker hook and no state that
 * survives the call — the browser's location indicator goes out as soon as the
 * promise settles. A reading only ever happens because the person using the app
 * pressed something that says it will happen.
 *
 * That is also why the shape below carries `capturedAt`: a point is meaningful
 * *at a timestamp*, and the screens that show one always show the two together.
 * Nothing in this file, and nothing that stores its output, describes where a
 * tool was between two readings.
 */

/** Why a reading could not be taken. The UI maps these to its own copy. */
export const GEO_ERROR = {
  UNSUPPORTED: 'unsupported',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
  TIMEOUT: 'timeout',
}

export class GeolocationCaptureError extends Error {
  constructor(reason, message) {
    super(message)
    this.name = 'GeolocationCaptureError'
    this.reason = reason
  }
}

const MESSAGES = {
  [GEO_ERROR.UNSUPPORTED]: 'This device or browser cannot report a location.',
  [GEO_ERROR.DENIED]:
    'Location permission was refused. You can still continue — the location simply will not be recorded.',
  [GEO_ERROR.UNAVAILABLE]:
    'No location fix was available. Move somewhere with a clearer view of the sky and try again.',
  [GEO_ERROR.TIMEOUT]: 'Getting a location took too long. Try again, or continue without it.',
}

export const geoErrorMessage = (reason) => MESSAGES[reason] ?? MESSAGES[GEO_ERROR.UNAVAILABLE]

/**
 * Readings less precise than this are still stored — throwing away a 200m fix
 * would be worse than recording it honestly — but they are labelled as
 * approximate everywhere they appear, so nobody reads a town-sized circle as a
 * bench in the workshop.
 */
export const ACCURACY_WARN_METRES = 50

export const isApproximate = (location) =>
  Number.isFinite(location?.accuracy) && location.accuracy > ACCURACY_WARN_METRES

/**
 * Take one reading.
 *
 * Resolves with `{ lat, lng, accuracy, capturedAt }`, or rejects with a
 * `GeolocationCaptureError` carrying one of `GEO_ERROR`. Callers are expected to
 * treat a rejection as "carry on without a location", never as a failed
 * borrow or return.
 *
 * @param {{ timeoutMs?: number, maximumAgeMs?: number }} [options]
 */
export function captureLocation({ timeoutMs = 15000, maximumAgeMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeolocationCaptureError(GEO_ERROR.UNSUPPORTED, MESSAGES[GEO_ERROR.UNSUPPORTED]))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          reject(
            new GeolocationCaptureError(
              GEO_ERROR.UNAVAILABLE,
              MESSAGES[GEO_ERROR.UNAVAILABLE],
            ),
          )
          return
        }
        resolve({
          lat: round(latitude),
          lng: round(longitude),
          // Metres, as the browser reports it. Kept so a reading can be shown
          // with its real precision instead of implying a pinpoint.
          accuracy: Number.isFinite(accuracy) ? Math.round(accuracy * 10) / 10 : null,
          // The browser's own timestamp for the fix, not "now": a cached fix is
          // older than the button press that asked for it.
          capturedAt: new Date(position.timestamp ?? Date.now()).toISOString(),
        })
      },
      (error) => {
        const reason =
          error?.code === 1
            ? GEO_ERROR.DENIED
            : error?.code === 3
              ? GEO_ERROR.TIMEOUT
              : GEO_ERROR.UNAVAILABLE
        reject(new GeolocationCaptureError(reason, MESSAGES[reason]))
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: maximumAgeMs },
    )
  })
}

/** Six decimal places — about 0.1m, far finer than any consumer GPS fix. */
const round = (value) => Math.round(value * 1e6) / 1e6

/**
 * Whether the browser will prompt, refuse, or answer straight away.
 *
 * Purely informational — used to explain in advance what pressing the button
 * will do. The Permissions API is not available everywhere, so `unknown` is a
 * normal answer and never blocks anything.
 */
export async function locationPermissionState() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported'
  if (!navigator.permissions?.query) return 'unknown'
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    return status.state // 'granted' | 'prompt' | 'denied'
  } catch {
    return 'unknown'
  }
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

export function formatCoords(location) {
  if (!isLocation(location)) return '—'
  return `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`
}

export function formatAccuracy(location) {
  if (!Number.isFinite(location?.accuracy)) return 'accuracy unknown'
  return location.accuracy >= 1000
    ? `±${(location.accuracy / 1000).toFixed(1)} km`
    : `±${Math.round(location.accuracy)} m`
}

export const isLocation = (value) =>
  !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng)

/**
 * A link to the point on a map.
 *
 * OpenStreetMap, and an ordinary `href` the user chooses to follow — the app
 * itself never contacts a mapping service, so no coordinate leaves the device
 * unless somebody clicks through.
 */
export function mapUrl(location) {
  if (!isLocation(location)) return null
  const { lat, lng } = location
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`
}
