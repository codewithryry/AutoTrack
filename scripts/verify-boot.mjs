/**
 * Boot verification.
 *
 * The application shell must always leave the booting state — under
 * React.StrictMode (which double-invokes effects in development), on a cold
 * empty database, on a warm database, and when IndexedDB itself fails.
 *
 * This suite exists because a StrictMode-only boot hang shipped once: the boot
 * effect guarded its state updates with a `cancelled` flag that StrictMode's
 * immediate cleanup set to true, while a `bootedRef` guard stopped the second
 * effect run from starting a fresh boot. The result was `booting === true`
 * forever, but only in `npm run dev`.
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

/* ------------------------- browser environment ------------------------- */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})

globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
})
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverShim
dom.window.ResizeObserver = ResizeObserverShim

dom.window.matchMedia =
  dom.window.matchMedia ??
  ((query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }))
globalThis.matchMedia = dom.window.matchMedia

HTMLCanvasElement.prototype.getContext = () => null
HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,'

const storage = new Map()
const localStorageShim = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
}
Object.defineProperty(dom.window, 'localStorage', { value: localStorageShim, configurable: true })
globalThis.localStorage = localStorageShim

Object.defineProperty(dom.window, 'crypto', {
  value: globalThis.crypto,
  configurable: true,
  writable: true,
})
Object.defineProperty(dom.window.navigator, 'onLine', { value: true, configurable: true })

const NOISE = /not wrapped in act|React Router Future Flag|width\(0\) and height\(0\)/i
const originalError = console.error
console.error = (...args) => {
  if (NOISE.test(args.map(String).join(' '))) return
  originalError(...args)
}

/* ------------------------------ imports ------------------------------ */

const React = (await import('react')).default
const { StrictMode } = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')

const App = (await import('../src/App.jsx')).default
const { AppProvider, __resetBootForTests } = await import('../src/context/AppContext.jsx')
const { ToastProvider } = await import('../src/context/ToastContext.jsx')
const db = await import('../src/services/db.js')
const auth = await import('../src/services/auth.js')

/* ------------------------------ harness ------------------------------ */

let passed = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures.push({ name, err })
    console.error(`  FAIL ${name}\n       ${err.message}`)
  }
}

const settle = async (ms) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

let root
let container

/**
 * Mount the whole app, optionally inside StrictMode, and wait for boot.
 *
 * The stored session is cleared unless `keepSession` is set, so one test's
 * sign-in cannot change what the next one renders.
 */
async function mount({ strict = false, route = '/login', waitMs = 2500, keepSession = false } = {}) {
  if (!keepSession) localStorage.clear()
  container?.remove()
  container = document.createElement('div')
  document.body.appendChild(container)

  const tree = React.createElement(
    MemoryRouter,
    { initialEntries: [route] },
    React.createElement(
      AppProvider,
      null,
      React.createElement(ToastProvider, null, React.createElement(App, null)),
    ),
  )

  await act(async () => {
    root = createRoot(container)
    root.render(strict ? React.createElement(StrictMode, null, tree) : tree)
  })

  // Poll until the boot screen goes away, so a passing run is fast and a
  // hanging one still terminates with a useful message.
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline && /Opening the laboratory database/i.test(container.textContent)) {
    await settle(50)
  }
  return container
}

async function unmount() {
  if (!root) return
  await act(async () => root.unmount())
  root = null
}

const text = () => container?.textContent ?? ''
const stillBooting = () => /Opening the laboratory database/i.test(text())

/* -------------------------------- run -------------------------------- */

console.log('\n— cold start, empty database —')

await test('boot completes and renders the login page (no StrictMode)', async () => {
  __resetBootForTests()
  await mount({ strict: false })
  assert.equal(stillBooting(), false, 'the boot screen is still showing')
  assert.match(text(), /Sign in/i)
  await unmount()
})

await test('boot completes under React.StrictMode double-invoked effects', async () => {
  __resetBootForTests()
  await mount({ strict: true })
  assert.equal(
    stillBooting(),
    false,
    'StrictMode remount left the app stuck on the boot screen — the boot promise ' +
      'must survive an effect cleanup/re-run cycle',
  )
  assert.match(text(), /Sign in/i)
  await unmount()
})

await test('the database was actually seeded during boot', async () => {
  const tools = await db.list(db.COLLECTIONS.tools)
  const users = await db.list(db.COLLECTIONS.users)
  assert.ok(tools.length > 0, 'tools were seeded')
  assert.ok(users.length > 0, 'users were seeded')
})

console.log('\n— warm start, existing database —')

await test('a second boot over existing data still completes (StrictMode)', async () => {
  __resetBootForTests()
  await mount({ strict: true })
  assert.equal(stillBooting(), false)
  assert.match(text(), /Sign in/i)
  await unmount()
})

await test('re-booting does not duplicate seeded records', async () => {
  const before = (await db.list(db.COLLECTIONS.tools)).length
  __resetBootForTests()
  await mount({ strict: true })
  await unmount()
  const after = (await db.list(db.COLLECTIONS.tools)).length
  assert.equal(after, before, 'seeding ran again over an already-populated database')
})

console.log('\n— authentication states —')

await test('no stored session is not a boot failure', async () => {
  __resetBootForTests()
  await mount({ strict: true, route: '/dashboard' })
  assert.equal(stillBooting(), false)
  assert.match(text(), /Sign in/i, 'an unauthenticated user is sent to the login page')
  await unmount()
})

await test('a corrupt session value is discarded, not fatal', async () => {
  localStorage.clear()
  localStorage.setItem('stms.session', '{not valid json')
  __resetBootForTests()
  await mount({ strict: true, route: '/dashboard', keepSession: true })
  assert.equal(stillBooting(), false)
  assert.match(text(), /Sign in/i)
  await unmount()
})

await test('a session pointing at a deleted user is discarded', async () => {
  localStorage.clear()
  localStorage.setItem('stms.session', JSON.stringify({ userId: 'USR-9999' }))
  __resetBootForTests()
  await mount({ strict: true, route: '/dashboard', keepSession: true })
  assert.equal(stillBooting(), false)
  assert.match(text(), /Sign in/i)
  await unmount()
})

await test('a valid session boots straight into the dashboard', async () => {
  localStorage.clear()
  await auth.login('admin', 'admin123')
  __resetBootForTests()
  await mount({ strict: true, route: '/dashboard', keepSession: true })
  assert.equal(stillBooting(), false)

  // The boot is done; give the dashboard's own data hooks a moment to resolve.
  const deadline = Date.now() + 2500
  while (Date.now() < deadline && !/Total tools/i.test(text())) await settle(50)

  assert.match(text(), /Total tools/i, 'the dashboard rendered for the restored session')
  await unmount()
  localStorage.clear()
})

console.log('\n— failure handling —')

await test('a failing database shows an error screen, never an endless boot', async () => {
  __resetBootForTests({
    ready: async () => {
      throw new Error('IndexedDB is unavailable in this browser context.')
    },
  })
  await mount({ strict: true })
  assert.equal(stillBooting(), false, 'a database failure must end the boot')
  assert.match(text(), /Unable to start/i)
  assert.match(text(), /IndexedDB is unavailable/i, 'the real error is surfaced')
  assert.match(text(), /Try again/i, 'a retry control is offered')
  await unmount()
})

await test('a failing seed does not block the login page', async () => {
  __resetBootForTests({
    seed: async () => {
      throw new Error('Seeding blew up.')
    },
  })
  await mount({ strict: true })
  assert.equal(stillBooting(), false)
  assert.match(text(), /Sign in/i, 'seeding is best-effort, not a prerequisite for login')
  await unmount()
})

await test('a failing overdue sweep does not block the login page', async () => {
  __resetBootForTests({
    runOverdueCheck: async () => {
      throw new Error('Reconciliation blew up.')
    },
  })
  await mount({ strict: true })
  assert.equal(stillBooting(), false)
  assert.match(text(), /Sign in/i)
  await unmount()
})

await test('a hanging database is cut off by the boot timeout', async () => {
  __resetBootForTests({ timeoutMs: 300, ready: () => new Promise(() => {}) })
  await mount({ strict: true, waitMs: 4000 })
  assert.equal(stillBooting(), false, 'the failsafe timeout must end the boot')
  assert.match(text(), /Unable to start/i)
  assert.match(text(), /took too long/i)
  await unmount()
})

await test('retry after a failure boots successfully', async () => {
  let calls = 0
  __resetBootForTests({
    ready: async () => {
      calls++
      if (calls === 1) throw new Error('Transient database error.')
      return db.ready()
    },
  })
  await mount({ strict: true })
  assert.match(text(), /Unable to start/i)

  const retry = [...container.querySelectorAll('button')].find((b) =>
    /try again/i.test(b.textContent),
  )
  assert.ok(retry, 'the error screen offers a retry button')

  await act(async () => {
    retry.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  const deadline = Date.now() + 3000
  while (Date.now() < deadline && !/Sign in/i.test(text())) await settle(50)

  assert.equal(stillBooting(), false)
  assert.match(text(), /Sign in/i, 'the retry recovered the boot')
  await unmount()
})

await test('"Continue anyway" leaves the boot screen after a hard failure', async () => {
  __resetBootForTests({
    ready: async () => {
      throw new Error('IndexedDB is unavailable in this browser context.')
    },
  })
  await mount({ strict: true })
  assert.match(text(), /Unable to start/i)

  const proceed = [...container.querySelectorAll('button')].find((b) =>
    /continue anyway/i.test(b.textContent),
  )
  assert.ok(proceed, 'the error screen offers a way to continue')

  await act(async () => {
    proceed.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  await settle(100)
  assert.match(text(), /Sign in/i, 'the app renders instead of the error screen')
  await unmount()
})

/* ------------------------------ summary ------------------------------ */

await unmount()
console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED` : ''}\n`)
if (failures.length) {
  for (const { name, err } of failures) console.error(`FAILED: ${name}\n${err.stack ?? err}\n`)
  dom.window.close()
  process.exit(1)
}
dom.window.close()
process.exit(0)
