import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as db from '../services/db'
import { COLLECTIONS } from '../services/db'
import * as authService from '../services/auth'
import * as settingsService from '../services/settings'
import * as offlineCache from '../services/offlineCache'
import { syncPending } from '../services/sync'
import { clearAsyncCache } from '../hooks/asyncCache'
import { clearIdleStamp, useIdleTimeout } from '../hooks/useIdleTimeout'
import * as transactionService from '../services/transactions'
import * as maintenanceService from '../services/maintenance'
import {
  DEFAULT_SETTINGS,
  ROLE,
  SESSION_IDLE_LIMIT_MINUTES,
  SESSION_IDLE_LIMIT_MS,
} from '../utils/constants'
import { PERM, can as hasPermission, isStaff } from '../utils/permissions'

/**
 * Application shell state: the local session, the signed-in user's stored
 * profile, laboratory settings, and a revision counter that data hooks watch so
 * a write anywhere — including one made in another tab — refreshes every screen
 * showing that data.
 *
 * The session is owned by `services/localAuth.js`. Its listener fires
 * once as soon as the persisted session has been read, which is
 * what ends the loading state: `authReady` is never left false, so the app can
 * never sit on a spinner.
 *
 * The role always comes from the stored `users` record, never from anything the
 * client could set. A session whose profile is missing, roleless or inactive is
 * signed straight back out with an explanation on the login screen.
 */

const AppContext = createContext(null)

/**
 * Failsafe for the profile read.
 *
 * The session is restored quickly, but the profile read that
 * turns it into a role can hang on a cold, offline first load with nothing
 * cached. Without this the app would sit on the boot skeleton — exactly the state
 * the boot is designed never to reach.
 */
const PROFILE_TIMEOUT_MS = 15_000

/** Where the manual offline-mode override is remembered, per device. */
const OFFLINE_MODE_KEY = 'stms.offline-mode'

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('Timed out waiting for the profile.')
      err.name = 'TimeoutError'
      reject(err)
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export function AppProvider({ children }) {
  /** False only until the stored session has been read. */
  const [authReady, setAuthReady] = useState(false)
  const [user, setUser] = useState(null)
  /** Why a session was rejected — surfaced on the login screen. */
  const [sessionError, setSessionError] = useState(null)
  /** A hard failure that leaves the app unusable. */
  const [bootError, setBootError] = useState(null)
  const [bootWarnings, setBootWarnings] = useState([])
  const [settings, setSettings] = useState(() => ({
    ...DEFAULT_SETTINGS,
    theme: settingsService.loadTheme(),
  }))
  const [revision, setRevision] = useState(0)
  const [connected, setConnected] = useState(navigator.onLine)
  // Offline mode is a manual override kept on the device. It is handed to the
  // data layer, which then reads from the copy stored on this device instead of
  // the network — the device's real connectivity is still tracked separately in
  // `connected`.
  const [offlineMode, setOfflineModeState] = useState(
    () => localStorage.getItem(OFFLINE_MODE_KEY) === '1',
  )
  const online = connected && !offlineMode

  const [attempt, setAttempt] = useState(0)

  const bumpRevision = useCallback(() => setRevision((r) => r + 1), [])

  /** Flush the outbox; only screens actually need re-reading when something moved. */
  const runSync = useCallback(async () => {
    try {
      const result = await syncPending()
      if (result?.synced > 0) bumpRevision()
      return result
    } catch (err) {
      console.error('[app] background sync failed', err)
      return { synced: 0, failed: 0, pending: 0, skipped: false }
    }
  }, [bumpRevision])

  const setOfflineMode = useCallback(
    (value) => {
      setOfflineModeState(value)
      db.setOfflineMode(value)
      try {
        localStorage.setItem(OFFLINE_MODE_KEY, value ? '1' : '0')
      } catch {
        /* the preference simply does not survive a reload */
      }
      // Turning the manual override off is the moment queued changes can leave
      // the device — flush them before the screens re-read.
      if (!value) void runSync()
    },
    [runSync],
  )

  /* --------------------------- session --------------------------- */

  useEffect(() => {
    // The device theme applies before anything else so the first paint is right.
    settingsService.applyTheme(settingsService.loadTheme())
  }, [])

  useEffect(() => {
    let active = true

    const unsubscribe = authService.onAuthChange(async (sessionUser) => {
      if (!sessionUser) {
        db.clearScope()
        // The cached page data belongs to the account that could read it.
        clearAsyncCache()
        if (!active) return
        setUser(null)
        setAuthReady(true)
        return
      }

      try {
        const profile = await withTimeout(
          authService.loadProfile(sessionUser),
          PROFILE_TIMEOUT_MS,
        )
        // Scope the data layer before any screen reads from it.
        db.setScope({ uid: profile.id, role: profile.role })
        if (!active) return
        setSessionError(null)
        setUser(profile)
      } catch (err) {
        console.error('[app] the signed-in account cannot be used', err)
        if (!active) return
        if (err?.name === 'TimeoutError') {
          // The profile never arrived — nothing
          // cached. The session is left alone; the boot error state offers a retry.
          setBootError(
            'Your laboratory profile could not be loaded. Check the internet connection and try again.',
          )
        } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          // Offline with nothing cached for this account — a first launch on
          // this device, say. The session is deliberately left alone: signing
          // them out here would mean they could not get back in until they had
          // a connection *and* their password. They are told to reconnect, and
          // the retry picks up where it left off.
          setBootError(
            'Your laboratory profile is not stored on this device yet. Connect to the internet once to finish signing in.',
          )
        } else {
          // The account authenticates but cannot be used: no profile, no role,
          // or not active. Drop the session and explain why on the login screen.
          await authService.logout().catch(() => {})
          setSessionError(err?.message ?? 'This account cannot be used right now.')
          setUser(null)
        }
      } finally {
        if (active) setAuthReady(true)
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [attempt])

  /* --------------------------- settings --------------------------- */

  /**
   * Load the settings once per session, and again when the settings document
   * itself changes.
   *
   * Deliberately *not* on every revision bump: that fires on any write anywhere,
   * and each load produces a new settings object, which would reset the Settings
   * form under an administrator mid-edit.
   */
  useEffect(() => {
    if (!user) {
      setSettings((s) => ({ ...DEFAULT_SETTINGS, theme: s.theme }))
      return
    }

    let active = true
    const load = () =>
      settingsService
        .load()
        .then((loaded) => {
          if (!active) return
          settingsService.applyTheme(loaded.theme)
          setSettings(loaded)
        })
        .catch((err) => {
          console.error('[app] settings could not be loaded', err)
          if (!active) return
          // The defaults are usable, so this is a warning rather than a dead end.
          setBootWarnings((w) => (w.includes(SETTINGS_WARNING) ? w : [...w, SETTINGS_WARNING]))
        })

    load()
    const unsubscribe = db.subscribe((collection) => {
      if (collection === COLLECTIONS.settings || collection === '*') load()
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [user])

  /* ------------------- data change fan-out ------------------- */
  useEffect(() => db.subscribe(() => bumpRevision()), [bumpRevision])

  /* ------------------------ connectivity ------------------------ */
  // The stored preference has to reach the data layer before the first read,
  // and again whenever it changes.
  useEffect(() => {
    db.setOfflineMode(offlineMode)
  }, [offlineMode])

  useEffect(() => {
    const goOnline = () => {
      setConnected(true)
      // Back on the network: flush any queued changes first, then let every open
      // screen re-read from the server — the fresh rows replace the cached copy
      // as they arrive.
      void runSync().finally(() => bumpRevision())
    }
    const goOffline = () => setConnected(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [runSync, bumpRevision])

  /* ---------------------- outbox retry while online ---------------------- */
  // A change that failed to reach the server (flaky connection, an op the server
  // refused) is retried on a timer, not just on the online event — the device can
  // be connected without the backend being reachable.
  const SYNC_RETRY_MS = 20_000
  useEffect(() => {
    if (!user || !online) return
    void runSync()
    const timer = setInterval(() => void runSync(), SYNC_RETRY_MS)
    return () => clearInterval(timer)
  }, [user, online, runSync])

  /* --------------------------- theme --------------------------- */
  useEffect(() => {
    if (settings.theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => settingsService.applyTheme('system')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])

  /* ---------------------- overdue reconciliation ---------------------- */

  /**
   * Flip due loans to Overdue and raise the alerts.
   *
   * Only staff run this: it writes to transactions and tools, which the security
   * rules (rightly) forbid a student from doing. A student's own overdue loan is
   * still shown as late by the due-date comparison in the UI.
   */
  const sweptRef = useRef(null)
  useEffect(() => {
    if (!user || !isStaff(user)) return
    const key = `${user.id}:${settings.dueSoonThresholdDays}`

    const sweep = async () => {
      try {
        await transactionService.runOverdueCheck({
          dueSoonThresholdDays: settings.dueSoonThresholdDays,
          notify: settings.notifyOverdue !== false,
        })
        if (settings.notifyMaintenance !== false) await maintenanceService.notifyDue()
      } catch (err) {
        console.error('[app] overdue reconciliation failed', err)
      }
    }

    if (sweptRef.current !== key) {
      sweptRef.current = key
      sweep()
    }

    // A laboratory PC is often left open overnight, so "today" can change
    // without a reload.
    const onVisible = () => {
      if (document.visibilityState === 'visible') sweep()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [
    user,
    settings.dueSoonThresholdDays,
    settings.notifyOverdue,
    settings.notifyMaintenance,
  ])

  /* --------------------------- actions --------------------------- */

  /** Sign in. The auth listener applies the profile; this returns it early so
   *  the login screen can greet the user by name. */
  const login = useCallback(async (email, password) => {
    setSessionError(null)
    const profile = await authService.login(email, password)
    clearAsyncCache()
    db.setScope({ uid: profile.id, role: profile.role })
    setUser(profile)
    return profile
  }, [])

  const logout = useCallback(async () => {
    const uid = user?.id
    await authService.logout()
    clearAsyncCache()
    clearIdleStamp(uid)
    setUser(null)
    setSessionError(null)
    // The records cached for reading offline belong to the account that read
    // them, so they leave with it — as do its queued, unsynced changes.
    if (uid) {
      void offlineCache.clearAccount(uid)
      void offlineCache.clearAccountOutbox(uid)
    }
  }, [user])

  /* --------------------------- standby --------------------------- */

  /**
   * Close a session that has stood idle past the limit.
   *
   * The same `logout()` as the menu's: the session ends and this device's cache
   * and queued changes go with it — the account itself, and everything it has
   * recorded, is untouched. The reason is put on `sessionError`, which is the
   * existing channel the login screen reads, so the person lands on a form that
   * explains what happened rather than on a silent sign-out.
   *
   * Students and instructors only; an administrator's session is unchanged.
   */
  const expireIdleSession = useCallback(async () => {
    try {
      await logout()
    } catch (err) {
      console.warn('[app] the idle session could not be closed cleanly', err)
      setUser(null)
    }
    setSessionError(
      `You were signed out after ${SESSION_IDLE_LIMIT_MINUTES} minutes without activity. ` +
        'Sign in again to continue — nothing on your account has changed.',
    )
  }, [logout])

  useIdleTimeout({
    enabled: !!user && user.role !== ROLE.ADMIN,
    timeoutMs: SESSION_IDLE_LIMIT_MS,
    uid: user?.id ?? null,
    onExpire: expireIdleSession,
  })

  /**
   * Delete the signed-in account. The service removes the credential and the
   * profile (signing the session out along the way); the shell drops its own
   * state so nothing on screen keeps referring to an account that is gone.
   */
  const deleteOwnAccount = useCallback(async () => {
    await authService.deleteAccount(user)
    clearAsyncCache()
    setUser(null)
    setSessionError(null)
  }, [user])

  /** Re-read the profile — used after a user edits their own details. */
  const refreshUser = useCallback(async () => {
    const sessionUser = authService.currentSessionUser()
    if (!sessionUser) return null
    const profile = await authService.loadProfile(sessionUser)
    db.setScope({ uid: profile.id, role: profile.role })
    setUser(profile)
    return profile
  }, [])

  const retryBoot = useCallback(() => {
    setBootError(null)
    setBootWarnings([])
    setAuthReady(false)
    setAttempt((n) => n + 1)
  }, [])

  const continueWithoutBoot = useCallback(() => {
    setBootError(null)
    setAuthReady(true)
  }, [])

  const saveSettings = useCallback(
    async (patch) => {
      const next = await settingsService.save(patch, user)
      settingsService.applyTheme(next.theme)
      setSettings(next)
      return next
    },
    [user],
  )

  const reloadSettings = useCallback(async () => {
    const next = await settingsService.load()
    settingsService.applyTheme(next.theme)
    setSettings(next)
    return next
  }, [])

  const can = useCallback((permission) => hasPermission(user, permission), [user])

  const value = useMemo(
    () => ({
      authReady,
      // `booting` is kept for the shell: the app is booting until the session has
      // reported whether somebody is signed in.
      booting: !authReady,
      bootError,
      bootWarnings,
      sessionError,
      clearSessionError: () => setSessionError(null),
      retryBoot,
      continueWithoutBoot,
      user,
      role: user?.role ?? null,
      isAuthenticated: !!user,
      settings,
      revision,
      online,
      offlineMode,
      setOfflineMode,
      login,
      logout,
      deleteOwnAccount,
      refreshUser,
      saveSettings,
      reloadSettings,
      bumpRevision,
      can,
      PERM,
    }),
    [
      authReady,
      bootError,
      bootWarnings,
      sessionError,
      retryBoot,
      continueWithoutBoot,
      user,
      settings,
      revision,
      online,
      offlineMode,
      setOfflineMode,
      login,
      logout,
      deleteOwnAccount,
      refreshUser,
      saveSettings,
      reloadSettings,
      bumpRevision,
      can,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

const SETTINGS_WARNING =
  'Laboratory settings could not be read. The defaults are in use for now.'

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}

export const useAuth = () => {
  const { user, role, isAuthenticated, authReady, login, logout, refreshUser, can } = useApp()
  return { user, role, isAuthenticated, authReady, login, logout, refreshUser, can }
}

/** The authenticated user's role, straight from their stored profile. */
export const useUserRole = () => {
  const { role, user, can } = useApp()
  return { role, user, can }
}

export const useSettings = () => {
  const { settings, saveSettings, reloadSettings } = useApp()
  return { settings, saveSettings, reloadSettings }
}
