/**
 * Automatic loan tracking — the Android app only.
 *
 * While the signed-in account has a borrowed tool, the phone's location is
 * recorded as checkpoints on that loan: whenever the phone has moved
 * significantly, and at least every 10 minutes. The tool carries no hardware;
 * the borrower's phone is the location source.
 *
 * Who does what
 * -------------
 *   Native (android/…/tracking)   one foreground location service for the whole
 *                                 device, with its notification. It measures,
 *                                 and queues each reading on the phone against
 *                                 the loans open at that moment. It never writes
 *                                 to the database.
 *   This module                   decides — from the server, never from the
 *                                 page cache — whether the account has open
 *                                 loans, starts or stops the service to match,
 *                                 and writes the queued readings through
 *                                 `append_loan_checkpoint()` (migration 0038),
 *                                 which re-checks the borrower and the open loan
 *                                 under a row lock before storing anything.
 *
 * Lifecycle
 * ---------
 *   no open loan               → service stopped, queue cleared
 *   open loan(s)               → one service, one watcher, all open loans
 *   loan closed anywhere       → realtime change or the next checkpoint's
 *                                'closed' answer → service stopped
 *   sign-out / session gone    → service stopped, queue cleared
 *   offline                    → service keeps measuring; readings wait in the
 *                                native queue and are written once, in order,
 *                                when the connection returns — or dropped if the
 *                                database says the loan has closed meanwhile.
 *
 * Opening the app, signing in or scanning a code never starts anything by
 * itself: every start follows from the server listing an open loan for this
 * account. A browser or the PWA never reaches any of this — `isTrackingPlatform()`
 * is false there and the existing one-shot location behaviour is unchanged.
 */

import * as db from './db'
import { COLLECTIONS } from './db'
import * as txnService from './transactions'
import { isNative } from '../utils/native'

export const TRACKING_STATE = {
  /** Nothing to track, or not the Android app. */
  OFF: 'off',
  /** An open loan, and location has not been allowed yet. */
  NEEDS_PERMISSION: 'needs-permission',
  /** Location was refused in a way only Android Settings can undo. */
  BLOCKED: 'blocked',
  /** The person chose "Not now" for these loans in this app session. */
  DECLINED: 'declined',
  /** Android only starts a foreground service while the app is on screen. */
  WAITING: 'waiting',
  TRACKING: 'tracking',
  /** The database does not have migration 0038, or the service would not start. */
  UNAVAILABLE: 'unavailable',
}

/** Shown before Android's own permission dialog. */
export const PERMISSION_RATIONALE =
  "Tool Track uses your phone's location while you have a borrowed tool to record the tool's last known location."

const STOP_MESSAGES = {
  returned: 'Your borrowed tool has been returned, so location tracking is off.',
  signedOut: "You signed out, so Tool Track stopped recording your borrowed tool's location.",
  full: 'This loan reached the limit of 100 recorded locations, so tracking has stopped.',
}

/** Re-check the loans with the server at least this often while points flow in. */
const LEASE_RENEW_MS = 30 * 60 * 1000
/** Coalesce a burst of change events into one server check. */
const RECONCILE_DEBOUNCE_MS = 400

export const isTrackingPlatform = () =>
  isNative() && typeof window !== 'undefined' && window.Capacitor?.getPlatform?.() === 'android'

/* ------------------------------------------------------------------ *
 * Native handles, loaded lazily so a browser build never imports them
 * ------------------------------------------------------------------ */

let pluginPromise = null
const plugin = () => {
  if (!pluginPromise) {
    pluginPromise = import('@capacitor/core').then(({ registerPlugin }) => registerPlugin('LoanTracking'))
  }
  return pluginPromise
}

async function appIsActive() {
  try {
    const { App } = await import('@capacitor/app')
    return (await App.getState()).isActive
  } catch {
    return typeof document === 'undefined' || document.visibilityState === 'visible'
  }
}

/* ------------------------------------------------------------------ *
 * State for the UI
 * ------------------------------------------------------------------ */

let snapshot = { status: TRACKING_STATE.OFF, loans: [], detail: null }
const listeners = new Set()

export const getSnapshot = () => snapshot

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setState(patch) {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) {
    try {
      listener()
    } catch (err) {
      console.error('[tracking] a state listener threw', err)
    }
  }
}

/* ------------------------------------------------------------------ *
 * Session
 * ------------------------------------------------------------------ */

let user = null
/** Bumped on every attach/detach, so async work from an older session stops. */
let generation = 0
let detachers = []

/** null = not asked yet this session, true/false = 0038 present or not. */
let serverReady = null
/** Loans the database has said are over (closed, missing, not ours) this session. */
const endedLoans = new Set()
/** Loans at the 100-checkpoint cap this session. */
const fullLoans = new Set()
/** The set of loans the person said "Not now" to in this app session. */
let declinedKey = null
let lastReconcileAt = 0
let reconcileTimer = null

/**
 * Take over tracking for a signed-in account. Idempotent: attaching the same
 * account again only re-checks its loans.
 */
export async function attach(nextUser) {
  if (!isTrackingPlatform() || !nextUser?.id) return
  if (user?.id === nextUser.id) {
    user = nextUser
    void reconcile()
    return
  }
  if (user) await detach({ reason: 'switch' })

  user = nextUser
  const mine = ++generation
  serverReady = null
  endedLoans.clear()
  fullLoans.clear()
  declinedKey = null

  await listen(mine)
  if (mine !== generation) return
  void reconcile()
}

/**
 * The account is gone — signed out, session expired or revoked, or a different
 * account signed in. The service stops and its unsent readings are discarded:
 * they can only ever be written by the borrower's own session.
 */
export async function detach({ reason = 'signedOut' } = {}) {
  if (!isTrackingPlatform()) return
  const wasAttached = !!user
  user = null
  generation++
  clearTimeout(reconcileTimer)
  for (const off of detachers.splice(0)) {
    try {
      off()
    } catch {
      /* already gone */
    }
  }
  try {
    const native = await plugin()
    await native.stop({
      clearQueue: true,
      message: wasAttached && reason === 'signedOut' ? STOP_MESSAGES.signedOut : null,
    })
  } catch (err) {
    console.warn('[tracking] the location service could not be stopped', err)
  }
  setState({ status: TRACKING_STATE.OFF, loans: [], detail: null })
}

async function listen(mine) {
  const native = await plugin()
  if (mine !== generation) return

  // A reading was queued by the service: write it now.
  const checkpoint = await native.addListener('checkpoint', () => void drain())
  detachers.push(() => checkpoint.remove())

  // Any change to transactions — a local borrow or return, or a realtime change
  // from the counter's machine — may open or close one of this account's loans.
  detachers.push(
    db.subscribe((collection) => {
      if (collection === COLLECTIONS.transactions || collection === '*') scheduleReconcile()
    }),
  )

  // This account's own loans over realtime, so a return confirmed on another
  // device stops this phone's tracking without waiting for the next checkpoint.
  let unwatch = db.watchCollection(COLLECTIONS.transactions, () => {}, {
    column: 'user_id',
    value: user.id,
  })
  detachers.push(() => unwatch())

  const onOnline = () => {
    // The watch is not opened while offline; open it now.
    unwatch()
    if (user) {
      unwatch = db.watchCollection(COLLECTIONS.transactions, () => {}, {
        column: 'user_id',
        value: user.id,
      })
    }
    void reconcile()
  }
  window.addEventListener('online', onOnline)
  detachers.push(() => window.removeEventListener('online', onOnline))

  try {
    const { App } = await import('@capacitor/app')
    const resume = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void reconcile()
    })
    detachers.push(() => resume.remove())
  } catch {
    /* no App plugin — realtime and checkpoints still drive it */
  }
}

/* ------------------------------------------------------------------ *
 * Reconcile: make the service match the server
 * ------------------------------------------------------------------ */

function scheduleReconcile() {
  clearTimeout(reconcileTimer)
  reconcileTimer = setTimeout(() => void reconcile(), RECONCILE_DEBOUNCE_MS)
}

let reconciling = null
let reconcileAgain = false

export function reconcile() {
  if (!isTrackingPlatform()) return Promise.resolve()
  if (reconciling) {
    reconcileAgain = true
    return reconciling
  }
  reconciling = (async () => {
    do {
      reconcileAgain = false
      try {
        await reconcileOnce()
      } catch (err) {
        console.warn('[tracking] the loans could not be checked', err)
      }
    } while (reconcileAgain)
  })().finally(() => {
    reconciling = null
  })
  return reconciling
}

async function reconcileOnce() {
  const me = user
  const mine = generation
  if (!me) return
  // Offline, nothing can be confirmed either way: whatever is running keeps
  // running, and its readings wait in the native queue.
  if (db.isOffline()) return

  const loans = await txnService.listOwnOpenLoans(me)
  if (loans === null || mine !== generation) return
  lastReconcileAt = Date.now()

  const native = await plugin()
  const open = loans
    .map((txn) => txn.id)
    .filter((id) => !endedLoans.has(id) && !fullLoans.has(id))
    .sort()

  if (!open.length) {
    const wasTracking = snapshot.status === TRACKING_STATE.TRACKING
    const allFull = loans.length > 0 && loans.every((txn) => fullLoans.has(txn.id))
    await native.stop({
      clearQueue: true,
      message: allFull ? STOP_MESSAGES.full : wasTracking ? STOP_MESSAGES.returned : null,
    })
    setState({ status: TRACKING_STATE.OFF, loans: [], detail: allFull ? 'full' : null })
    return
  }

  if (serverReady === null) serverReady = await probeServer()
  if (mine !== generation) return
  if (serverReady === null) return // not reachable right now
  if (serverReady === false) {
    // Without 0038 a point could not be written safely, so none is taken.
    await native.stop({ clearQueue: false, message: null })
    setState({ status: TRACKING_STATE.UNAVAILABLE, loans: open, detail: 'server' })
    return
  }

  const permission = await locationPermission(native)
  if (mine !== generation) return
  if (permission !== 'granted') {
    const key = open.join(',')
    setState({
      status:
        declinedKey === key
          ? TRACKING_STATE.DECLINED
          : permission === 'denied'
            ? TRACKING_STATE.BLOCKED
            : TRACKING_STATE.NEEDS_PERMISSION,
      loans: open,
      detail: null,
    })
    return
  }

  const status = await native.getStatus()
  if (!status.running && !(await appIsActive())) {
    // Android refuses to start a foreground service from the background; the
    // next resume starts it.
    setState({ status: TRACKING_STATE.WAITING, loans: open, detail: null })
    return
  }

  try {
    await native.start({ userId: me.id, transactionIds: open })
    if (mine !== generation) return
    setState({ status: TRACKING_STATE.TRACKING, loans: open, detail: null })
  } catch (err) {
    const code = err?.code
    setState({
      status: code === 'PERMISSION' ? TRACKING_STATE.NEEDS_PERMISSION : TRACKING_STATE.WAITING,
      loans: open,
      detail: err?.message ?? null,
    })
    return
  }

  void drain()
}

/** Whether `append_loan_checkpoint()` exists. null when it cannot be told yet. */
async function probeServer() {
  try {
    const { status } = await txnService.recordTrackedCheckpoint({
      transactionId: '__probe__',
      location: { lat: 0, lng: 0, accuracy: null, capturedAt: new Date().toISOString() },
    })
    if (status === 'unsupported') return false
    if (status === 'offline') return null
    return true // 'missing' / 'forbidden': the function answered
  } catch (err) {
    console.warn('[tracking] the checkpoint function could not be reached', err)
    return null
  }
}

async function locationPermission(native) {
  try {
    const state = await native.checkPermissions()
    if (state.location === 'granted' || state.coarseLocation === 'granted') return 'granted'
    if (state.location === 'denied') return 'denied'
    return 'prompt'
  } catch {
    return 'prompt'
  }
}

/* ------------------------------------------------------------------ *
 * Drain: write the queued readings
 * ------------------------------------------------------------------ */

let draining = null
let drainAgain = false

function drain() {
  if (draining) {
    drainAgain = true
    return draining
  }
  draining = (async () => {
    do {
      drainAgain = false
      try {
        await drainOnce()
      } catch (err) {
        console.warn('[tracking] queued locations could not be written yet', err)
      }
    } while (drainAgain)
  })().finally(() => {
    draining = null
  })
  return draining
}

async function drainOnce() {
  const me = user
  const mine = generation
  if (!me || db.isOffline() || serverReady === false) return

  const native = await plugin()
  const { points = [] } = await native.getPending()
  if (!points.length) return

  const settled = []
  let loanEnded = false

  // In the order they were taken, and one at a time: the server's duplicate
  // check (same capturedAt on the same loan) is what makes a retry after a
  // half-finished pass safe, so a point is never stored twice.
  for (const point of points) {
    if (mine !== generation) return
    const location = {
      lat: Number(point.lat),
      lng: Number(point.lng),
      accuracy: Number.isFinite(Number(point.accuracy)) && point.accuracy !== null ? Number(point.accuracy) : null,
      capturedAt: new Date(Number(point.capturedAtMs)).toISOString(),
    }

    let retryLater = false
    for (const transactionId of point.transactionIds ?? []) {
      if (endedLoans.has(transactionId) || fullLoans.has(transactionId)) continue

      const { status } = await txnService.recordTrackedCheckpoint({ transactionId, location })
      if (status === 'offline') {
        retryLater = true
        break
      }
      if (status === 'unsupported') {
        serverReady = false
        retryLater = true
        break
      }
      if (status === 'closed' || status === 'missing' || status === 'forbidden') {
        // Over, or not this account's: drop the point for it and stop tracking it.
        endedLoans.add(transactionId)
        loanEnded = true
      } else if (status === 'full') {
        fullLoans.add(transactionId)
        loanEnded = true
      }
      // saved | duplicate | invalid — settled for this loan.
    }
    if (retryLater) break
    settled.push(point.id)
  }

  if (settled.length && mine === generation) await native.acknowledge({ ids: settled })

  // A loan ended: stop (or narrow) tracking now. Otherwise renew the service's
  // lease with a fresh server check every so often.
  if (loanEnded || Date.now() - lastReconcileAt > LEASE_RENEW_MS) void reconcile()
}

/* ------------------------------------------------------------------ *
 * Permission, from the UI
 * ------------------------------------------------------------------ */

/**
 * Ask Android for location (and, on Android 13+, for the notification that
 * shows tracking is running), then re-check. Only ever called from the
 * explanation dialog, which only appears while there is an open loan.
 */
export async function requestPermission() {
  if (!isTrackingPlatform()) return false
  const native = await plugin()
  try {
    await native.requestPermissions({ permissions: ['location'] })
  } catch (err) {
    console.warn('[tracking] the location permission request failed', err)
  }
  const granted = (await locationPermission(native)) === 'granted'
  if (!granted) {
    setState({ status: TRACKING_STATE.BLOCKED })
    return false
  }
  await ensureNotificationPermission()
  await reconcile()
  return true
}

async function ensureNotificationPermission() {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const { display } = await LocalNotifications.checkPermissions()
    if (display === 'prompt' || display === 'prompt-with-rationale') {
      await LocalNotifications.requestPermissions()
    }
  } catch {
    // Tracking still runs; Android lists the service under active apps either way.
  }
}

/** "Not now": no prompt again for these loans until the app is next opened. */
export function decline() {
  declinedKey = snapshot.loans.join(',')
  setState({ status: TRACKING_STATE.DECLINED })
}

export async function openSettings() {
  if (!isTrackingPlatform()) return
  try {
    const native = await plugin()
    await native.openAppSettings()
  } catch (err) {
    console.warn('[tracking] Android settings could not be opened', err)
  }
}
