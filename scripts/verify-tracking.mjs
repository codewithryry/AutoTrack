/**
 * Loan-tracking verification — part of `npm run verify`.
 *
 * Drives `services/loanTracking.js` under Node against a fake native plugin
 * (one location service, a queue, permissions) and a fake server that answers
 * the way `append_loan_checkpoint()` does (0038 — its real behaviour is covered
 * by `npm run verify:sql`). What is checked here is the lifecycle: when the
 * service may run, which loans a reading lands on, and what happens offline,
 * on return and on sign-out.
 */
import assert from 'node:assert/strict'
import * as tracking from '../src/services/loanTracking.js'

const { TRACKING_STATE } = tracking

let passed = 0
const check = async (name, fn) => {
  try {
    await fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.stack ?? err.message}`)
    process.exitCode = 1
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** Let queued reconciles and drains (and the 400ms debounce) run out. */
const settle = () => sleep(600)

/* ------------------------------------------------------------------ *
 * The fake world
 * ------------------------------------------------------------------ */

function makeWorld() {
  const dbListeners = new Set()
  const appListeners = new Set()
  const checkpointListeners = new Set()

  const native = {
    permission: 'granted', // 'granted' | 'prompt' | 'denied'
    grantOnRequest: true,
    running: false,
    active: false,
    userId: null,
    loans: [],
    queue: [],
    seq: 0,
    watchersStarted: 0,
    startCalls: 0,
    stopCalls: [],

    async checkPermissions() {
      return { location: this.permission, coarseLocation: this.permission }
    },
    async requestPermissions() {
      if (this.grantOnRequest) this.permission = 'granted'
      else this.permission = 'denied'
      return this.checkPermissions()
    },
    async start({ userId, transactionIds }) {
      if (this.permission !== 'granted') {
        const err = new Error('Location permission is required.')
        err.code = 'PERMISSION'
        throw err
      }
      this.startCalls++
      if (this.userId !== userId) this.queue = []
      this.userId = userId
      this.active = true
      this.loans = [...transactionIds]
      // One device-level watcher: a start while running only refreshes it.
      if (!this.running) {
        this.running = true
        this.watchersStarted++
      }
      return this.getStatus()
    },
    async stop({ clearQueue = false, message = null } = {}) {
      this.stopCalls.push({ clearQueue, message, wasRunning: this.running })
      this.active = false
      this.loans = []
      if (clearQueue) this.queue = []
      this.running = false
      return this.getStatus()
    },
    async getStatus() {
      return { running: this.running, active: this.active, transactionIds: [...this.loans], pending: this.queue.length }
    },
    async getPending() {
      return { points: this.queue.map((p) => ({ ...p, transactionIds: [...p.transactionIds] })) }
    },
    async acknowledge({ ids }) {
      const before = this.queue.length
      this.queue = this.queue.filter((p) => !ids.includes(p.id))
      return { removed: before - this.queue.length }
    },
    async addListener(event, fn) {
      if (event === 'checkpoint') checkpointListeners.add(fn)
      return { remove: () => checkpointListeners.delete(fn) }
    },
    async openAppSettings() {},

    /** What LoanTrackingService does with a fix: queue it against the open loans. */
    reading(lat, lng, capturedAtMs = Date.now(), accuracy = 8) {
      if (!this.running || !this.active || !this.loans.length) return null
      const point = {
        id: `${capturedAtMs}-${++this.seq}`,
        lat,
        lng,
        accuracy,
        capturedAtMs,
        reason: 'interval',
        transactionIds: [...this.loans],
      }
      this.queue.push(point)
      for (const fn of checkpointListeners) fn(point)
      return point
    },
  }

  const server = {
    loans: new Map(), // id → { id, userId, status, checkpoints: [] }
    supported: true,
    calls: 0,

    borrow(id, userId) {
      this.loans.set(id, { id, userId, status: 'Borrowed', checkpoints: [] })
      world.db.emit('transactions')
    },
    close(id, { emit = true } = {}) {
      this.loans.get(id).status = 'Returned'
      if (emit) world.db.emit('transactions')
    },
    async listOwnOpenLoans(actor) {
      if (world.offline) return null
      return [...this.loans.values()]
        .filter((l) => l.userId === actor.id && (l.status === 'Borrowed' || l.status === 'Overdue'))
        .map((l) => ({ id: l.id, userId: l.userId, status: l.status }))
    },
    async record({ transactionId, location }) {
      this.calls++
      if (!this.supported) return { status: 'unsupported' }
      if (world.offline) return { status: 'offline' }
      const loan = this.loans.get(transactionId)
      if (!loan) return { status: 'missing' }
      if (loan.userId !== world.user?.id) return { status: 'forbidden' }
      if (loan.status !== 'Borrowed' && loan.status !== 'Overdue') return { status: 'closed' }
      if (loan.checkpoints.some((c) => c.capturedAt === location.capturedAt)) {
        return { status: 'duplicate', count: loan.checkpoints.length }
      }
      if (loan.checkpoints.length >= 100) return { status: 'full' }
      loan.checkpoints.push({ ...location, capturedById: world.user.id })
      return { status: 'saved', count: loan.checkpoints.length }
    },
  }

  const world = {
    offline: false,
    appActive: true,
    user: null,
    native,
    server,
    db: {
      subscribe(listener) {
        dbListeners.add(listener)
        return () => dbListeners.delete(listener)
      },
      emit(collection) {
        for (const fn of dbListeners) fn(collection)
      },
    },
    app: {
      async addListener(event, fn) {
        if (event === 'appStateChange') appListeners.add(fn)
        return { remove: () => appListeners.delete(fn) }
      },
      resume() {
        world.appActive = true
        for (const fn of appListeners) fn({ isActive: true })
      },
    },
  }
  return world
}

const windowListeners = new Map()
globalThis.window = {
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  addEventListener: (type, fn) => windowListeners.set(`${type}:${fn}`, fn),
  removeEventListener: (type, fn) => windowListeners.delete(`${type}:${fn}`),
}

const STUDENT = { id: 'USR-STUDENT', fullName: 'Student' }
const OTHER = { id: 'USR-OTHER', fullName: 'Other' }

/** A fresh world with the tracker detached from any previous test. */
async function fresh() {
  if (globalThis.__tracking) {
    await tracking.detach({ reason: 'switch' })
  }
  const world = makeWorld()
  globalThis.__tracking = world
  return world
}

async function signIn(world, user = STUDENT) {
  world.user = user
  await tracking.attach(user)
  await settle()
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

console.log('\n— loan tracking lifecycle —')

await check('app opened / signed in with no loan → no tracking', async () => {
  const w = await fresh()
  await signIn(w)
  assert.equal(w.native.running, false)
  assert.equal(w.native.startCalls, 0)
  assert.equal(tracking.getSnapshot().status, TRACKING_STATE.OFF)
})

await check('scanning a tool (no loan created) → no tracking', async () => {
  const w = await fresh()
  await signIn(w)
  w.db.emit('tools') // a scan reads tools; it writes no loan
  await settle()
  assert.equal(w.native.running, false)
  assert.equal(w.native.startCalls, 0)
})

await check('borrow → tracking starts for that loan', async () => {
  const w = await fresh()
  await signIn(w)
  w.server.borrow('TXN-1', STUDENT.id)
  await settle()
  assert.equal(w.native.running, true)
  assert.deepEqual(w.native.loans, ['TXN-1'])
  assert.equal(tracking.getSnapshot().status, TRACKING_STATE.TRACKING)
})

await check('a reading becomes a checkpoint on the loan, and leaves the queue', async () => {
  const w = await fresh()
  w.server.borrow('TXN-1', STUDENT.id)
  await signIn(w)
  const at = Date.now()
  w.native.reading(14.6, 120.98, at, 7.5)
  await settle()
  const [cp] = w.server.loans.get('TXN-1').checkpoints
  assert.equal(cp.lat, 14.6)
  assert.equal(cp.lng, 120.98)
  assert.equal(cp.accuracy, 7.5)
  assert.equal(cp.capturedAt, new Date(at).toISOString())
  assert.equal(w.native.queue.length, 0)
})

await check('multiple loans → one watcher, each checkpoint on its own loan', async () => {
  const w = await fresh()
  await signIn(w)
  w.server.borrow('TXN-1', STUDENT.id)
  await settle()
  w.server.borrow('TXN-2', STUDENT.id)
  await settle()
  assert.equal(w.native.watchersStarted, 1, 'a second loan must not start a second watcher')
  assert.deepEqual(w.native.loans, ['TXN-1', 'TXN-2'])
  w.native.reading(1, 2)
  await settle()
  assert.equal(w.server.loans.get('TXN-1').checkpoints.length, 1)
  assert.equal(w.server.loans.get('TXN-2').checkpoints.length, 1)
})

await check('one loan returned → tracking narrows; its history gets nothing more', async () => {
  const w = await fresh()
  w.server.borrow('TXN-1', STUDENT.id)
  w.server.borrow('TXN-2', STUDENT.id)
  await signIn(w)
  w.server.close('TXN-1')
  await settle()
  assert.deepEqual(w.native.loans, ['TXN-2'])
  w.native.reading(3, 4)
  await settle()
  assert.equal(w.server.loans.get('TXN-1').checkpoints.length, 0)
  assert.equal(w.server.loans.get('TXN-2').checkpoints.length, 1)
})

await check('return → service stops; a later reading is not recorded', async () => {
  const w = await fresh()
  w.server.borrow('TXN-1', STUDENT.id)
  await signIn(w)
  w.server.close('TXN-1')
  await settle()
  assert.equal(w.native.running, false)
  assert.equal(tracking.getSnapshot().status, TRACKING_STATE.OFF)
  assert.equal(w.native.reading(5, 6), null, 'the service must be gone')
  const stop = w.native.stopCalls.at(-1)
  assert.equal(stop.clearQueue, true)
  assert.match(stop.message, /returned/)
  assert.equal(w.server.loans.get('TXN-1').checkpoints.length, 0)
})

await check('reading races a return → the closed loan gets no checkpoint, tracking stops', async () => {
  const w = await fresh()
  w.server.borrow('TXN-1', STUDENT.id)
  await signIn(w)
  // Closed on the counter's machine, no realtime event reaches this phone yet.
  w.server.close('TXN-1', { emit: false })
  w.native.reading(7, 8)
  await settle()
  assert.equal(w.server.loans.get('TXN-1').checkpoints.length, 0)
  assert.equal(w.native.running, false, "the 'closed' answer must stop tracking")
  assert.equal(w.native.queue.length, 0)
})

await check('offline → readings queue; back online → each synced exactly once', async () => {
  const w = await fresh()
  w.server.borrow('TXN-1', STUDENT.id)
  await signIn(w)
  w.offline = true
  const t0 = Date.now()
  w.native.reading(1, 1, t0)
  w.native.reading(2, 2, t0 + 1)
  await settle()
  assert.equal(w.native.queue.length, 2, 'points must stay queued while offline')
  assert.equal(w.server.loans.get('TXN-1').checkpoints.length, 0)
  assert.equal(w.native.running, true, 'tracking continues offline')

  w.offline = false
  // Two triggers at once (the online event and a new reading) must not double-write.
  await Promise.all([tracking.reconcile(), w.native.reading(3, 3, t0 + 2)])
  await settle()
  const stored = w.server.loans.get('TXN-1').checkpoints.map((c) => c.capturedAt)
  assert.equal(stored.length, 3)
  assert.equal(new Set(stored).size, 3, 'no point stored twice')
  assert.equal(w.native.queue.length, 0)
})

await check('loan closed while offline → queued points discarded on reconnect', async () => {
  const w = await fresh()
  w.server.borrow('TXN-1', STUDENT.id)
  await signIn(w)
  w.offline = true
  w.native.reading(1, 1)
  await settle()
  w.server.close('TXN-1', { emit: false })
  w.offline = false
  await tracking.reconcile()
  await settle()
  assert.equal(w.server.loans.get('TXN-1').checkpoints.length, 0)
  assert.equal(w.native.queue.length, 0)
  assert.equal(w.native.running, false)
})

await check('sign-out → service stops, queue cleared, nothing recorded after', async () => {
  const w = await fresh()
  w.server.borrow('TXN-1', STUDENT.id)
  await signIn(w)
  w.offline = true
  w.native.reading(1, 1)
  await settle()
  await tracking.detach({ reason: 'signedOut' })
  w.offline = false
  assert.equal(w.native.running, false)
  assert.equal(w.native.queue.length, 0)
  assert.match(w.native.stopCalls.at(-1).message, /signed out/)
  assert.equal(w.native.reading(2, 2), null)
  await settle()
  assert.equal(w.server.loans.get('TXN-1').checkpoints.length, 0)
})

await check('a different account signing in never inherits the last one\'s loans', async () => {
  const w = await fresh()
  w.server.borrow('TXN-1', STUDENT.id)
  await signIn(w, STUDENT)
  w.user = OTHER
  await tracking.attach(OTHER)
  await settle()
  assert.equal(w.native.running, false)
  assert.deepEqual(w.native.loans, [])
})

await check('no location permission → explanation first, no service; allow → starts', async () => {
  const w = await fresh()
  w.native.permission = 'prompt'
  w.server.borrow('TXN-1', STUDENT.id)
  await signIn(w)
  assert.equal(tracking.getSnapshot().status, TRACKING_STATE.NEEDS_PERMISSION)
  assert.equal(w.native.running, false)
  assert.equal(await tracking.requestPermission(), true)
  await settle()
  assert.equal(w.native.running, true)
})

await check('permission refused → blocked, still no service', async () => {
  const w = await fresh()
  w.native.permission = 'prompt'
  w.native.grantOnRequest = false
  w.server.borrow('TXN-1', STUDENT.id)
  await signIn(w)
  assert.equal(await tracking.requestPermission(), false)
  assert.equal(tracking.getSnapshot().status, TRACKING_STATE.BLOCKED)
  assert.equal(w.native.running, false)
})

await check('no permission asked while there is no loan', async () => {
  const w = await fresh()
  w.native.permission = 'prompt'
  await signIn(w)
  assert.equal(tracking.getSnapshot().status, TRACKING_STATE.OFF)
})

await check('loan appears while the app is in the background → starts on resume', async () => {
  const w = await fresh()
  await signIn(w)
  w.appActive = false
  w.server.borrow('TXN-1', STUDENT.id)
  await settle()
  assert.equal(w.native.running, false)
  assert.equal(tracking.getSnapshot().status, TRACKING_STATE.WAITING)
  w.app.resume()
  await settle()
  assert.equal(w.native.running, true)
})

await check('database without 0038 → no tracking at all', async () => {
  const w = await fresh()
  w.server.supported = false
  w.server.borrow('TXN-1', STUDENT.id)
  await signIn(w)
  assert.equal(w.native.running, false)
  assert.equal(tracking.getSnapshot().status, TRACKING_STATE.UNAVAILABLE)
})

await check('100-checkpoint cap reached → tracking for that loan stops', async () => {
  const w = await fresh()
  w.server.borrow('TXN-1', STUDENT.id)
  w.server.loans.get('TXN-1').checkpoints = Array.from({ length: 100 }, (_, i) => ({ capturedAt: `x${i}` }))
  await signIn(w)
  w.native.reading(1, 1)
  await settle()
  assert.equal(w.server.loans.get('TXN-1').checkpoints.length, 100)
  assert.equal(w.native.running, false)
  assert.match(w.native.stopCalls.at(-1).message, /limit of 100/)
})

await tracking.detach({ reason: 'switch' })
console.log(`\n${passed} checks passed${process.exitCode ? ' — with failures above' : ''}`)
