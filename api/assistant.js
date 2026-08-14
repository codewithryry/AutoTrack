/**
 * The assistant's one server-side endpoint: `POST /api/assistant`.
 *
 * A Vercel serverless function, so it runs in the project's existing deployment
 * with no extra infrastructure. It exists for one reason: the Cohere key must
 * never reach a browser. The key is read from `COHERE_API_KEY` in the server
 * environment, is never sent to the client, and is never written into this
 * repository — the browser only ever sees the sentence that comes back.
 *
 * The endpoint is deliberately thin. It rewords a line the client already has,
 * so a failure here costs nothing: the caller falls back to the written line and
 * the assistant says exactly what it says today.
 */

const COHERE_URL = 'https://api.cohere.com/v2/chat'
const MODEL = 'command-r7b-12-2024'
/** Beyond this the assistant is no longer a one-line tooltip. */
const MAX_CHARS = 160
/** The browser gives up before this; the function should not outlive it. */
const TIMEOUT_MS = 6000

const SYSTEM = [
  'You are the assistant inside ToolTrack AutoLab, a QR-based tool monitoring app',
  'used by students in an automotive laboratory.',
  'You rewrite one short line of interface help.',
  'Reply with a single sentence, at most 20 words, in plain British English.',
  'Keep the original meaning exactly: never invent counts, tool names, dates or',
  'features, and never promise anything the line did not say.',
  'No greeting, no emoji, no quotation marks, no markdown.',
].join(' ')

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const key = process.env.COHERE_API_KEY
  // Not configured is a normal state, not a fault: the app runs without this
  // endpoint and simply uses its written lines.
  if (!key) return res.status(503).json({ error: 'Text generation is not configured.' })

  const { line, page } = req.body ?? {}
  if (typeof line !== 'string' || !line.trim() || line.length > 400) {
    return res.status(400).json({ error: 'A "line" to reword is required.' })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(COHERE_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 60,
        temperature: 0.4,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `Screen: ${typeof page === 'string' ? page.slice(0, 40) : 'unknown'}\nLine: ${line}`,
          },
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      return res.status(502).json({ error: 'The text service is unavailable.' })
    }

    const payload = await response.json()
    const text = (payload?.message?.content ?? [])
      .map((part) => part?.text ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .trim()

    // A reply that came back empty or overlong is not usable as a tooltip, and
    // the caller has a perfectly good line already.
    if (!text || text.length > MAX_CHARS) {
      return res.status(502).json({ error: 'No usable line was generated.' })
    }

    // Generated per request and cheap to redo; caching it would only serve one
    // student's wording to another.
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ text })
  } catch {
    return res.status(502).json({ error: 'The text service could not be reached.' })
  } finally {
    clearTimeout(timer)
  }
}
