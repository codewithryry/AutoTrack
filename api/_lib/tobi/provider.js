/**
 * TOBI's model provider — the one file that knows which AI service is used.
 *
 * Everything else in TOBI speaks a provider-neutral shape:
 *
 *   chatTurn({ system, messages, tools, signal }) →
 *     { text, toolCalls: [{ id, name, args }], assistantMessage }
 *
 *   messages   the conversation so far, in the provider's own message format —
 *              built only through `userMessage`, `assistantMessage` (as returned)
 *              and `toolResultMessage` below, so callers never construct it.
 *   tools      [{ name, description, parameters }] — JSON Schema parameters.
 *
 * Replacing Cohere means rewriting this file and nothing else. The key is read
 * from the server environment here and is never returned, logged or sent to a
 * browser. `api/` files under `_lib` are not deployed as routes.
 */

const COHERE_URL = 'https://api.cohere.com/v2/chat'

export const providerConfigured = () => !!process.env.COHERE_API_KEY

const model = () => process.env.COHERE_MODEL || 'command-a-03-2025'

export const userMessage = (text) => ({ role: 'user', content: text })
export const priorAssistantMessage = (text) => ({ role: 'assistant', content: text })

export const toolResultMessage = (call, result) => ({
  role: 'tool',
  tool_call_id: call.id,
  content: [{ type: 'document', document: { data: typeof result === 'string' ? result : JSON.stringify(result) } }],
})

export class ProviderError extends Error {
  constructor(message, { timeout = false } = {}) {
    super(message)
    this.timeout = timeout
  }
}

/** Worth one more try: the service was briefly unavailable, not refusing us. */
const TRANSIENT = new Set([429, 500, 502, 503, 504])

/**
 * One call to the provider, cut off after `timeoutMs` — or sooner, when the
 * request's own `signal` (the overall deadline) fires.
 */
async function post(key, body, { signal, timeoutMs }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    return await fetch(COHERE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * `usage` is the provider's own token count for this call ({ input, output }),
 * zero where it does not report one.
 */
export async function chatTurn({ system, messages, tools, signal, maxTokens = 1000, timeoutMs = 15_000 }) {
  const key = process.env.COHERE_API_KEY
  if (!key) throw new ProviderError('The assistant is not configured.')

  const body = {
    model: model(),
    temperature: 0.2,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, ...messages],
    ...(tools.length
      ? {
          tools: tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
        }
      : {}),
  }

  // At most one retry, and only for a transient failure — never a loop.
  let response
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await post(key, body, { signal, timeoutMs })
    } catch (err) {
      if (signal?.aborted) throw new ProviderError('The assistant took too long to answer.', { timeout: true })
      if (attempt === 0 && err?.name !== 'AbortError') continue
      throw new ProviderError(
        err?.name === 'AbortError' ? 'The assistant took too long to answer.' : 'The assistant service could not be reached.',
        { timeout: err?.name === 'AbortError' },
      )
    }
    if (response.ok || attempt === 1 || !TRANSIENT.has(response.status)) break
  }

  if (!response.ok) {
    // The body can carry the provider's own diagnostics; it stays in the server
    // log and is never relayed to the browser.
    console.warn('[tobi] provider answered', response.status, await response.text().catch(() => ''))
    throw new ProviderError('The assistant service is unavailable.')
  }

  const payload = await response.json()
  const message = payload?.message ?? {}
  const text = (Array.isArray(message.content) ? message.content : [])
    .map((part) => part?.text ?? '')
    .join('')
    .trim()

  const toolCalls = (message.tool_calls ?? []).map((call) => {
    let args = {}
    try {
      args = JSON.parse(call?.function?.arguments || '{}') ?? {}
    } catch {
      args = {}
    }
    return { id: call.id, name: call?.function?.name ?? '', args }
  })

  const counted = payload?.usage?.billed_units ?? payload?.usage?.tokens ?? {}
  return {
    text,
    toolCalls,
    usage: {
      input: Number(counted.input_tokens) || 0,
      output: Number(counted.output_tokens) || 0,
    },
    // Echoed back verbatim on the next turn so the provider can pair each tool
    // result with the call that asked for it.
    assistantMessage: toolCalls.length
      ? { role: 'assistant', tool_plan: message.tool_plan ?? '', tool_calls: message.tool_calls }
      : { role: 'assistant', content: text },
  }
}
