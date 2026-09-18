import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { isNative } from '../utils/native'

/**
 * The Android hardware/gesture back button.
 *
 * Capacitor's default is to close the app on every back press, which inside a
 * single-page app means backing out of the whole thing from a detail screen.
 * This gives it the meaning it has in the browser — go back one route — and
 * keeps the exit for the point where there is nothing left to go back to.
 *
 * A no-op in a browser build, where the back button is the browser's own.
 */
export function useAndroidBack() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isNative()) return undefined

    let removal = null
    let cancelled = false

    import('@capacitor/app')
      .then(async ({ App }) => {
        const listener = await App.addListener('backButton', ({ canGoBack }) => {
          // `canGoBack` reflects the WebView's own history, which is what React
          // Router pushes to — so it is the right question to ask.
          if (canGoBack) navigate(-1)
          else App.exitApp()
        })
        if (cancelled) {
          listener.remove()
          return
        }
        removal = () => listener.remove()
      })
      .catch((err) => console.warn('[native] back button not registered', err))

    return () => {
      cancelled = true
      removal?.()
    }
  }, [navigate])
}
