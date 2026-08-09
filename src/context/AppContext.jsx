import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as db from '../services/db'
import * as authService from '../services/auth'
import * as settingsService from '../services/settings'
import * as transactionService from '../services/transactions'
import * as maintenanceService from '../services/maintenance'
import { seedIfEmpty } from '../data/seed'
import { DEFAULT_SETTINGS } from '../utils/constants'
import { can as hasPermission } from '../utils/permissions'

/**
 * Application shell state: the boot sequence, session, settings, and a revision
 * counter that data hooks watch so any write anywhere refreshes every screen
 * showing that data.
 */

const AppContext = createContext(null)

/** Failsafe. The boot is fast; anything beyond this is a stuck environment. */
const BOOT_TIMEOUT_MS = 10_000

const isDev = import.meta.env?.DEV ?? false
const stage = (message) => {
  if (isDev) console.info(`[BOOT] ${message}`)
}

/* ------------------------------------------------------------------ *
 * Boot sequence
 *
 * The sequence lives at module scope, not inside the effect, and is memoised
 * in `bootPromise`. That is what makes it survive React.StrictMode: in
 * development React mounts, runs effects, tears them down and runs them again.
 * An effect that both starts the boot *and* owns a `cancelled` flag will have
 * that flag set by the teardown, so the in-flight boot can never apply its
 * result — and a "only boot once" ref stops the second run from starting a
 * fresh one. The app then sits on the boot screen forever, in dev only.
 *
 * Hoisting the work here means the second effect run simply awaits the same
 * promise and applies the result itself.
 * ------------------------------------------------------------------ */

let environmentPromise = null
let bootOverrides = {}

/** Memoised environment preparation — one run per page load. */
function preparedEnvironment(overrides) {
  environmentPromise ??= prepareEnvironment(overrides)
  return environmentPromise
}

/**
 * Prepare the environment: open the database, seed it if empty, load settings
 * and reconcile overdue loans.
 *
 * This is the expensive, idempotent half of the boot, so it is memoised and
 * runs once per page load. The session is deliberately *not* part of it —
 * see `runBootSequence`.
 *
 * Only `ready()` and `loadSettings()` are on the critical path. Seeding and
 * reconciliation are best-effort: a technician must still reach the login
 * screen when demo data or an overdue sweep fails.
 *
 * @returns {Promise<{ settings: object, warnings: string[] }>}
 */
async function prepareEnvironment(overrides = {}) {
  const {
    ready = db.ready,
    seed = seedIfEmpty,
    loadSettings = settingsService.load,
    runOverdueCheck = transactionService.runOverdueCheck,
    notifyMaintenanceDue = maintenanceService.notifyDue,
  } = overrides

  const warnings = []

  stage('starting application')

  stage('initialising database')
  await ready()
  stage('database initialised')

  try {
    stage('seeding database')
    const seeded = await seed()
    stage(seeded ? `database seed complete (${seeded.tools} tools)` : 'database already populated')
  } catch (err) {
    console.error('[BOOT ERROR] demo data could not be seeded', err)
    warnings.push('Demo data could not be loaded. The laboratory database is otherwise usable.')
  }

  stage('loading settings')
  const settings = await loadSettings()

  try {
    stage('reconciling overdue loans')
    await runOverdueCheck({
      dueSoonThresholdDays: settings.dueSoonThresholdDays,
      notify: settings.notifyOverdue !== false,
    })
    if (settings.notifyMaintenance !== false) await notifyMaintenanceDue()
    stage('reconciliation complete')
  } catch (err) {
    console.error('[BOOT ERROR] overdue/maintenance reconciliation failed', err)
    warnings.push('Overdue and maintenance alerts could not be refreshed.')
  }

  return { settings, warnings }
}

/**
 * Full boot: the memoised environment, then a *fresh* session read.
 *
 * Restoring the session is one indexed lookup, and it must reflect what is in
 * localStorage right now rather than a snapshot taken when the module first
 * loaded — otherwise a provider mounted after a sign-in would still believe
 * nobody is logged in.
 */
async function runBootSequence(overrides = {}) {
  const { restoreSession = authService.restore } = overrides
  const { settings, warnings } = await preparedEnvironment(overrides)

  stage('initialising authentication')
  const user = await restoreSession()
  stage(user ? `authentication initialised (${user.username})` : 'no stored session')

  stage('application boot complete')
  return { settings, user, warnings }
}

/** Reject if the sequence stalls, so the UI can offer a retry instead of hanging. */
function withTimeout(promise, ms) {
  if (!ms || ms <= 0) return promise
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            'Starting the laboratory database took too long. The browser may be blocking ' +
              'local storage, or another tab is holding the database open.',
          ),
        ),
      ms,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Run the boot for one provider mount.
 *
 * The expensive half is memoised, so a StrictMode remount re-reads only the
 * session. `force` is used by the retry control on the error screen and drops
 * the memo so a failed database open is genuinely attempted again.
 */
function startBoot({ force = false } = {}) {
  if (force) environmentPromise = null
  const { timeoutMs = BOOT_TIMEOUT_MS, ...deps } = bootOverrides
  return withTimeout(runBootSequence(deps), timeoutMs)
}

/**
 * Test seam: drop the memoised environment and optionally inject stand-ins for
 * the boot's dependencies. Not used by the application itself.
 */
export function __resetBootForTests(overrides = {}) {
  environmentPromise = null
  bootOverrides = overrides
}

/* ------------------------------------------------------------------ */

export function AppProvider({ children }) {
  const [booting, setBooting] = useState(true)
  const [bootError, setBootError] = useState(null)
  const [bootWarnings, setBootWarnings] = useState([])
  const [bootAttempt, setBootAttempt] = useState(0)
  const [user, setUser] = useState(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [revision, setRevision] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)

  const bumpRevision = useCallback(() => setRevision((r) => r + 1), [])

  /* --------------------------- boot --------------------------- */

  useEffect(() => {
    // `active` guards only *this* effect run's state updates — it never cancels
    // the boot. A StrictMode teardown therefore cannot orphan the work: the
    // second effect run reuses the memoised environment and applies the result
    // itself. Cancelling here instead is what left the app booting forever.
    let active = true

    setBooting(true)
    setBootError(null)

    startBoot({ force: bootAttempt > 0 })
      .then(({ settings: loaded, user: restored, warnings }) => {
        if (!active) return
        settingsService.applyTheme(loaded.theme)
        setSettings(loaded)
        setUser(restored)
        setBootWarnings(warnings)
      })
      .catch((err) => {
        console.error('[BOOT ERROR] application boot failed', err)
        if (!active) return
        setBootError(
          err?.message ??
            'The local database could not be opened. Try reloading, or clear site data.',
        )
      })
      .finally(() => {
        // Always leaves the loading state — success, failure or timeout.
        if (active) setBooting(false)
      })

    return () => {
      active = false
    }
  }, [bootAttempt])

  /** Re-run the boot from the error screen. */
  const retryBoot = useCallback(() => setBootAttempt((n) => n + 1), [])

  /** Dismiss a boot failure and continue with whatever loaded. */
  const continueWithoutBoot = useCallback(() => {
    setBootError(null)
    setBooting(false)
  }, [])

  /* ------------------- database change fan-out ------------------- */
  useEffect(() => db.subscribe(() => bumpRevision()), [bumpRevision])

  /* ------------------------ connectivity ------------------------ */
  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  /* --------------------------- theme --------------------------- */
  useEffect(() => {
    if (settings.theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => settingsService.applyTheme('system')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])

  /**
   * Re-run the overdue sweep when the tab regains focus. A laboratory PC is
   * often left open overnight, so "today" can change without a reload.
   */
  useEffect(() => {
    if (!user) return
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        await transactionService.runOverdueCheck({
          dueSoonThresholdDays: settings.dueSoonThresholdDays,
          notify: settings.notifyOverdue !== false,
        })
      } catch (err) {
        console.error('[app] overdue refresh failed', err)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [user, settings.dueSoonThresholdDays, settings.notifyOverdue])

  /* --------------------------- actions --------------------------- */

  const login = useCallback(async (username, password) => {
    const signedIn = await authService.login(username, password)
    setUser(signedIn)
    return signedIn
  }, [])

  const logout = useCallback(() => {
    authService.logout()
    setUser(null)
  }, [])

  const refreshUser = useCallback(async () => {
    const restored = await authService.restore()
    setUser(restored)
    return restored
  }, [])

  const saveSettings = useCallback(async (patch) => {
    const next = await settingsService.save(patch)
    settingsService.applyTheme(next.theme)
    setSettings(next)
    return next
  }, [])

  const reloadSettings = useCallback(async () => {
    const next = await settingsService.load()
    settingsService.applyTheme(next.theme)
    setSettings(next)
    return next
  }, [])

  const can = useCallback((permission) => hasPermission(user, permission), [user])

  const value = useMemo(
    () => ({
      booting,
      bootError,
      bootWarnings,
      retryBoot,
      continueWithoutBoot,
      user,
      isAuthenticated: !!user,
      settings,
      revision,
      online,
      login,
      logout,
      refreshUser,
      saveSettings,
      reloadSettings,
      bumpRevision,
      can,
    }),
    [
      booting,
      bootError,
      bootWarnings,
      retryBoot,
      continueWithoutBoot,
      user,
      settings,
      revision,
      online,
      login,
      logout,
      refreshUser,
      saveSettings,
      reloadSettings,
      bumpRevision,
      can,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}

export const useAuth = () => {
  const { user, isAuthenticated, login, logout, refreshUser, can } = useApp()
  return { user, isAuthenticated, login, logout, refreshUser, can }
}

export const useSettings = () => {
  const { settings, saveSettings, reloadSettings } = useApp()
  return { settings, saveSettings, reloadSettings }
}
