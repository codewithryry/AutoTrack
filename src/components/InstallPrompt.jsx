import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { BrandMark } from './Brand'
import { useApp } from '../context/AppContext'
import { isStandalone } from '../utils/pwa'

const DISMISS_KEY = 'stms.install-dismissed'

/**
 * Install banner for the PWA.
 *
 * Chromium fires `beforeinstallprompt`, which we hold onto so the user can
 * install from inside the app. iOS Safari has no such event, so after a couple
 * of visits we show the Add to Home Screen instructions instead — the app is
 * meant to live on a phone in the workshop.
 */
export default function InstallPrompt() {
  const { isAuthenticated } = useApp()
  const [deferred, setDeferred] = useState(null)
  const [visible, setVisible] = useState(false)
  const [iosHint, setIosHint] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === '1') return

    if (isStandalone()) return

    const onPrompt = (event) => {
      event.preventDefault()
      setDeferred(event)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isSafari = /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent)
    if (isIOS && isSafari) {
      const timer = setTimeout(() => {
        setIosHint(true)
        setVisible(true)
      }, 8000)
      return () => {
        clearTimeout(timer)
        window.removeEventListener('beforeinstallprompt', onPrompt)
      }
    }

    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  useEffect(() => {
    const onInstalled = () => setVisible(false)
    window.addEventListener('appinstalled', onInstalled)
    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setVisible(false)
  }

  const install = async () => {
    if (!deferred) return
    deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') setVisible(false)
    else dismiss()
    setDeferred(null)
  }

  if (!visible || !isAuthenticated) return null

  return (
    <div
      className="fixed left-1/2 z-40 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2
                 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))]
                 lg:bottom-4 lg:left-auto lg:right-4 lg:translate-x-0"
      role="complementary"
    >
      <div className="card flex items-start gap-3 p-3.5 shadow-panel animate-slide-up">
        <BrandMark size={40} className="rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Install for workshop use</p>
          <p className="muted mt-0.5 text-xs leading-relaxed">
            {iosHint
              ? 'Tap the Share button, then "Add to Home Screen" to use the scanner offline.'
              : 'Add the tool monitor to this device so it works without internet in the laboratory.'}
          </p>
          {!iosHint && (
            <button type="button" onClick={install} className="btn btn-primary btn-sm mt-2.5">
              <Download className="h-3.5 w-3.5" />
              Install app
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="btn btn-ghost btn-icon -mr-1 -mt-1 shrink-0"
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
