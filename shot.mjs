import { chromium } from 'playwright'
const b = await chromium.launch()
for (const [name, w, h] of [['phone', 390, 844], ['desktop', 1280, 900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  const errors = []
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto('http://localhost:5173/probe.html?header=1')
  await p.waitForTimeout(900)
  await p.screenshot({ path: `shot-header-${name}.png`, fullPage: true })
  if (errors.length) console.log(name, errors)
}
const q = await b.newPage({ viewport: { width: 390, height: 844 } })
await q.goto('http://localhost:5173/probe.html')
await q.waitForTimeout(1000)
await q.screenshot({ path: 'shot-tour.png' })
await b.close()
