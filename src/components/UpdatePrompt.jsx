import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { BrandMark } from './Brand'
import { useApp } from '../context/AppContext'
import { useIsMobile } from '../hooks'
import { getLatestRelease } from '../services/releases'
import { APP_VERSION } from '../utils/constants'
import { cx } from '../utils/helpers'
import { externalLinkProps, isNative, openExternal } from '../utils/native'
import { isNewer } from '../utils/version'

const DISMISS_KEY = 'stms.update-dismissed'

const readDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

const writeDismissed = (version) => {
  try {
    sessionStorage.setItem(DISMISS_KEY, version)
  } catch {
    // Storage unavailable: the prompt simply stays dismissed for this mount.
  }
}

/**
 * Update notice, shown on its own once a newer release is published.
 *
 * It asks the same release service Settings → App updates uses, once per sign
 * in, and stays silent on any failure. The notice is non-modal and never takes
 * focus, so a form or checkout in progress is left exactly as it was. "Later"
 * hides it for the rest of the session.
 */
export default function UpdatePrompt() {
  const { isAuthenticated } = useApp()
  const isMobile = useIsMobile()
  const [release, setRelease] = useState(null)

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    getLatestRelease()
      .then((latest) => {
        if (cancelled) return
        if (!isNewer(APP_VERSION, latest.version)) return
        if (readDismissed() === latest.version) return
        setRelease(latest)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  const later = () => {
    writeDismissed(release.version)
    setRelease(null)
  }

  /**
   * The APK is updated by installing the new release, so it opens the release
   * page exactly as Settings does. The web build picks the new version up from
   * its service worker, which updates itself on the next load.
   */
  const updateNow = async () => {
    writeDismissed(release.version)
    if (isNative()) {
      await openExternal(release.htmlUrl)
      setRelease(null)
      return
    }
    try {
      const registration = await navigator.serviceWorker?.getRegistration()
      await registration?.update()
    } catch {
      // A failed check still reloads; the worker retries on the next load.
    }
    window.location.reload()
  }

  if (!release || !isAuthenticated) return null

  return (
    <div
      className={
        isMobile
          ? 'fixed inset-x-0 bottom-[calc(6.5rem+env(safe-area-inset-bottom,0px))] z-40 px-3'
          : 'fixed right-4 top-4 z-40 w-[min(24rem,calc(100vw-2rem))]'
      }
      role="status"
      aria-live="polite"
    >
      <div
        className={cx(
          'card p-3.5 shadow-panel animate-slide-up',
          isMobile && 'mx-auto w-full max-w-md p-4',
        )}
      >
        <div className="flex items-start gap-3">
          <BrandMark size={40} className="shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">New update available</p>
            <p className="subtle mt-0.5 font-mono text-xs">Version v{release.version}</p>
          </div>
          <button
            type="button"
            onClick={later}
            className="btn btn-ghost btn-icon -mr-1 -mt-1 shrink-0"
            aria-label="Dismiss update notice"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={updateNow} className="btn btn-primary btn-sm">
            <Download className="h-3.5 w-3.5" />
            Update now
          </button>
          <button type="button" onClick={later} className="btn btn-outline btn-sm">
            Later
          </button>
          {isMobile && (
            <a
              href={release.htmlUrl}
              target="_blank"
              rel="noreferrer noopener"
              {...externalLinkProps(release.htmlUrl)}
              className="btn btn-ghost btn-sm ml-auto"
            >
              What’s new
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
