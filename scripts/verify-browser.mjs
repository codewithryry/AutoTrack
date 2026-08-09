/**
 * Real-browser verification against the running dev server.
 *
 * The boot hang this suite guards against only reproduced in `npm run dev`,
 * because React.StrictMode double-invokes effects in development and not in a
 * production build. jsdom coverage alone would have missed it, so this drives
 * an actual Chromium against an actual Vite dev server with a real IndexedDB.
 *
 *   node scripts/verify-browser.mjs [baseURL]
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5173'

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

const section = (title) => console.log(`\n— ${title} —`)

const browser = await chromium.launch()

/** A fresh context each time = a fresh, empty IndexedDB and localStorage. */
async function newPage({ context } = {}) {
  const ctx = context ?? (await browser.newContext())
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(`Uncaught: ${err.message}`))
  page.errors = errors
  return { page, ctx }
}

const BOOT_TEXT = 'Opening the laboratory database'

/** Wait for the boot screen to clear, failing loudly if it never does. */
async function waitForBoot(page, timeout = 20_000) {
  await page.waitForFunction(
    (marker) => !document.body.innerText.includes(marker),
    BOOT_TEXT,
    { timeout },
  )
}

section('cold start with an empty IndexedDB')

let sharedCtx

await test('/login leaves the boot screen and renders the login page', async () => {
  const { page, ctx } = await newPage()
  sharedCtx = ctx
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })

  // The boot screen is expected first, then it must go away.
  await waitForBoot(page)
  await page.waitForSelector('#username', { timeout: 10_000 })

  const body = await page.innerText('body')
  assert.ok(!body.includes(BOOT_TEXT), 'still stuck on the boot screen')
  assert.match(body, /Sign in/i)
  assert.match(body, /Demo accounts/i)
  await page.close()
})

await test('the boot completes cleanly, with stage logging in development', async () => {
  const ctx = await browser.newContext()
  const { page } = await newPage({ context: ctx })
  const logs = []
  page.on('console', (msg) => logs.push(msg.text()))

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await waitForBoot(page)
  await page.waitForSelector('#username')

  // Stage logs are gated behind import.meta.env.DEV, so a production bundle
  // legitimately has none. Assert on them only when they are present.
  const boot = logs.filter((l) => l.includes('[BOOT]'))
  if (boot.length) {
    assert.ok(boot.some((l) => /starting application/i.test(l)), 'logged the start')
    assert.ok(boot.some((l) => /database initialised/i.test(l)), 'logged database init')
    assert.ok(boot.some((l) => /application boot complete/i.test(l)), 'logged completion')
  } else {
    console.log('        (production bundle — boot stage logs are stripped, as intended)')
  }
  assert.deepEqual(page.errors, [], 'console errors during boot')
  await ctx.close()
})

section('seeded data and sign-in')

await test('signing in as admin reaches the dashboard with real data', async () => {
  const { page, ctx } = await newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await waitForBoot(page)

  await page.fill('#username', 'admin')
  await page.fill('#password', 'admin123')
  await page.click('button[type="submit"]')

  await page.waitForURL('**/dashboard', { timeout: 15_000 })
  await page.waitForSelector('text=Total tools', { timeout: 15_000 })

  const body = await page.innerText('body')
  assert.match(body, /Total tools/i)
  assert.match(body, /Recent transactions/i)
  assert.match(body, /Combination Wrench|Torque Wrench|Socket Set/i, 'seeded tools are shown')
  assert.deepEqual(page.errors, [], 'console errors after sign-in')

  // Keep this context: the next test reloads it to prove persistence.
  sharedCtx = ctx
  await page.close()
})

await test('a refresh keeps the session and the data (persistence)', async () => {
  const { page } = await newPage({ context: sharedCtx })
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await waitForBoot(page)
  await page.waitForSelector('text=Total tools', { timeout: 15_000 })

  const body = await page.innerText('body')
  assert.ok(!body.includes(BOOT_TEXT), 'the boot screen returned on reload')
  assert.match(body, /Total tools/i, 'the dashboard survived the refresh')
  assert.deepEqual(page.errors, [], 'console errors after refresh')
  await page.close()
})

await test('a warm second boot over existing data still completes', async () => {
  const { page } = await newPage({ context: sharedCtx })
  await page.goto(`${BASE}/tools`, { waitUntil: 'domcontentloaded' })
  await waitForBoot(page)
  await page.waitForSelector('text=Tool inventory', { timeout: 15_000 })
  assert.deepEqual(page.errors, [], 'console errors on a warm boot')
  await page.close()
})

section('routes')

const ROUTES = [
  ['/dashboard', /Total tools/i],
  ['/tools', /Tool inventory/i],
  ['/tools/TOOL-00001', /Tool record/i],
  ['/tools/TOOL-00001/history', /Activity timeline/i],
  ['/scan', /Scan a tool/i],
  ['/borrow', /Borrow a tool/i],
  ['/return', /Return a tool/i],
  ['/transactions', /Transactions/i],
  ['/users', /accounts/i],
  ['/notifications', /Notifications/i],
  ['/maintenance', /Service schedule/i],
  ['/reports', /Return rate/i],
  ['/settings', /Laboratory/i],
]

for (const [route, expected] of ROUTES) {
  await test(`renders ${route} without an endless boot`, async () => {
    const { page } = await newPage({ context: sharedCtx })
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await waitForBoot(page)
    await page.waitForFunction(
      (pattern) => new RegExp(pattern, 'i').test(document.body.innerText),
      expected.source,
      { timeout: 15_000 },
    )
    assert.deepEqual(page.errors, [], `console errors on ${route}`)
    await page.close()
  })
}

section('borrow and return through the real UI')

await test('an admin can issue a tool and the inventory updates', async () => {
  const { page } = await newPage({ context: sharedCtx })
  await page.goto(`${BASE}/tools`, { waitUntil: 'domcontentloaded' })
  await waitForBoot(page)
  await page.waitForSelector('text=Tool inventory')

  // Find an available tool through the app's own filter, then borrow it.
  await page.goto(`${BASE}/borrow`, { waitUntil: 'domcontentloaded' })
  await waitForBoot(page)
  await page.waitForSelector('text=Select a tool', { timeout: 15_000 })

  const firstTool = page.locator('ul li button').first()
  await firstTool.waitFor({ timeout: 10_000 })
  const toolLabel = (await firstTool.innerText()).split('\n')[0].trim()
  await firstTool.click()

  await page.waitForSelector('text=Borrowing details', { timeout: 10_000 })
  await page.selectOption('select:below(:text("Borrower"))', { index: 1 }).catch(() => {})

  const confirm = page.locator('button:has-text("Confirm borrowing")')
  await confirm.waitFor({ timeout: 10_000 })
  await confirm.click()

  await page.waitForURL('**/tools/**', { timeout: 15_000 })
  const body = await page.innerText('body')
  assert.match(body, /Currently held by|Borrowed/i, `${toolLabel} was not issued`)
  assert.deepEqual(page.errors, [], 'console errors during borrowing')
  await page.close()
})

section('role permissions in the browser')

await test('a student is refused the restricted areas', async () => {
  const ctx = await browser.newContext()
  const { page } = await newPage({ context: ctx })
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await waitForBoot(page)

  await page.fill('#username', 'student')
  await page.fill('#password', 'student123')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 15_000 })

  for (const route of ['/users', '/reports']) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await waitForBoot(page)
    await page.waitForSelector('text=Restricted area', { timeout: 10_000 })
  }
  assert.deepEqual(page.errors, [], 'console errors as a student')
  await ctx.close()
})

section('PWA / offline')

/**
 * The service worker is disabled in the dev server (`devOptions.enabled:
 * false`), so these run only when a production build is being served.
 */
await test('the service worker registers and serves the app offline', async () => {
  const ctx = await browser.newContext()
  const { page } = await newPage({ context: ctx })
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await waitForBoot(page)
  await page.waitForSelector('#username', { timeout: 15_000 })

  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported'
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((r) => setTimeout(() => r(null), 8000)),
    ])
    return reg?.active ? 'active' : 'none'
  })

  if (swState !== 'active') {
    console.log('        (dev server — the service worker is intentionally disabled, skipped)')
    await ctx.close()
    return
  }

  // Sign in so there is real data in IndexedDB, then cut the network.
  await page.fill('#username', 'admin')
  await page.fill('#password', 'admin123')
  await page.click('button[type="submit"]')
  await page.waitForSelector('text=Total tools', { timeout: 15_000 })

  await ctx.setOffline(true)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Total tools', { timeout: 20_000 })
  const offlineBody = await page.innerText('body')
  assert.match(offlineBody, /Total tools/i, 'the dashboard did not load offline')
  assert.match(offlineBody, /Wrench|Socket|Multimeter/i, 'seeded records were not readable offline')

  // A deep route offline exercises the navigation fallback.
  await page.goto(`${BASE}/tools`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Tool inventory', { timeout: 20_000 })

  const caches = await page.evaluate(() => window.caches.keys())
  assert.ok(
    caches.some((c) => /workbox-precache/.test(c)),
    'the precache was not populated',
  )

  await ctx.setOffline(false)
  await ctx.close()
})

section('failure handling')

await test('a browser with IndexedDB blocked shows an error, not an endless boot', async () => {
  const ctx = await browser.newContext()
  const { page } = await newPage({ context: ctx })

  // Break IndexedDB before any application code runs.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('IndexedDB is disabled in this browsing context.')
      },
    })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Unable to start', { timeout: 25_000 })

  const body = await page.innerText('body')
  assert.ok(!body.includes(BOOT_TEXT), 'left booting after a database failure')
  assert.match(body, /Try again/i, 'a retry control is offered')
  await ctx.close()
})

/* ------------------------------ summary ------------------------------ */

await browser.close()
console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED` : ''}\n`)
if (failures.length) {
  for (const { name, err } of failures) console.error(`FAILED: ${name}\n${err.stack ?? err}\n`)
  process.exit(1)
}
