/**
 * Measures the walkthrough and the mascot in a real browser against
 * /probe.html on the dev server. Not part of the project — a throwaway check.
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const VIEWPORTS = [
  { name: 'phone  390x844', width: 390, height: 844 },
  { name: 'phone  360x640', width: 360, height: 640 },
  { name: 'tablet 820x1180', width: 820, height: 1180 },
  { name: 'desktop 1440x900', width: 1440, height: 900 },
]

let pass = 0
let fail = 0
const ok = (name) => {
  pass += 1
  console.log(`  ok  ${name}`)
}
const bad = (name, detail) => {
  fail += 1
  console.log(`  FAIL ${name}\n       ${detail}`)
}
const check = (cond, name, detail) => (cond ? ok(name) : bad(name, detail))

const browser = await chromium.launch()

for (const vp of VIEWPORTS) {
  console.log(`\n— ${vp.name} —`)
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`${BASE}/probe.html`)
  await page.waitForSelector('[role="dialog"]')
  await page.waitForTimeout(900)

  for (let step = 0; step < 3; step += 1) {
    const geo = await page.evaluate(() => {
      const ring = document.querySelector('[role="dialog"] > div[style*="box-shadow"]')
      const card = document.querySelector('[role="dialog"] .card')
      const nav = document.querySelector('nav[aria-label="Primary"]')
      const header = document.querySelector('header')
      const scroller = document.scrollingElement
      const r = (el) => {
        if (!el) return null
        const b = el.getBoundingClientRect()
        return { top: b.top, left: b.left, right: b.right, bottom: b.bottom, w: b.width, h: b.height }
      }
      return {
        ring: r(ring),
        card: r(card),
        nav: r(nav),
        header: r(header),
        title: document.querySelector('[role="dialog"] h2')?.textContent,
        mascot: !!document.querySelector('[role="dialog"] svg[aria-label^="Assistant"]'),
        buttons: [...document.querySelectorAll('[role="dialog"] button')].map((b) => ({
          text: b.textContent.trim(),
          ...r(b),
        })),
        scrollTop: scroller.scrollTop,
        vw: window.innerWidth,
        vh: window.innerHeight,
        cardScrolls: card ? card.scrollHeight > card.clientHeight + 1 : false,
      }
    })

    const tag = `step ${step + 1} (${geo.title})`
    const { ring, card, nav, header, vw, vh } = geo

    check(!!ring, `${tag}: the target is highlighted`, 'no spotlight ring rendered')
    if (ring) {
      check(
        ring.left >= 0 && ring.right <= vw + 0.5 && ring.top >= 0 && ring.bottom <= vh + 0.5,
        `${tag}: the highlight is inside the viewport`,
        `ring ${JSON.stringify(ring)} vs ${vw}x${vh}`,
      )
      check(ring.w > 40 && ring.h > 20, `${tag}: the highlight has a visible area`, JSON.stringify(ring))
      check(
        !nav || ring.top >= nav.top - 0.5 || ring.bottom <= nav.top + 0.5,
        `${tag}: the highlight clears the bottom bar`,
        `ring.bottom ${ring.bottom} vs nav.top ${nav?.top}`,
      )
    }

    check(!!card, `${tag}: the card is rendered`, 'no card')
    if (card) {
      check(
        card.left >= 0 && card.right <= vw + 0.5 && card.top >= 0 && card.bottom <= vh + 0.5,
        `${tag}: the card is fully on screen`,
        `card ${JSON.stringify(card)} vs ${vw}x${vh}`,
      )
      check(
        !header || card.top >= header.bottom - 0.5,
        `${tag}: the card clears the header`,
        `card.top ${card.top} vs header.bottom ${header?.bottom}`,
      )
      check(
        !nav || card.bottom <= nav.top + 0.5,
        `${tag}: the card clears the bottom bar`,
        `card.bottom ${card.bottom} vs nav.top ${nav?.top}`,
      )
      check(!geo.cardScrolls, `${tag}: the card does not scroll inside itself`, 'card overflows')
    }

    check(geo.mascot, `${tag}: the mascot is in the card`, 'no mascot svg')
    for (const b of geo.buttons) {
      check(
        b.top >= 0 && b.bottom <= vh + 0.5 && b.left >= 0 && b.right <= vw + 0.5,
        `${tag}: the "${b.text}" control is on screen`,
        JSON.stringify(b),
      )
    }
    if (ring && card) {
      const gap =
        card.bottom <= ring.top ? ring.top - card.bottom : card.top >= ring.bottom ? card.top - ring.bottom : 0
      check(gap <= 40, `${tag}: the message sits next to the highlight`, `${gap}px away`)
    }

    if (step < 2) {
      const before = geo.scrollTop
      await page.getByRole('button', { name: 'Next' }).click()
      await page.waitForTimeout(900)
      const after = await page.evaluate(() => document.scrollingElement.scrollTop)
      if (step === 0) {
        check(
          Math.abs(after - before) < 4 || after > before,
          'stepping forward never scrolls backwards up the page',
          `${before} → ${after}`,
        )
      }
    }
  }

  check(errors.length === 0, 'no console errors', errors.join(' | '))
  await page.close()
}

/* ------------------------------ mascot behaviour ------------------------------ */
console.log('\n— mascot —')
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`${BASE}/probe.html`)
  await page.waitForSelector('[role="dialog"]')
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.waitForTimeout(300)

  const bubbles = () => page.locator('body > [role="status"]').count()
  check((await bubbles()) === 0, 'online: the mascot says nothing unprompted', 'a bubble is showing')

  // the hero mascot: a tap gives one contextual line about this screen
  const hero = page.locator('main [data-mascot-state] button')
  await hero.click()
  await page.waitForTimeout(400)
  check((await bubbles()) === 1, 'tapping the mascot answers with a line', 'no bubble on tap')
  const said = await page.locator('body > [role="status"]').innerText()
  check(!/^h(i|ello)\b/i.test(said), 'the line is not a generic greeting', said)
  check(/screen|scan|borrow|due/i.test(said), 'the line is about this page', said)
  const heroBox = await page.locator('body > [role="status"]').boundingBox()
  check(
    heroBox.x >= 0 && heroBox.y >= 0 && heroBox.x + heroBox.width <= 390.5,
    'the bubble is inside the viewport',
    JSON.stringify(heroBox),
  )
  await page.locator('body > [role="status"]').click()
  await page.waitForTimeout(200)

  // the shell mascot: same behaviour, different pose and different lines
  const barState = await page.getAttribute('header [data-mascot-state]', 'data-mascot-state')
  check(barState === 'inspecting', 'the bar mascot takes the route’s pose', String(barState))
  await page.locator('header [data-mascot-state] button').click()
  await page.waitForTimeout(400)
  const barLine = await page.locator('body > [role="status"]').innerText()
  check(/tool/i.test(barLine), 'the bar mascot speaks for its own page', barLine)
  const barBox = await page.locator('body > [role="status"]').boundingBox()
  check(
    barBox.y >= 0 && barBox.y + barBox.height <= 844.5 && barBox.x >= 0,
    'a bubble near the top flips below the mascot and stays on screen',
    JSON.stringify(barBox),
  )
  await page.locator('body > [role="status"]').click()
  await page.waitForTimeout(200)

  await page.getByRole('button', { name: 'toggle' }).click() // -> offline
  await page.waitForTimeout(400)
  check((await bubbles()) === 2, 'offline: a notice appears with no interaction', 'no bubble')
  const text = await page.locator('body > [role="status"]').first().innerText()
  check(/offline/i.test(text), 'the notice says what is wrong', text)
  const state = await page.getAttribute('main [data-mascot-state]', 'data-mascot-state')
  check(state === 'offline', 'the figure switches to its offline face', String(state))
  const box = await page.locator('body > [role="status"]').first().boundingBox()
  check(
    box.x >= 0 && box.y >= 0 && box.x + box.width <= 390.5 && box.y + box.height <= 844.5,
    'the notice is inside the viewport',
    JSON.stringify(box),
  )

  await page.getByRole('button', { name: 'toggle' }).click() // -> online
  await page.waitForTimeout(400)
  check((await bubbles()) === 0, 'back online: the notice is removed', 'bubble still showing')

  // dismissed while still offline, it must stay dismissed across re-renders
  await page.getByRole('button', { name: 'toggle' }).click()
  await page.waitForTimeout(300)
  const shown = await page.locator('body > [role="status"]').count()
  for (let i = 0; i < shown; i += 1) await page.locator('body > [role="status"]').first().click()
  await page.waitForTimeout(200)
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await page.waitForTimeout(300)
  check((await bubbles()) === 0, 'a dismissed notice does not come back on a re-render', 'bubble returned')
  await page.close()
}

await browser.close()
console.log(`\n${pass} checks passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
