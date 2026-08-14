/**
 * The client half of the assistant's text generation.
 *
 * It asks `/api/assistant` — the one endpoint that holds the Cohere key — to
 * reword a line the app already has. Everything about this module is written so
 * that failing is free: no key is known here, nothing is awaited that the
 * interface depends on, and the caller's own written line is returned whenever
 * generation is not possible.
 *
 * Offline is not a failure path but the first check: with no connection, or with
 * Offline mode on, nothing is requested at all and the written line is used —
 * which is what keeps the assistant correct and instant on a workshop phone with
 * no signal.
 */

const ENDPOINT = '/api/assistant'
/** Longer than this and the student is waiting on a tooltip. */
const TIMEOUT_MS = 4000

/**
 * Once the endpoint has said it is not configured, it will not be configured a
 * moment later — so it is asked once and then left alone for this session.
 */
let unavailable = false

/** Generated wording, per line, so the same tooltip does not re-request. */
const cache = new Map()

/**
 * Reword `line` for `page`, or return `line` unchanged.
 *
 * Never rejects: every failure — offline, no endpoint, no key, a slow or broken
 * service, an unusable reply — resolves to the line that was passed in.
 */
export async function assistantLine(line, { page, offline = false } = {}) {
  if (!line) return line
  if (offline || unavailable) return line
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return line

  const cached = cache.get(line)
  if (cached) return cached

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ line, page }),
      signal: controller.signal,
    })
    if (response.status === 503 || response.status === 404) {
      // No key on the server, or no endpoint at all — a deployment without text
      // generation, which is a supported way to run this app.
      unavailable = true
      return line
    }
    if (!response.ok) return line
    const { text } = await response.json()
    if (typeof text !== 'string' || !text.trim()) return line
    cache.set(line, text)
    return text
  } catch {
    return line
  } finally {
    clearTimeout(timer)
  }
}
