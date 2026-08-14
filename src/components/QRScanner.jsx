import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, CameraOff, Keyboard, RefreshCw, ScanLine, SwitchCamera } from 'lucide-react'
import { Spinner } from './ui'
import { cx } from '../utils/helpers'
import { parseQRPayload } from '../utils/qr'

const REGION_ID = 'stms-qr-region'

const ERRORS = {
  NotAllowedError:
    'Camera access was denied. Allow camera permission in your browser settings, or enter the Tool ID by hand.',
  NotFoundError: 'No camera was found on this device. Enter the Tool ID by hand instead.',
  NotReadableError:
    'The camera is already in use by another application. Close it and try again.',
  OverconstrainedError: 'No camera matched the requested settings. Try switching cameras.',
  SecurityError:
    'Camera access requires a secure connection (HTTPS). Enter the Tool ID by hand instead.',
}

/**
 * Live camera QR scanner with a manual fallback.
 *
 * html5-qrcode owns the video element, so the component keeps a single instance
 * in a ref and tears it down carefully — a scanner left running holds the camera
 * open and blocks the next page that needs it.
 */
export default function QRScanner({ onDetected, disabled = false }) {
  const scannerRef = useRef(null)
  const startedRef = useRef(false)
  const detectedRef = useRef(false)
  // Set by the unmount cleanup. A `start()` still in flight at that point checks
  // this the moment it resolves and shuts the camera down again — see below.
  const goneRef = useRef(false)

  const [state, setState] = useState('idle') // idle | starting | scanning | error
  const [error, setError] = useState(null)
  const [cameras, setCameras] = useState([])
  const [cameraIndex, setCameraIndex] = useState(0)
  const [manual, setManual] = useState(false)
  const [manualId, setManualId] = useState('')
  const [manualError, setManualError] = useState(null)

  /* ------------------------------ teardown ------------------------------ */
  /**
   * Release the camera.
   *
   * `force` exists for the unmount path. The normal guard is `startedRef`, but
   * between `start()` being called and its promise resolving that flag is still
   * false while the camera is already live — so a plain `stop()` during those
   * few hundred milliseconds returned immediately and left the device streaming
   * to a component that no longer existed. The next page that wanted the camera
   * then got `NotReadableError: already in use`. Forcing the teardown asks
   * html5-qrcode to stop whatever state it is in, and throwing because it was
   * not running yet is caught below like any other stop-when-stopped.
   */
  const stop = useCallback(async (force = false) => {
    const scanner = scannerRef.current
    if (!scanner || (!startedRef.current && !force)) return
    startedRef.current = false
    try {
      await scanner.stop()
      await scanner.clear()
    } catch {
      // Stopping an already-stopped scanner is not an error worth surfacing.
    }
  }, [])

  /** Stop from the toolbar button — also returns the panel to its idle state. */
  const stopFromControls = useCallback(async () => {
    await stop()
    setState('idle')
  }, [stop])

  useEffect(
    () => () => {
      goneRef.current = true
      void stop(true)
    },
    [stop],
  )

  /* ------------------------------- start ------------------------------- */
  const start = useCallback(
    async (deviceId) => {
      if (disabled) return
      setState('starting')
      setError(null)
      detectedRef.current = false

      try {
        if (!scannerRef.current) {
          scannerRef.current = new Html5Qrcode(REGION_ID, { verbose: false })
        }
        await stop()

        const config = {
          fps: 12,
          // Square box sized to the viewport, capped so it stays usable on tablets.
          qrbox: (viewWidth, viewHeight) => {
            const edge = Math.floor(Math.min(viewWidth, viewHeight) * 0.72)
            return { width: Math.max(160, Math.min(edge, 320)), height: Math.max(160, Math.min(edge, 320)) }
          },
          aspectRatio: 1,
          disableFlip: false,
        }

        // Prefer the rear camera; a named device wins when the user switches.
        const source = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }

        await scannerRef.current.start(
          source,
          config,
          (decodedText) => {
            // html5-qrcode decodes every frame, so a code held in view would
            // fire repeatedly. Latch on the first read and release the camera.
            if (detectedRef.current) return
            detectedRef.current = true
            stop().finally(() => setState('idle'))
            onDetected(decodedText)
          },
          () => {
            /* per-frame decode misses are normal and intentionally ignored */
          },
        )

        startedRef.current = true

        // The component may have been unmounted while the camera was opening —
        // navigating away from the scan page is the common case. Hand the device
        // straight back rather than leaving it streaming into a detached DOM node.
        if (goneRef.current) {
          await stop(true)
          return
        }

        setState('scanning')

        // Populate the camera list only once the permission has been granted.
        try {
          const devices = await Html5Qrcode.getCameras()
          if (goneRef.current) return
          setCameras(devices ?? [])
        } catch {
          setCameras([])
        }
      } catch (err) {
        console.error('[scanner] start failed', err)
        startedRef.current = false
        if (goneRef.current) return
        const name = err?.name ?? ''
        setError(
          ERRORS[name] ??
            err?.message ??
            'The camera could not be started. Enter the Tool ID by hand instead.',
        )
        setState('error')
        setManual(true)
      }
    },
    [disabled, onDetected, stop],
  )

  const switchCamera = async () => {
    if (cameras.length < 2) return
    const next = (cameraIndex + 1) % cameras.length
    setCameraIndex(next)
    await start(cameras[next].id)
  }

  const submitManual = (event) => {
    event.preventDefault()
    const result = parseQRPayload(manualId)
    if (!result.ok) {
      setManualError(result.error)
      return
    }
    setManualError(null)
    // The canonical id the parser resolved, not the raw keystrokes: typing `14`
    // should look up — and report itself as — `TOOL-00014`.
    onDetected(result.toolId)
  }

  return (
    <div className="space-y-4">
      {/* ------------------------------ viewport ------------------------------ */}
      <div
        data-tour="scan-camera"
        className="relative aspect-square w-full overflow-hidden rounded-xl"
        style={{ background: 'rgb(var(--rail))' }}
      >
        <div id={REGION_ID} className="h-full w-full [&_video]:h-full [&_video]:object-cover" />

        {/* framing overlay */}
        {state === 'scanning' && (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-[14%] rounded-lg">
              <Corner className="left-0 top-0 border-l-4 border-t-4 rounded-tl-lg" />
              <Corner className="right-0 top-0 border-r-4 border-t-4 rounded-tr-lg" />
              <Corner className="bottom-0 left-0 border-b-4 border-l-4 rounded-bl-lg" />
              <Corner className="bottom-0 right-0 border-b-4 border-r-4 rounded-br-lg" />
              <div className="absolute inset-x-2 h-0.5 animate-scan-line rounded-full bg-amberline-400/80 shadow-[0_0_12px_2px_rgba(247,201,72,.5)]" />
            </div>
            <p className="absolute inset-x-0 bottom-3 text-center text-[11px] font-bold uppercase tracking-widest text-white/70">
              Align the tool label inside the frame
            </p>
          </div>
        )}

        {state !== 'scanning' && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            {state === 'starting' ? (
              <div>
                <Spinner className="mx-auto h-7 w-7 text-amberline-400" />
                <p className="mt-3 text-sm font-semibold text-white">Starting camera…</p>
              </div>
            ) : state === 'error' ? (
              <div className="max-w-xs">
                <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-red-500/15">
                  <CameraOff className="h-6 w-6 text-red-400" />
                </span>
                <p className="text-sm font-bold text-white">Camera unavailable</p>
                <p className="mt-1.5 text-xs leading-relaxed text-navy-300">{error}</p>
                <button
                  type="button"
                  onClick={() => start()}
                  className="btn btn-outline btn-sm mt-3"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try again
                </button>
              </div>
            ) : (
              <div className="max-w-xs">
                <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-amberline-400/15">
                  <ScanLine className="h-7 w-7 text-amberline-400" />
                </span>
                <p className="text-sm font-bold text-white">Ready to scan</p>
                <p className="mt-1.5 text-xs leading-relaxed text-navy-300">
                  Point the camera at the QR label on any laboratory tool.
                </p>
                <button
                  type="button"
                  onClick={() => start()}
                  className="btn btn-primary mt-4"
                  disabled={disabled}
                >
                  <Camera className="h-4 w-4" />
                  Start camera
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------ controls ------------------------------ */}
      <div className="flex flex-wrap gap-2">
        {state === 'scanning' && (
          <>
            <button type="button" onClick={stopFromControls} className="btn btn-outline flex-1">
              <CameraOff className="h-4 w-4" />
              Stop camera
            </button>
            {cameras.length > 1 && (
              <button type="button" onClick={switchCamera} className="btn btn-outline">
                <SwitchCamera className="h-4 w-4" />
                <span className="hidden sm:inline">Switch</span>
              </button>
            )}
          </>
        )}
        <button
          type="button"
          data-tour="scan-manual"
          onClick={() => setManual((v) => !v)}
          className={cx('btn btn-outline', state !== 'scanning' && 'flex-1')}
        >
          <Keyboard className="h-4 w-4" />
          {manual ? 'Hide manual entry' : 'Enter Tool ID'}
        </button>
      </div>

      {/* --------------------------- manual fallback --------------------------- */}
      {manual && (
        <form onSubmit={submitManual} className="card p-3.5">
          <label className="label" htmlFor="manual-tool-id">
            Manual Tool ID entry
          </label>
          <div className="flex gap-2">
            <input
              id="manual-tool-id"
              value={manualId}
              onChange={(e) => {
                setManualId(e.target.value)
                setManualError(null)
              }}
              placeholder="TOOL-00014"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck="false"
              className={cx('input mono flex-1', manualError && 'input-error')}
            />
            <button type="submit" className="btn btn-primary shrink-0" disabled={!manualId.trim()}>
              Find
            </button>
          </div>
          {manualError ? (
            <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
              {manualError}
            </p>
          ) : (
            <p className="subtle mt-1.5 text-xs">
              Use this when the label is damaged or the camera is unavailable. The prefix is
              optional — typing <span className="mono">14</span> finds{' '}
              <span className="mono">TOOL-00014</span>.
            </p>
          )}
        </form>
      )}
    </div>
  )
}

function Corner({ className }) {
  return <span className={cx('absolute h-7 w-7 border-amberline-400', className)} />
}
