/**
 * Real-browser smoke test against a running dev server.
 *
 *   npm run dev
 *   node scripts/verify-browser.mjs [baseURL]
 *
 * Without credentials it checks the parts that need no account: the shell leaves
 * its loading state, an unauthenticated visit to a protected route lands on
 * /login, and nothing throws in the console.
 *
 * With credentials for a real account it also signs in and verifies the
 * role's sidebar and its route guards:
 *
 *   STMS_EMAIL=student@autolab.edu.ph STMS_PASSWORD=… STMS_ROLE=Student \
 *     node scripts/verify-browser.mjs
 *
 * A reachable backend is required — this drives the real client, so the account
 * must exist in whichever project `.env` points at. Prefer a scratch project
 * over production if a run might create or change records.
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const EMAIL = process.env.STMS_EMAIL
const PASSWORD = process.env.STMS_PASSWORD
const ROLE = process.env.STMS_ROLE ?? 'Admin'

/** The sidebar each role must get — the same matrix as verify-guards. */
const SIDEBARS = {
  Admin: [
    'Dashboard',
    'Tools',
    'Scan',
    'Borrow / Return',
    'Transactions',
    'Users',
    'Maintenance',
    'Notifications',
    'Reports',
    'Settings',
  ],
  Instructor: [
    'Dashboard',
    'Tools',
    'Scan',
    'Borrow / Return',
    'Transactions',
    'Maintenance',
    'Notifications',
  ],
  Student: ['Dashboard', 'Tools', 'Scan', 'Borrow / Return', 'Transactions', 'Notifications'],
}

/** Routes each role must be refused, even when typed into the address bar. */
const FORBIDDEN = {
  Admin: [],
  Instructor: ['/users', '/reports', '/settings'],
  Student: ['/users', '/reports', '/settings', '/maintenance'],
}

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

async function newPage() {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(`Uncaught: ${err.message}`))
  page.errors = errors
  return { page, ctx }
}

/** The shell holds a boot screen until the session has resolved. */
async function waitForApp(page, timeout = 30_000) {
  await page.waitForFunction(
    () => !document.body.innerText.includes('Checking your laboratory session'),
    undefined,
    { timeout },
  )
}

section('public homepage')

{
  const { page, ctx } = await newPage()

  await test('the homepage is reachable without an account', async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    // `innerText` reflects CSS, so uppercased headings come back uppercased.
    const text = await page.locator('body').innerText()
    assert.match(text, /Smart Tool Management for/i, 'the hero headline is missing')
    assert.match(text, /Automotive Laboratory Tool Management System/i, 'the subtitle is missing')
    assert.match(page.url(), /\/$/, `expected to stay on /, got ${page.url()}`)
  })

  await test('every homepage section is present', async () => {
    const text = await page.locator('body').innerText()
    for (const marker of [
      'Tool Management',
      'Borrow & Return',
      'Real-Time Monitoring',
      'Transaction Tracking',
      'Role-Based Access',
      'Maintenance Monitoring',
      'Sign in to your account',
      'Administrator',
      'Instructor',
      'Student',
      'Ready to manage your laboratory tools smarter?',
      'SMART TOOL MONITORING SYSTEM',
    ]) {
      assert.ok(text.includes(marker) || text.includes(marker.toUpperCase()), `missing: ${marker}`)
    }
  })

  await test('the page does not scroll horizontally on a phone', async () => {
    await page.setViewportSize({ width: 360, height: 740 })
    await page.waitForTimeout(150)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    assert.ok(overflow <= 1, `horizontal overflow of ${overflow}px at 360px wide`)
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  await test('Get Started goes to /signup', async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await page.getByRole('link', { name: 'Get Started' }).first().click()
    await page.waitForURL(/\/signup$/, { timeout: 15_000 })
    await page.waitForSelector('#email')
    const text = await page.locator('body').innerText()
    assert.match(text, /Create account/)
  })

  await test('Sign In goes to /login', async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await page.getByRole('link', { name: 'Sign In' }).first().click()
    await page.waitForURL(/\/login$/, { timeout: 15_000 })
    await page.waitForSelector('#password')
  })

  await test('the sign-up form refuses an incomplete submission', async () => {
    await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await page.click('button[type=submit]')
    const text = await page.locator('body').innerText()
    assert.match(text, /Please enter your first name/)
    assert.match(text, /Please enter your email address|Please enter a valid email address/)
    assert.match(page.url(), /\/signup$/, 'an invalid form must not navigate')
  })

  await test('the sign-up form never offers an administrator role', async () => {
    // Only the role titles matter: the instructor card legitimately mentions
    // administrator approval in its supporting text.
    const choices = await page.locator('button[aria-pressed]').allInnerTexts()
    assert.ok(choices.length >= 2, 'the role choice is missing')
    const titles = choices.map((c) => c.split('\n').find(Boolean)?.trim())
    assert.deepEqual(titles, ['Student', 'Instructor'], `unexpected role choices: ${titles}`)
    // And no free-text or select control that could smuggle one in.
    assert.equal(await page.locator('select[name=role], #role').count(), 0)
  })

  await test('password rules are enforced before the backend is called', async () => {
    await page.fill('#email', 'someone@autolab.edu.ph')
    await page.fill('#password', 'short')
    await page.click('button[type=submit]')
    const text = await page.locator('body').innerText()
    assert.match(text, /at least 8 characters/)
  })

  await test('no console errors across the public pages', async () => {
    assert.deepEqual(page.errors, [])
  })

  await ctx.close()
}

section('unauthenticated access')

{
  const { page, ctx } = await newPage()

  await test('the login route shows the sign-in form', async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await page.waitForSelector('#email', { timeout: 15_000 })
    assert.ok(await page.locator('#password').count(), 'password field missing')
  })

  await test('a protected route redirects to /login', async () => {
    await page.goto(`${BASE}/users`, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await page.waitForSelector('#email', { timeout: 15_000 })
    assert.match(page.url(), /\/login$/, `expected /login, got ${page.url()}`)
  })

  await test('the login screen offers no demo credentials', async () => {
    const text = await page.locator('body').innerText()
    assert.doesNotMatch(text, /admin123|instructor123|student123/, 'a demo password is on screen')
  })

  await test('no console errors on the login screen', async () => {
    assert.deepEqual(page.errors, [])
  })

  await ctx.close()
}

if (!EMAIL || !PASSWORD) {
  section('signed-in checks skipped')
  console.log('  Set STMS_EMAIL, STMS_PASSWORD and STMS_ROLE to run them.')
} else {
  section(`signed in as ${ROLE}`)
  const { page, ctx } = await newPage()

  await test('sign-in reaches the dashboard', async () => {
    // `/` is the public homepage now; the form lives on /login.
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await page.waitForSelector('#email', { timeout: 20_000 })
    await page.fill('#email', EMAIL)
    await page.fill('#password', PASSWORD)
    await page.click('button[type=submit]')
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
  })

  await test('the sidebar matches the role', async () => {
    const links = await page.locator('aside nav a').allInnerTexts()
    const labels = links.map((l) => l.split('\n')[0].trim()).filter(Boolean)
    assert.deepEqual(labels, SIDEBARS[ROLE], `unexpected navigation for ${ROLE}`)
  })

  await test('forbidden routes show the restricted page', async () => {
    for (const route of FORBIDDEN[ROLE]) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
      await waitForApp(page)
      const text = await page.locator('body').innerText()
      assert.match(text, /Restricted area/, `${route} was not refused for ${ROLE}`)
    }
  })

  await test('the session survives a reload', async () => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    assert.match(page.url(), /\/dashboard/, 'the reload lost the session')
    const text = await page.locator('body').innerText()
    assert.doesNotMatch(text, /Sign in/, 'the reload bounced to the login screen')
  })

  await test('no console errors while signed in', async () => {
    const ignorable = /favicon|Download the React DevTools/i
    assert.deepEqual(page.errors.filter((e) => !ignorable.test(e)), [])
  })

  await ctx.close()
}

await browser.close()

console.log(`\n${passed} checks passed, ${failures.length} failed\n`)
if (failures.length) process.exit(1)
