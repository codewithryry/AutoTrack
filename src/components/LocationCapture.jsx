import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Crosshair,
  ExternalLink,
  Flag,
  LocateFixed,
  MapPin,
  ShieldOff,
  Undo2,
} from 'lucide-react'
import { Spinner } from './ui'
import {
  captureLocation,
  formatAccuracy,
  formatCoords,
  GEO_ERROR,
  isApproximate,
  isLocation,
  locationPermissionState,
  mapUrl,
} from '../utils/geo'
import { cx } from '../utils/helpers'
import { formatDateTime } from '../utils/dates'

/* ------------------------------------------------------------------ *
 * Location capture and display
 *
 * Two components, and one idea running through both: a reading is a *point in
 * time*, never a claim about where the tool has been since.
 *
 * `LocationCaptureField` takes one fix, when asked. It never starts on mount,
 * never repeats, and never blocks the form it sits in — a refusal is a state it
 * shows, not an error it throws.
 *
 * `LocationTrail` shows what was stored, labelling each entry with what it
 * actually means and saying plainly that the gaps between them are unknown.
 * ------------------------------------------------------------------ */

/**
 * A single opt-in reading attached to a form.
 *
 * @param {object} props
 * @param {object|null} props.value       the reading, or null for "not captured"
 * @param {(next: object|null) => void} props.onChange
 * @param {string} props.title
 * @param {string} props.description      what this particular point will mean
 * @param {boolean} [props.disabled]
 */
export function LocationCaptureField({ value, onChange, title, description, disabled = false }) {
  const [status, setStatus] = useState('idle') // idle | capturing | failed
  const [failure, setFailure] = useState(null)
  const [permission, setPermission] = useState('unknown')

  // Only to word the button honestly — this reads the permission, it does not
  // request one, so nothing is captured by asking.
  useEffect(() => {
    let alive = true
    locationPermissionState().then((state) => alive && setPermission(state))
    return () => {
      alive = false
    }
  }, [])

  const capture = useCallback(async () => {
    setStatus('capturing')
    setFailure(null)
    try {
      const reading = await captureLocation()
      setStatus('idle')
      onChange(reading)
    } catch (err) {
      setStatus('failed')
      setFailure({ reason: err.reason ?? GEO_ERROR.UNAVAILABLE, message: err.message })
      // The form keeps a null, which is exactly what "not captured" is stored as.
      onChange(null)
    }
  }, [onChange])

  const unsupported = permission === 'unsupported'
  const blocked = permission === 'denied' || failure?.reason === GEO_ERROR.DENIED

  return (
    <div
      className="rounded-xl border p-3.5"
      style={{ background: 'rgb(var(--surface-2))' }}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cx(
            'grid h-8 w-8 shrink-0 place-items-center rounded-[10px]',
            isLocation(value)
              ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
              : blocked || unsupported
                ? 'bg-slate-500/12 text-slate-500'
                : 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
          )}
        >
          {isLocation(value) ? (
            <Check className="h-4 w-4" />
          ) : blocked || unsupported ? (
            <ShieldOff className="h-4 w-4" />
          ) : (
            <Crosshair className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight">{title}</p>
          <p className="subtle mt-0.5 text-xs leading-relaxed">{description}</p>
        </div>
      </div>

      {/* ------------------------------ captured ------------------------------ */}
      {isLocation(value) && (
        <div className="mt-3 rounded-lg border p-3" style={{ background: 'rgb(var(--surface))' }}>
          <p className="mono text-xs font-bold">{formatCoords(value)}</p>
          <p className="subtle mt-1 text-[11px]">
            {formatDateTime(value.capturedAt)} · {formatAccuracy(value)}
          </p>
          {isApproximate(value) && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-medium leading-snug text-orange-600 dark:text-orange-400">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              This fix is approximate. It will be stored with its accuracy so nobody reads it as an
              exact spot.
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={capture}
              className="btn btn-outline btn-sm"
              disabled={disabled || status === 'capturing'}
            >
              <LocateFixed className="h-3.5 w-3.5" />
              Take again
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="btn btn-ghost btn-sm"
              disabled={disabled}
            >
              <Undo2 className="h-3.5 w-3.5" />
              Do not record
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------- capture ------------------------------- */}
      {!isLocation(value) && (
        <div className="mt-3">
          {status === 'failed' && (
            <p className="mb-2 flex items-start gap-1.5 text-xs font-medium leading-snug text-orange-700 dark:text-orange-300">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              {failure.message}
            </p>
          )}
          <button
            type="button"
            onClick={capture}
            className="btn btn-outline btn-sm w-full sm:w-auto"
            disabled={disabled || unsupported || status === 'capturing'}
          >
            {status === 'capturing' ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              <MapPin className="h-3.5 w-3.5" />
            )}
            {status === 'capturing'
              ? 'Getting a location…'
              : status === 'failed'
                ? 'Try again'
                : permission === 'granted'
                  ? 'Use my current location'
                  : 'Allow location and record it'}
          </button>
          <p className="subtle mt-2 text-[11px] leading-relaxed">
            {unsupported
              ? 'This device cannot report a location. The record will show that none was captured.'
              : blocked
                ? 'Location is blocked for this site. You can continue — the record will show that no location was captured.'
                : 'Optional. One reading is taken when you press this, and nothing is tracked before or after it. Leave it and the record will say no location was captured.'}
          </p>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

function LocationRow({ icon: Icon, tone, label, meaning, location }) {
  const url = mapUrl(location)
  return (
    <li className="flex gap-3">
      <span
        className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px]', tone)}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-tight">{label}</p>
        <p className="subtle text-[11px] leading-snug">{meaning}</p>

        {isLocation(location) ? (
          <>
            <p className="mono mt-1.5 break-all text-xs font-semibold">{formatCoords(location)}</p>
            <p className="subtle mt-0.5 text-[11px]">
              {formatDateTime(location.capturedAt)} · {formatAccuracy(location)}
              {location.capturedByName ? ` · by ${location.capturedByName}` : ''}
            </p>
            {isApproximate(location) && (
              <p className="mt-1 text-[11px] font-semibold text-orange-600 dark:text-orange-400">
                Approximate fix — treat the coordinates as a general area.
              </p>
            )}
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="btn btn-outline btn-sm mt-2"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View location
              </a>
            )}
          </>
        ) : (
          <p className="muted mt-1.5 text-xs font-medium">
            Not captured — no location was recorded for this step.
          </p>
        )}
      </div>
    </li>
  )
}

/**
 * The three kinds of point a loan can carry, in the order they happen.
 *
 * The wording is the important part. Each row says what its point means, and the
 * footnote says what none of them mean: the tool's position between two readings
 * was never recorded, because it was never measured.
 */
export function LocationTrail({ transaction, className }) {
  if (!transaction) return null

  const borrow = transaction.borrowLocation ?? null
  const back = transaction.returnLocation ?? null
  const checkpoints = Array.isArray(transaction.locationCheckpoints)
    ? transaction.locationCheckpoints
    : []
  const closed = !!transaction.returnDate

  const nothing = !isLocation(borrow) && !isLocation(back) && checkpoints.length === 0

  return (
    <div className={className}>
      <p className="subtle text-[11px] font-bold uppercase tracking-wider">Recorded locations</p>

      {nothing ? (
        <p className="muted mt-2 text-xs leading-relaxed">
          No locations were recorded for this loan. Capturing one is optional and is only ever done
          when the borrower asks for it, so an older loan — or one where permission was refused —
          simply has none.
        </p>
      ) : (
        <ul className="mt-3 space-y-4">
          <LocationRow
            icon={MapPin}
            tone="bg-blue-500/12 text-blue-600 dark:text-blue-400"
            label="Borrowed here"
            meaning="Where the tool was collected, at the moment the loan opened."
            location={borrow}
          />

          {checkpoints.map((point, index) => (
            <LocationRow
              key={`${point.capturedAt}-${index}`}
              icon={Flag}
              tone="bg-amberline-400/15 text-amberline-700 dark:text-amberline-400"
              label={`Usage checkpoint ${index + 1} of ${checkpoints.length}`}
              meaning={
                point.note
                  ? `Confirmed by the borrower while the tool was out — “${point.note}”`
                  : 'Confirmed by the borrower while the tool was still out.'
              }
              location={point}
            />
          ))}

          {(closed || isLocation(back)) && (
            <LocationRow
              icon={Undo2}
              tone="bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
              label="Returned here"
              meaning="Where the tool was handed back, at the moment the loan closed."
              location={back}
            />
          )}
        </ul>
      )}

      <p className="subtle mt-3 border-t pt-3 text-[11px] leading-relaxed">
        Each entry above is a single reading taken at the timestamp shown. Where the tool was
        between two readings was not measured and is not recorded — the borrower is not tracked.
      </p>
    </div>
  )
}
