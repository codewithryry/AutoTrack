import { AlertTriangle, RefreshCw } from 'lucide-react'
import { BrandMark } from './Brand'
import { APP_NAME, APP_TAGLINE } from '../utils/constants'

/**
 * Shown while the local database opens, seeds and reconciles overdue loans.
 *
 * It also renders the failure state. The boot always resolves to either the
 * application or this error — it can never sit on the loading state, so a
 * technician is never left staring at a spinner.
 */
export default function BootScreen({ error, onRetry, onContinue }) {
  return (
    <div
      className="grid min-h-[100dvh] place-items-center px-6"
      style={{ background: 'rgb(var(--rail))' }}
    >
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex justify-center">
          <BrandMark size={64} />
        </div>

        <h1 className="text-lg font-extrabold text-white">{APP_NAME}</h1>
        <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.25em] text-amberline-400">
          {APP_TAGLINE}
        </p>

        {error ? (
          <div
            className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-left"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-red-200">Unable to start</p>
                <p className="mt-1 break-words text-xs leading-relaxed text-red-200/80">{error}</p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <button type="button" onClick={onRetry} className="btn btn-primary w-full">
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="btn btn-outline flex-1"
                >
                  Reload page
                </button>
                {onContinue && (
                  <button type="button" onClick={onContinue} className="btn btn-ghost flex-1 text-navy-200">
                    Continue anyway
                  </button>
                )}
              </div>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-navy-400">
              If the problem continues, the browser may be blocking local storage. Private
              browsing windows and disabled site data both prevent the laboratory database from
              opening. Continuing without it means records cannot be read or saved on this device.
            </p>
          </div>
        ) : (
          <>
            <div className="mx-auto mt-8 h-1 w-40 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-1/2 animate-[shimmer_1.2s_ease-in-out_infinite] rounded-full bg-amberline-400" />
            </div>
            <p className="mt-4 text-xs text-navy-400">Opening the laboratory database…</p>
          </>
        )}
      </div>
    </div>
  )
}
