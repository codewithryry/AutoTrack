/**
 * Deep links back into the Android app.
 *
 * A link that Supabase sends by email — a password reset, an email
 * confirmation, and any redirect-based sign-in added later — leaves the app and
 * comes back. In a browser tab it comes back to the same tab and there is
 * nothing to do. In the APK it comes back as an intent on this app's own scheme,
 * `ph.edu.autolab.tooltrack://auth/callback`, and unless something is listening
 * for it the person is left sitting in the browser with the app none the wiser.
 *
 * This is that listener. It is registered once, at start-up — *before* anything
 * can begin a flow that leaves the app — because the intent can arrive before
 * any screen has mounted, and a listener attached afterwards never sees it.
 *
 * Turning the returned URL into a session is a credential operation, so it is
 * `localAuth.completeAuthFromUrl` that does it; this module only decides when.
 * That keeps the Supabase client behind the auth layer, where the rest of the
 * application already expects it to stay.
 *
 * Nothing here runs in the browser build: `registerDeepLinks` returns a no-op
 * off-native, so the ordinary web callback is exactly as it was.
 */

import { completeAuthFromUrl } from './localAuth'
import { APP_SCHEME, NATIVE_REDIRECT_URL, isNative } from '../utils/native'

export { APP_SCHEME, NATIVE_REDIRECT_URL }

/**
 * Start listening for callbacks into the native app.
 *
 * Call once, as early as possible. Returns a function that stops listening.
 */
export function registerDeepLinks() {
  if (!isNative()) return () => {}

  let removal = null
  let cancelled = false

  const handle = async (url) => {
    // Only this app's own scheme. Anything else was not addressed to us.
    if (!url || !url.startsWith(`${APP_SCHEME}://`)) return

    const signedIn = await completeAuthFromUrl(url)

    // The browser that handled the link is still on screen over the app. Close
    // it so the person lands back where they started, session or not.
    try {
      const { Browser } = await import('@capacitor/browser')
      await Browser.close()
    } catch {
      // No in-app browser was open — the system one closes itself.
    }

    if (signedIn) {
      // The session is stored, so `onAuthChange` has already fired and the route
      // guards follow it. Nothing to navigate by hand.
      console.info('[deeplink] the session was restored from the callback')
    }
  }

  const start = async () => {
    try {
      const { App } = await import('@capacitor/app')

      const listener = await App.addListener('appUrlOpen', ({ url }) => {
        handle(url).catch((err) => console.warn('[deeplink] callback failed', err))
      })
      if (cancelled) {
        listener.remove()
        return
      }
      removal = () => listener.remove()

      // An intent that launched the app from cold is waiting to be read rather
      // than announced, so it is fetched explicitly as well as subscribed to.
      const launch = await App.getLaunchUrl()
      if (launch?.url) await handle(launch.url)
    } catch (err) {
      console.warn('[deeplink] listener not registered', err)
    }
  }

  start()

  return () => {
    cancelled = true
    removal?.()
  }
}
