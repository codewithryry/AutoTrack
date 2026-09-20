/**
 * QR payload contract — the string half, with no rendering behind it.
 *
 * Codes printed by this app carry JSON so a scanner can tell a tool code apart
 * from any other QR the camera happens to see:
 *
 *   { "type": "tool", "toolId": "TOOL-00001", "v": 1 }
 *
 * One tool, one QR, one code — this is the only payload the application ever
 * builds or reads. The QR identifies the tool and nothing else: not a
 * workflow, not a specific request, not a return. Wherever a Tool QR is shown
 * — the printed label, the inventory, the tool's own page, a return request's
 * detail — it is this same payload, built from the same `toolId`, so the same
 * physical code scans the same way from every one of those places. What
 * happens after a scan (borrow, return, accept/issue/reject a return request)
 * is decided by the universal scanner at `/scan` from the signed-in role and
 * the tool's live status — never by the QR itself.
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
