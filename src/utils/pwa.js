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
