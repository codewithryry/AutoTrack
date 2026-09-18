import QRCode from 'qrcode'
import { APP_NAME } from './constants'
import { isNative } from './native'

/**
 * QR payload contract.
 *
 * Codes printed by this app carry JSON so a scanner can tell a tool code apart
 * from any other QR the camera happens to see:
 *
 *   { "type": "tool", "toolId": "TOOL-00001", "v": 1 }
 *
 * `parseQRPayload` is deliberately permissive on the way in: a plain
 * `TOOL-00001` string typed into the manual fallback, or a URL ending in a tool
 * id, both resolve to the same tool.
 */

export const QR_VERSION = 1
export const TOOL_ID_PATTERN = /^TOOL-\d{5,}$/i

export function buildQRPayload(toolId) {
  return JSON.stringify({ type: 'tool', toolId: String(toolId).toUpperCase(), v: QR_VERSION })
}

/**
 * @returns {{ ok: true, toolId: string } | { ok: false, error: string }}
 */
export function parseQRPayload(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, error: 'Empty QR code.' }

  // 1. Native JSON payload
  if (text.startsWith('{')) {
    try {
      const data = JSON.parse(text)
      if (data?.type !== 'tool') {
        return { ok: false, error: 'This QR code is not an equipment tag.' }
      }
      const id = normalizeToolId(data.toolId)
      if (!id) return { ok: false, error: 'QR code is missing a valid Tool ID.' }
      return { ok: true, toolId: id }
    } catch {
      return { ok: false, error: 'QR code contains unreadable data.' }
    }
  }

  // 2. A URL that ends in /tools/TOOL-00001
  if (/^https?:\/\//i.test(text)) {
    const match = text.match(/TOOL-\d{5,}/i)
    if (match) return { ok: true, toolId: match[0].toUpperCase() }
    return { ok: false, error: 'This link does not point to a laboratory tool.' }
  }

  // 3. A bare tool id, with or without the prefix
  const id = normalizeToolId(text)
  if (id) return { ok: true, toolId: id }

  return { ok: false, error: 'Unrecognised code. Expected a laboratory tool tag.' }
}

/** Accepts `TOOL-00014`, `tool-14`, or `14` and returns the canonical id. */
export function normalizeToolId(value) {
  const raw = String(value ?? '').trim().toUpperCase()
  if (!raw) return null
  if (TOOL_ID_PATTERN.test(raw)) return raw
  const digits = raw.replace(/^TOOL[-\s]?/, '')
  if (/^\d{1,6}$/.test(digits)) return `TOOL-${digits.padStart(5, '0')}`
  return null
}

/* --------------------------- rendering --------------------------- */

const BASE_OPTIONS = {
  errorCorrectionLevel: 'M', // survives a scuffed workshop label
  margin: 2,
  color: { dark: '#0B1220', light: '#FFFFFF' },
}

/** PNG data URL for on-screen display and downloads. */
export async function toDataURL(toolId, { size = 320 } = {}) {
  return QRCode.toDataURL(buildQRPayload(toolId), { ...BASE_OPTIONS, width: size, scale: 8 })
}

/** Draw directly into a canvas element (used by the tool detail panel). */
export async function drawToCanvas(canvas, toolId, { size = 320 } = {}) {
  if (!canvas) return
  await QRCode.toCanvas(canvas, buildQRPayload(toolId), {
    ...BASE_OPTIONS,
    width: size,
  })
}

export async function downloadQR(tool) {
  const url = await toDataURL(tool.id, { size: 640 })
  const a = document.createElement('a')
  a.href = url
  a.download = `${tool.id}-${slug(tool.name)}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

const slug = (s) =>
  String(s ?? 'tool')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * Open a print window containing one or more asset labels.
 * Labels are sized for a 60 × 80 mm sticker — big enough to scan from a metre
 * away, small enough to fit on a wrench rack.
 */
export async function printQRLabels(tools, meta = {}) {
  const list = Array.isArray(tools) ? tools : [tools]
  if (!list.length) return

  const labels = await Promise.all(
    list.map(async (tool) => {
      const img = await toDataURL(tool.id, { size: 420 })
      return `
        <div class="label">
          <div class="label-head">
            <span class="label-lab">${escapeHtml(meta.labName || APP_NAME)}</span>
          </div>
          <img src="${img}" alt="QR code for ${escapeHtml(tool.name)}" />
          <div class="label-id">${escapeHtml(tool.id)}</div>
          <div class="label-name">${escapeHtml(tool.name)}</div>
          <div class="label-meta">
            <span>${escapeHtml(tool.category ?? '')}</span>
            <span>${escapeHtml(tool.location ?? '')}</span>
          </div>
        </div>`
    }),
  )

  const document_ = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Tool QR Labels — ${escapeHtml(meta.labName || APP_NAME)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0; background: #fff; color: #0B1220;
    font-family: Inter, "Segoe UI", system-ui, sans-serif;
  }
  .sheet { display: flex; flex-wrap: wrap; gap: 6mm; padding: 4mm; }
  .label {
    width: 60mm; padding: 3mm; border: 1.5pt solid #0B1220; border-radius: 3mm;
    text-align: center; break-inside: avoid; page-break-inside: avoid;
  }
  .label-head {
    background: #0B1220; color: #F7C948; margin: -3mm -3mm 2.5mm; padding: 1.6mm 2mm;
    border-radius: 2mm 2mm 0 0; font-size: 7pt; font-weight: 800;
    letter-spacing: .08em; text-transform: uppercase;
  }
  .label img { width: 34mm; height: 34mm; display: block; margin: 0 auto; }
  .label-id {
    font-family: "JetBrains Mono", Consolas, monospace; font-size: 10pt;
    font-weight: 700; margin-top: 1.5mm; letter-spacing: .04em;
  }
  .label-name {
    font-size: 8.5pt; font-weight: 700; margin-top: 1mm; line-height: 1.25;
    min-height: 8mm;
  }
  .label-meta {
    display: flex; justify-content: space-between; gap: 2mm; margin-top: 1.5mm;
    padding-top: 1.5mm; border-top: .6pt dashed #94a3b8;
    font-size: 6.5pt; color: #475569; text-align: left;
  }
  @media screen {
    body { background: #eef1f6; padding: 12px; }
    .sheet { background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,.12); border-radius: 8px; }
  }
</style></head>
<body><div class="sheet">${labels.join('')}</div>
<script>
  window.addEventListener('load', function () {
    setTimeout(function () { window.focus(); window.print(); }, 350);
  });
</script>
</body></html>`

  // Inside the Android WebView there is no second window to open — `window.open`
  // returns null there, which used to surface as a "pop-ups are blocked" error
  // on a phone that never blocked anything. The same sheet is rendered into a
  // full-screen frame in the page instead, and printed from there.
  if (isNative() || !canOpenWindow()) {
    renderInPage(document_)
    return
  }

  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) {
    renderInPage(document_)
    return
  }

  win.document.write(document_)
  win.document.close()
}

/** Whether a separate window is even a possibility on this platform. */
function canOpenWindow() {
  return typeof window !== 'undefined' && typeof window.open === 'function'
}

/**
 * The label sheet as an overlay in the current page.
 *
 * The fallback for anywhere a second window cannot be had: the APK, and a
 * browser that refused the pop-up. The frame carries the same document, so the
 * sheet is identical either way, with a bar to print it and to close it again.
 */
function renderInPage(html) {
  const host = document.createElement('div')
  host.setAttribute('role', 'dialog')
  host.setAttribute('aria-label', 'Tool QR labels')
  host.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;background:#0B1220'

  const bar = document.createElement('div')
  bar.style.cssText =
    'display:flex;gap:8px;justify-content:flex-end;padding:10px 12px;' +
    'background:#0B1220;font:600 13px Inter,system-ui,sans-serif'

  const frame = document.createElement('iframe')
  frame.style.cssText = 'flex:1;width:100%;border:0;background:#eef1f6'

  const button = (label, onClick) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.style.cssText =
      'padding:8px 14px;border-radius:10px;border:0;cursor:pointer;' +
      'font:inherit;background:#F7C948;color:#0B1220'
    b.addEventListener('click', onClick)
    return b
  }

  const close = () => host.remove()

  bar.append(
    button('Print', () => {
      try {
        frame.contentWindow?.focus()
        frame.contentWindow?.print()
      } catch (err) {
        console.warn('[qr] the labels could not be printed', err)
      }
    }),
    button('Close', close),
  )

  host.append(bar, frame)
  document.body.append(host)

  // `srcdoc` keeps the sheet on this origin, so the frame's own print script and
  // the button above both reach it.
  frame.srcdoc = html
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
}
