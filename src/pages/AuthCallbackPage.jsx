import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandMark } from '../components/Brand'
import { useApp } from '../context/AppContext'
import { completeGoogleCallback } from '../services/auth'

/** How long to wait for the profile before giving up and saying so. */
const PROFILE_WAIT_MS = 20000

/**
 * `/auth/callback` — where Google sign-in returns in a browser tab or the
 * installed PWA. (The APK comes back on its own scheme instead, handled by
 * `services/deepLinks.js`.)
 *
 * It turns the callback into a session, removes the credential from the
 * address bar, then waits for the app to load the profile behind it. That
 * profile — never anything in this URL — decides the role: the dashboard on
 * success, or the sign-in screen with the reason (cancelled, pending
 * approval, no account) otherwise.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const { isAuthenticated, sessionError, profileSetup } = useApp()
  const started = useRef(false)
  const [established, setEstablished] = useState(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const url = window.location.href
    // The tokens are not left in the address bar or the history entry.
    window.history.replaceState(null, '', '/auth/callback')

    completeGoogleCallback(url).then(({ ok, error }) => {
      if (ok) setEstablished(true)
      else navigate('/login', { replace: true, state: { oauthError: error } })
    })
  }, [navigate])

  useEffect(() => {
    if (!established) return
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true })
      return
    }
    // The session was refused (no account, pending, inactive): the sign-in
    // screen already reads `sessionError` and explains it.
    if (sessionError) {
      navigate('/login', { replace: true })
      return
    }
    // A new student is filling in their details in the setup dialog.
    if (profileSetup) return
    const timer = setTimeout(() => {
      navigate('/login', {
        replace: true,
        state: { oauthError: 'Google sign-in could not be completed. Please try again.' },
      })
    }, PROFILE_WAIT_MS)
    return () => clearTimeout(timer)
  }, [established, isAuthenticated, sessionError, profileSetup, navigate])

  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center"
      role="status"
      aria-live="polite"
    >
      <BrandMark size={48} className="rounded-xl" />
      <p className="muted text-sm font-semibold">Signing you in…</p>
    </div>
  )
}
