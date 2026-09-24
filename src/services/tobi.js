/**
 * The client half of TOBI.
 *
 * Sends the conversation and the current path to `/api/tobi` with the user's
 * own session token, and nothing else: no role, no records, no key. Who the
 * user is and what they may see is decided on the server.
 */

import { accessToken } from './localAuth'
import { apiUrl } from '../utils/native'

const ENDPOINT = '/api/tobi'
/** A little longer than the server's own deadline, so its message wins. */
const TIMEOUT_MS = 32_000

export class TobiError extends Error {
  /**
   * `code` is the server's reason for a refusal — 'daily_limit', 'rate_limit'
   * or 'too_large' — and `usage` today's count when it sent one.
   */
  constructor(message, { retryable = true, code = null, usage = null, retryAfter = null } = {}) {
    super(message)
    this.retryable = retryable
    this.code = code
    this.usage = usage
    this.retryAfter = retryAfter
  }
}

const usageOf = (body) =>
  Number.isFinite(body?.usage?.used) && Number.isFinite(body?.usage?.limit) ? body.usage : null

/** Today's TOBI usage for this account, or null when it cannot be read. Never throws. */
export async function getTobiUsage() {
  try {
    const token = await accessToken()
    if (!token) return null
    const response = await fetch(apiUrl(ENDPOINT), { headers: { authorization: `Bearer ${token}` } })
    if (!response.ok) return null
    return usageOf(await response.json())
  } catch {
    return null
  }
}

/**
 * Ask TOBI. `messages` is the visible conversation, oldest first, ending with
 * the user's new question. Resolves to `{ reply, actions, links, usage }`.
 */
export async function askTobi({ messages, path }) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new TobiError("You're offline. TOBI needs a connection to answer.")
  }
  const token = await accessToken()
  if (!token) throw new TobiError('Sign in again to talk to TOBI.', { retryable: false })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response
  try {
    response = await fetch(apiUrl(ENDPOINT), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messages: messages.map(({ role, content }) => ({ role, content })),
        context: { path },
      }),
      signal: controller.signal,
    })
  } catch (err) {
    throw new TobiError(
      err?.name === 'AbortError' ? 'TOBI took too long to answer.' : "TOBI couldn't be reached.",
    )
  } finally {
    clearTimeout(timer)
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const fallback =
      response.status === 404 || response.status === 503
        ? 'TOBI is not available on this deployment yet.'
        : 'TOBI ran into a problem.'
    throw new TobiError(body?.error || fallback, {
      retryable: ![401, 403, 404, 413, 503].includes(response.status) && body?.code !== 'daily_limit',
      code: body?.code ?? null,
      usage: usageOf(body),
      retryAfter: Number.isFinite(body?.retryAfter) ? body.retryAfter : null,
    })
  }
  if (typeof body?.reply !== 'string') throw new TobiError('TOBI sent an answer that could not be read.')
  return {
    reply: body.reply,
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 60) : null,
    // A page the user asked to be taken to; the route guards still decide.
    navigate:
      typeof body.navigate?.to === 'string' && body.navigate.to.startsWith('/') ? body.navigate : null,
    actions: Array.isArray(body.actions) ? body.actions : [],
    links: Array.isArray(body.links)
      ? body.links.filter((link) => typeof link?.to === 'string' && link.to.startsWith('/'))
      : [],
    usage: usageOf(body),
  }
}
