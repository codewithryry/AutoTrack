/**
 * Is the app running as an installed PWA rather than in a browser tab?
 *
 * Chromium and the spec report this through the `display-mode` media query;
 * iOS Safari predates it and sets `navigator.standalone` instead, so both are
 * checked — the same pair the install prompt has always used.
 */
export function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  )
}

const LAUNCH_KEY = 'stms:app-launched'

/**
 * Is this document the installed app actually being opened?
 *
 * The opening screen belongs to a launch, not to a render. `sessionStorage` is
 * scoped to the app session the OS gives the installed app: it survives a
 * refresh and every in-app navigation, and is gone once the app is closed. So
 * the first document of a launch finds the key missing and claims it; a reload
 * of that same session finds it set, and a browser tab never gets this far.
 *
 * Call it once per document — claiming the launch is the answer, so a second
 * call in the same document reports false.
 */
export function claimAppLaunch() {
  if (typeof window === 'undefined' || !isStandalone()) return false
  try {
    if (window.sessionStorage.getItem(LAUNCH_KEY)) return false
    window.sessionStorage.setItem(LAUNCH_KEY, '1')
    return true
  } catch {
    // Storage blocked: treat it as "not a launch" rather than showing the
    // opening screen on every load.
    return false
  }
}
