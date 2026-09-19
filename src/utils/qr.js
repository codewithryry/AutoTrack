import QRCode from 'qrcode'
import { APP_NAME } from './constants'
import { isNative } from './native'
import { buildQRPayload } from './qrPayload'

/**
 * The payload helpers live in `utils/qrPayload.js` and are re-exported here.
 *
 * They are pure string work; this module also imports the `qrcode` library to
 * draw and print labels. Keeping them together meant anything that merely built
 * a payload string — `services/tools.js`, reached from every screen — pulled
 * the drawing library in with it. The re-export keeps every existing import
 * path working unchanged.
 *
 * `buildQRPayload` is *imported* above as well as re-exported below, and the two
 * lines are not redundant: `export { x } from './m'` forwards the name to this
 * module's consumers without binding it inside this module, so the calls in
 * `toDataURL` and `drawToCanvas` below would throw "buildQRPayload is not
 * defined" at runtime — which is exactly what they did. The import is what makes
 * the name usable here; the re-export is what keeps `utils/qr` a valid source of
 * it for everything else.
 */
export {
  QR_VERSION,
  TOOL_ID_PATTERN,
  buildQRPayload,
  parseQRPayload,
  normalizeToolId,
} from './qrPayload'

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
 *
 * Each label carries the QR code, the tool id and the tool name, and nothing
 * else. Three fit across an A4 sheet; the code is 46mm square, which is large
 * enough to read from across a workshop and to survive a scuffed sticker.
 */
export async function printQRLabels(tools, meta = {}) {
  const list = Array.isArray(tools) ? tools : [tools]
  if (!list.length) return

  const labels = await Promise.all(
    list.map(async (tool) => {
      const img = await toDataURL(tool.id, { size: 420 })
      // The code, the id, the name. Nothing else: a label is read at arm's
      // length in a workshop, and every extra line was space the code could
      // have used. The branding, category and location were dropped for that
      // reason — the id is what identifies the tool, and the name is what a
      // person recognises it by.
      return `
        <div class="label">
          <img src="${img}" alt="QR code for ${escapeHtml(tool.name)}" />
          <div class="label-id">${escapeHtml(tool.id)}</div>
          <div class="label-name">${escapeHtml(tool.name)}</div>
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
  /* Sized to the page rather than by eye. An A4 sheet is 210mm; the 10mm @page
     margins and the sheet's own 4mm padding leave 182mm, and with the 6mm
     gutter three 56mm cards fit exactly (3 × 56 + 2 × 6 = 180mm). The old 60mm
     card only ever fitted two across, so this prints more labels per sheet and
     a larger code on each. */
  .label {
    width: 56mm; padding: 4mm; border: 1.5pt solid #0B1220; border-radius: 3mm;
    text-align: center; break-inside: avoid; page-break-inside: avoid;
  }
  /* 34mm before; the header and metadata rows that used to sit above and below
     it are gone, so the code takes the space they occupied. A bigger code is a
     code that scans from further away and survives a scuffed label. */
  .label img { width: 46mm; height: 46mm; display: block; margin: 0 auto; }
  .label-id {
    font-family: "JetBrains Mono", Consolas, monospace; font-size: 11pt;
    font-weight: 700; margin-top: 2mm; letter-spacing: .04em;
  }
  .label-name {
    font-size: 9pt; font-weight: 700; margin-top: 1mm; line-height: 1.25;
    min-height: 8mm;
  }
  @media screen {
    body { background: #eef1f6; padding: 12px; }
    .sheet { background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,.12); border-radius: 8px; }
  }
</style></head>
<body><div class="sheet">${labels.join('')}</div>
<script>
  /* Print only once every QR image has actually decoded.
     A fixed timer used to stand in for this, which is a guess rather than a
     guarantee: on a long sheet, or a slow device, the dialog could open while
     images were still decoding and the preview would show blank squares where
     the codes should be. decode() resolves per image when it is ready to
     paint, so the wait is exactly as long as it needs to be and no longer. */
  (function () {
    function ready(img) {
      if (img.decode) return img.decode().catch(function () {});
      if (img.complete) return Promise.resolve();
      return new Promise(function (done) {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      });
    }
    function go() {
      var images = Array.prototype.slice.call(document.images);
      Promise.all(images.map(ready)).then(function () {
        /* One frame, so the decoded images are painted before the dialog
           freezes the page. */
        requestAnimationFrame(function () {
          window.focus();
          window.print();
        });
      });
    }
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  })();
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
