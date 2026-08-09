/**
 * UI smoke test.
 *
 * Mounts the real application in jsdom, signs in as each demo role and walks
 * every route, failing on any React error, unhandled rejection or console
 * error. This catches the runtime faults a production build cannot — missing
 * components, bad hook usage, undefined props — without a browser.
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

/* ------------------------- browser environment ------------------------- */

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})

globalThis.window = dom.window
globalThis.document = dom.window.document
// Node 22 defines `navigator` as a getter-only global, so it must be redefined.
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
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.KeyboardEvent = dom.window.KeyboardEvent
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// jsdom ships neither of these; recharts and the layout hooks need them.
class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverShim
dom.window.ResizeObserver = ResizeObserverShim

if (!dom.window.matchMedia) {
  dom.window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })
}
globalThis.matchMedia = dom.window.matchMedia

// Canvas is not implemented in jsdom; the QR renderer only needs a context.
HTMLCanvasElement.prototype.getContext = function getContext() {
  return {
    canvas: this,
    fillRect() {},
    clearRect() {},
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData() {},
    drawImage() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    measureText: () => ({ width: 0 }),
    fillText() {},
    beginPath() {},
    closePath() {},
    stroke() {},
    fill() {},
    moveTo() {},
    lineTo() {},
    rect() {},
    setTransform() {},
  }
}
HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,'

const storage = new Map()
const localStorageShim = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
  key: (i) => [...storage.keys()][i] ?? null,
  get length() {
    return storage.size
  },
}
Object.defineProperty(dom.window, 'localStorage', { value: localStorageShim, configurable: true })
globalThis.localStorage = localStorageShim

// The app hashes passwords with WebCrypto; jsdom's window needs Node's implementation.
Object.defineProperty(dom.window, 'crypto', {
  value: globalThis.crypto,
  configurable: true,
  writable: true,
})
Object.defineProperty(dom.window.navigator, 'onLine', { value: true, configurable: true })

/* --------------------------- error collection --------------------------- */

const problems = []
const originalError = console.error

/**
 * Noise that comes from the test environment rather than the application:
 * jsdom has no layout engine (so Recharts cannot measure its container), and
 * act() warnings fire for the async database reads that settle after a render.
 */
const ENVIRONMENT_NOISE =
  /React Router Future Flag|not wrapped in act|width\(0\) and height\(0\)|Not implemented: HTMLCanvasElement/i

console.error = (...args) => {
  const text = args.map(String).join(' ')
  if (ENVIRONMENT_NOISE.test(text)) return
  problems.push(text)
  originalError(...args)
}
console.warn = (...args) => {
  const text = args.map(String).join(' ')
  if (ENVIRONMENT_NOISE.test(text)) return
  originalError(...args)
}

process.on('unhandledRejection', (reason) => {
  problems.push(`Unhandled rejection: ${reason?.stack ?? reason}`)
})

/* ------------------------------ imports ------------------------------ */

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')

const App = (await import('../src/App.jsx')).default
const { AppProvider } = await import('../src/context/AppContext.jsx')
const { ToastProvider } = await import('../src/context/ToastContext.jsx')
const db = await import('../src/services/db.js')
const { seedDatabase } = await import('../src/data/seed.js')
const auth = await import('../src/services/auth.js')

/* ------------------------------ harness ------------------------------ */

let passed = 0
const failures = []

async function test(name, fn) {
  const mark = problems.length
  try {
    await fn()
    const newProblems = problems.slice(mark)
    if (newProblems.length) {
      throw new Error(`console errors:\n       ${newProblems.join('\n       ')}`)
    }
    passed++
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures.push({ name, err })
    console.error(`  FAIL ${name}\n       ${err.message}`)
  }
}

const settle = async (ms = 60) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

let root
let container

async function mountAt(route) {
  container?.remove()
  container = document.createElement('div')
  document.body.appendChild(container)

  await act(async () => {
    root = createRoot(container)
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [route] },
        React.createElement(
          AppProvider,
          null,
          React.createElement(ToastProvider, null, React.createElement(App, null)),
        ),
      ),
    )
  })
  // Two passes: the first lets the boot sequence finish, the second lets the
  // page's own data hooks resolve against IndexedDB.
  await settle(200)
  await settle(200)
  return container
}

async function unmount() {
  if (!root) return
  await act(async () => root.unmount())
  root = null
}

const text = () => container?.textContent ?? ''

/* -------------------------------- run -------------------------------- */

console.log('\n— boot —')

await db.ready()
await seedDatabase()

await test('the app boots and shows the login screen when signed out', async () => {
  await mountAt('/dashboard')
  assert.match(text(), /Sign in/i)
  assert.match(text(), /Demo accounts/i)
  await unmount()
})

console.log('\n— routes as Admin —')

const ROUTES = [
  ['/dashboard', /Total tools/i],
  ['/tools', /Tool inventory/i],
  ['/tools/TOOL-00001', /Tool record/i],
  ['/tools/TOOL-00001/history', /Activity timeline/i],
  ['/scan', /Scan a tool/i],
  ['/borrow', /Borrow a tool/i],
  ['/return', /Return a tool/i],
  ['/transactions', /Transactions/i],
  ['/users', /Users/i],
  ['/notifications', /Notifications/i],
  ['/maintenance', /Maintenance/i],
  ['/reports', /Reports/i],
  ['/settings', /Settings/i],
]

await auth.login('admin', 'admin123')

for (const [route, expected] of ROUTES) {
  await test(`renders ${route}`, async () => {
    await mountAt(route)
    assert.match(text(), expected, `expected ${expected} on ${route}`)
    await unmount()
  })
}

await test('an unknown route shows the not-found page', async () => {
  await mountAt('/does-not-exist')
  assert.match(text(), /Page not found/i)
  await unmount()
})

console.log('\n— dashboard reflects the database —')

await test('dashboard totals match the tool records', async () => {
  const tools = await db.list(db.COLLECTIONS.tools)
  await mountAt('/dashboard')
  const body = text()
  assert.ok(body.includes(String(tools.length)), 'total tool count is rendered')
  assert.match(body, /Recent transactions/i)
  assert.match(body, /Utilisation/i)
  await unmount()
})

console.log('\n— routes as Instructor —')

auth.logout()
await auth.login('instructor', 'instructor123')

await test('an instructor reaches reports and users', async () => {
  await mountAt('/reports')
  assert.match(text(), /Return rate/i)
  await unmount()
  await mountAt('/users')
  assert.match(text(), /accounts/i)
  await unmount()
})

await test('an instructor is blocked from nothing they should reach', async () => {
  await mountAt('/maintenance')
  assert.match(text(), /Service schedule/i)
  await unmount()
})

console.log('\n— routes as Student —')

auth.logout()
await auth.login('student', 'student123')

await test('a student can scan, borrow, return and see their transactions', async () => {
  for (const route of ['/scan', '/borrow', '/return', '/transactions', '/notifications']) {
    await mountAt(route)
    assert.ok(text().length > 50, `${route} rendered content`)
    await unmount()
  }
})

await test('a student is refused the restricted areas', async () => {
  for (const route of ['/users', '/reports']) {
    await mountAt(route)
    assert.match(text(), /Restricted area/i, `${route} should be restricted`)
    await unmount()
  }
})

await test('a student sees the tools list but no Add tool control', async () => {
  await mountAt('/tools')
  const body = text()
  assert.match(body, /Tool inventory/i)
  assert.ok(!/Add tool/i.test(body), 'the Add tool button is hidden for students')
  await unmount()
})

await test("a student's transaction list is scoped to their own records", async () => {
  const me = await auth.restore()
  const all = await db.list(db.COLLECTIONS.transactions)
  const mine = all.filter((t) => t.userId === me.id)
  await mountAt('/transactions')
  const body = text()
  const foreign = all.find((t) => t.userId !== me.id)
  assert.ok(mine.length > 0, 'the demo student has transactions')
  assert.ok(!body.includes(foreign.id), 'another user\'s transaction id is not shown')
  await unmount()
})

/* ------------------------------ summary ------------------------------ */

await unmount()

console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED` : ''}\n`)
if (failures.length) {
  for (const { name, err } of failures) console.error(`FAILED: ${name}\n${err.stack ?? err}\n`)
  process.exit(1)
}

// jsdom keeps timers and its window alive, so exit explicitly.
dom.window.close()
process.exit(0)
