import { useCallback, useEffect, useState } from 'react'
import { Spinner } from './ui'
import {
  OAUTH_ERROR_EVENT,
  clearPendingOAuth,
  currentSessionUser,
  hasPendingOAuth,
  signInWithGoogle,
} from '../services/auth'
import { isNative } from '../utils/native'

const CANCELLED = 'Google sign-in was cancelled. Please try again.'

/**
 * "Continue with Google" for the sign-in and create-account screens.
 *
 * `start('signin')` or `start('signup', role)`. In a browser the page leaves
 * for Google and returns to `/auth/callback`; in the APK a Custom Tab opens
 * and the deep link brings the session back. Either way the screen only
 * shows progress and errors — the role always comes from the stored profile.
 */
export function useGoogleSignIn() {
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState(null)

  // A failed callback in the APK arrives as an event from the deep-link handler.
  useEffect(() => {
    const onError = (event) => {
      setConnecting(false)
      setError(event.detail ?? CANCELLED)
    }
    window.addEventListener(OAUTH_ERROR_EVENT, onError)
    return () => window.removeEventListener(OAUTH_ERROR_EVENT, onError)
  }, [])

  // Back from Google's page with the browser's back button: the page is
  // restored from cache still showing "Connecting…".
  useEffect(() => {
    const onPageShow = (event) => {
      if (!event.persisted) return
      setConnecting(false)
      if (hasPendingOAuth() && !currentSessionUser()) {
        clearPendingOAuth()
        setError(CANCELLED)
      }
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  // In the APK, closing the Custom Tab without finishing is a cancel. A
  // successful sign-in closes it too, but by then there is a session, so
  // nothing is reported.
  useEffect(() => {
    if (!isNative()) return
    let listener = null
    let timer = null
    let cancelled = false
    import('@capacitor/browser')
      .then(({ Browser }) =>
        Browser.addListener('browserFinished', () => {
          setConnecting(false)
          timer = setTimeout(() => {
            // Signed in means it finished — a new student may still be
            // filling in their details, which needs the pending request.
            if (!hasPendingOAuth() || currentSessionUser()) return
            clearPendingOAuth()
            setError(CANCELLED)
          }, 1500)
        }),
      )
      .then((handle) => {
        if (cancelled) handle?.remove()
        else listener = handle
      })
      .catch(() => {})
    return () => {
      cancelled = true
      clearTimeout(timer)
      listener?.remove()
    }
  }, [])

  const start = useCallback(async (intent, role) => {
    setError(null)
    setConnecting(true)
    try {
      await signInWithGoogle({ intent, role })
    } catch (err) {
      setConnecting(false)
      setError(err?.message ?? 'Google sign-in could not be started. Please try again.')
    }
  }, [])

  return { start, connecting, error, setError }
}

/** Google's "G", as its sign-in branding requires. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-[18px] w-[18px] shrink-0" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

/** Styled like the "Create an account" link beneath it, so the column stays one design. */
export function GoogleSignInButton({ onClick, connecting, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={connecting || disabled}
      aria-busy={connecting || undefined}
      className="flex h-12 w-full min-w-0 items-center justify-center gap-2.5 rounded-2xl border px-4
                 text-[14.5px] font-bold transition-colors hover:bg-black/[0.03] disabled:opacity-60
                 dark:hover:bg-white/5"
      style={{ background: 'rgb(var(--surface))' }}
    >
      {connecting ? <Spinner /> : <GoogleMark />}
      <span className="truncate">{connecting ? 'Connecting to Google...' : 'Continue with Google'}</span>
    </button>
  )
}
