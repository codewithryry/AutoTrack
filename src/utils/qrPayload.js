/**
 * QR payload contract — the string half, with no rendering behind it.
 *
 * Codes printed by this app carry JSON so a scanner can tell a tool code apart
 * from any other QR the camera happens to see:
 *
 *   { "type": "tool", "toolId": "TOOL-00001", "v": 1 }
 *
 * A return request's QR carries no JSON and no loan or student details at
 * all — only an opaque token, in the plain form the task that asked for it
 * specified:
 *
 *   RETURN:8f2c1a9b7e4d4f0a9c3b2e1d0a9c8b7e
 *
 * The token is looked up server-side (`transactions.getByReturnQrToken`)
 * against `transactions.return_qr_token`, which is how the scan resolves to a
 * request without the code itself ever saying whose loan it is.
 *
 * `parseQRPayload` is deliberately permissive on the way in: a plain
 * `TOOL-00001` string typed into the manual fallback, or a URL ending in a tool
 * id, both resolve to the same tool. `parseReturnQRPayload` is the same idea
 * for the `RETURN:` form — it never rejects `parseQRPayload`'s inputs, and
 * `parseQRPayload` never accepts a `RETURN:` code, so the two cannot be
 * confused by either scanner.
 *
 * Split out of `utils/qr.js` for weight rather than tidiness. Everything here is
 * string work, but it used to live beside the code that *draws* a QR — so
 * `services/tools.js`, which only builds a payload string, pulled the whole
 * `qrcode` library into the application's core bundle and every screen paid for
 * it. `utils/qr.js` re-exports all of this, so no caller had to change.
 */

export const QR_VERSION = 1
export const TOOL_ID_PATTERN = /^TOOL-\d{5,}$/i
export const RETURN_QR_PREFIX = 'RETURN:'

export function buildQRPayload(toolId) {
  return JSON.stringify({ type: 'tool', toolId: String(toolId).toUpperCase(), v: QR_VERSION })
}

/**
 * @returns {{ ok: true, toolId: string } | { ok: false, error: string }}
 */
export function parseQRPayload(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, error: 'Empty QR code.' }

  // A return-request code is never mistaken for a tool tag, however it is
  // typed or scanned.
  if (isReturnQRPayload(text)) {
    return { ok: false, error: 'This is a return request code, not an equipment tag.' }
  }

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

/** The literal QR payload a return request's code carries. */
export function buildReturnQRPayload(token) {
  return `${RETURN_QR_PREFIX}${token}`
}

export function isReturnQRPayload(raw) {
  return String(raw ?? '').trim().toUpperCase().startsWith(RETURN_QR_PREFIX)
}

/**
 * @returns {{ ok: true, token: string } | { ok: false, error: string }}
 */
export function parseReturnQRPayload(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, error: 'Empty QR code.' }
  if (!isReturnQRPayload(text)) {
    return { ok: false, error: 'This is not a return request code.' }
  }
  const token = text.slice(RETURN_QR_PREFIX.length).trim()
  if (!token) return { ok: false, error: 'QR code is missing its return token.' }
  return { ok: true, token }
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
