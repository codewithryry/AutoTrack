/**
 * The native shell — Capacitor — and the few places the app has to behave
 * differently inside it.
 *
 * In a browser tab the app is served from its own origin, so a relative
 * `/api/...` and a `target="_blank"` link both mean what they say. Inside the
 * Android WebView neither does: the page is served from `https://localhost`,
 * which is the shell's own origin and not the deployment, and a new window has
 * nowhere to open. Every such difference is resolved here rather than at each
 * call site, so the web build is untouched by any of it.
 *
 * Capacitor is loaded lazily and every entry point degrades to the plain web
 * behaviour, so importing this module from a browser build costs nothing and
 * the static verification suites — which run under Node — can still import the
 * graph.
 */

/**
 * This app's private URL scheme.
 *
 * Must match the Android intent-filter in
 * `android/app/src/main/AndroidManifest.xml` and the redirect URL allow-list in
 * Supabase → Authentication → URL Configuration. It lives here, with no service
 * imports of its own, so both the auth layer and the deep-link listener can read
 * it without importing each other.
 */
export const APP_SCHEME = 'ph.edu.autolab.tooltrack'

/** The one redirect URL the native build asks Supabase to come back to. */
export const NATIVE_REDIRECT_URL = `${APP_SCHEME}://auth/callback`

/** True only inside the Capacitor native shell (the Android APK). */
export const isNative = () => {
  if (typeof window === 'undefined') return false
  const cap = window.Capacitor
  return !!cap?.isNativePlatform?.()
}

/**
 * The origin the deployed web app is served from.
 *
 * In the browser that is wherever the page came from. In the APK there is no
 * such origin — the WebView's own is `https://localhost` — so the deployment is
 * named at build time. Anything that has to reach the app's own serverless
 * endpoints goes through here.
 */
export const webOrigin = () => {
  const configured = import.meta.env?.VITE_PUBLIC_APP_URL
  if (configured) return String(configured).replace(/\/+$/, '')
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

/**
 * Resolve an app-relative path against the origin that can actually serve it.
 *
 * `/api/push` is correct in a tab and meaningless in the WebView; this turns it
 * into an absolute URL there and leaves it exactly as it was in the browser.
 */
export function apiUrl(path) {
  if (!isNative()) return path
  const origin = webOrigin()
  if (!origin) return path
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Open an external URL the way the current platform can.
 *
 * In the WebView a `target="_blank"` anchor does nothing at all — which is what
 * makes an external link look broken in the APK. Capacitor's Browser plugin
 * hands it to an in-app Custom Tab instead, which the system back gesture
 * closes back into the app.
 *
 * @returns {Promise<boolean>} whether this took the link; false leaves the
 *   caller's own default (the anchor's normal behaviour) in place.
 */
export async function openExternal(url) {
  if (!url || !isNative()) return false
  try {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url })
    return true
  } catch (err) {
    console.warn('[native] the link could not be opened', err)
    return false
  }
}

/**
 * An anchor's onClick for a link that leaves the app.
 *
 * Kept as one helper so every external link in the app behaves the same in both
 * builds: in a tab the anchor is left to do its ordinary thing, in the APK the
 * navigation is taken over by the Custom Tab above.
 */
export function externalLinkProps(url) {
  return {
    onClick: (event) => {
      if (!url || !isNative()) return
      event.preventDefault()
      openExternal(url)
    },
  }
}
