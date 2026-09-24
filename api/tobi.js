/**
 * TOBI, Tool Track's assistant: `POST /api/tobi`.
 *
 *   browser (TOBI chat) → this function → caller's session → role permissions
 *   → TOBI's functions (`_lib/tobi/tools.js`) → Supabase under RLS → model → reply
 *
 * The browser sends the conversation, the page it is on and nothing else. Who
 * the caller is comes from their Supabase session, validated here; their role
 * comes from their own `profiles` row, read here — a role in the request body
 * would be ignored, and there is none. The model only ever sees what TOBI's
 * functions return, and those run as the caller, so Row Level Security bounds
 * every answer exactly as it bounds the app's own screens.
 *
 * The provider key stays in the server environment (`_lib/tobi/provider.js`).
 * Not configured is a supported state: the endpoint answers 503 and the chat
 * says TOBI is unavailable, while the rest of Tool Track carries on.
 *
 * Before the provider is called, every request passes, in order: an
 * authenticated session; the role from the database; the size limits; the
 * daily quota and per-minute rate for that role (atomically, in the database —
 * `tobi_usage_begin`, migration 0037); and only that role's functions are
 * offered. Limits are configured in `_lib/tobi/config.js`. A request that fails
 * after the gate gives its quota unit back.
 *
 * GET:      { usage: { used, limit, remaining } }
 * POST:     { messages: [{ role: 'user'|'assistant', content }], context: { path } }
 *        →  { reply, title, navigate, actions: [...], links: [{ label, to }], usage }
 *           `navigate` ({ to, label }) is a page the user asked to be taken to.
 *           `title` names the chat's topic, on its first question only.
 * Refusals: 413 too_large · 429 daily_limit | rate_limit (with retryAfter)
 */

import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  chatTurn,
  priorAssistantMessage,
  providerConfigured,
  ProviderError,
  toolResultMessage,
  userMessage,
} from './_lib/tobi/provider.js'
import { resolvePage, runTool, toolsFor } from './_lib/tobi/tools.js'
import {
  CONTEXT_MESSAGES,
  DEADLINE_MS,
  MAX_MESSAGE_CHARS,
  MAX_TOOL_RESULT_CHARS,
  PROVIDER_TIMEOUT_MS,
  TIMEZONE,
  estimateTokens,
  limitsFor,
  usageDay,
} from './_lib/tobi/config.js'

export const config = { maxDuration: 30 }

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY

/** Function-calling rounds before TOBI gives up on a question. */
const MAX_ROUNDS = 5

const PAGES = [
  [/^\/dashboard$/, 'the dashboard'],
  [/^\/tools\/map$/, 'the Tool Map (last recorded tool locations)'],
  [/^\/tools\/[\w-]+\/history$/, "a tool's history page"],
  [/^\/tools\/[\w-]+$/, "a tool's detail page"],
  [/^\/tools$/, 'the inventory'],
  [/^\/scan$/, 'the QR scanner'],
  [/^\/requests/, 'requests'],
  [/^\/return$/, 'returns'],
  [/^\/transactions$/, 'transactions (loan history)'],
  [/^\/maintenance$/, 'maintenance'],
  [/^\/problem-reports$/, 'problem reports'],
  [/^\/users$/, 'users'],
  [/^\/messages/, 'messages'],
]

/** The page the user is on — a hint for the model, never an authorization input. */
function pageContext(raw) {
  const path = typeof raw === 'string' && /^\/[\w/-]{0,80}$/.test(raw) ? raw : null
  if (!path) return { path: null, page: 'unknown', toolId: null }
  const page = PAGES.find(([pattern]) => pattern.test(path))?.[1] ?? path
  const toolMatch = /^\/tools\/(?!map$)([\w-]{1,64})(?:\/history)?$/.exec(path)
  return { path, page, toolId: toolMatch?.[1] ?? null }
}

export function systemPrompt(user, context, now) {
  const today = new Intl.DateTimeFormat('en-PH', {
    timeZone: TIMEZONE,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(now)
  return [
    'You are TOBI, the assistant built into Tool Track (ToolTrack), a QR-based tool monitoring system for an automotive laboratory. Students borrow tools, instructors and admins run the tool crib.',
    `Signed-in user: ${user.fullName} (role: ${user.role}). Now: ${today} (${TIMEZONE}). Times in function results are already local.`,
    `They are on ${context.page}${context.path ? ` (${context.path})` : ''}.`,
    context.toolId
      ? `They are viewing the tool with ID "${context.toolId}": "this tool", "ito", "nito" mean that tool — pass it as toolId.`
      : '',
    '',
    'Rules:',
    '- For any question about tools, loans, requests, returns, locations, maintenance or users, call your functions. Answer only from what they return in this conversation.',
    '- Never invent tools, loans, people, dates, counts or locations. If a result is empty, say so plainly.',
    '- Locations: only an open loan has a current location, taken from its latest checkpoint or, failing that, its borrow point. Say "last recorded at <time>" and name the source; never say a tool "is" somewhere now. Give coordinates to 5 decimals and suggest the Tool Map. A tool not on loan has no live location; mention its storage location instead.',
    '- If a function you would need is not available to you, or a result says something is not visible, tell the user that information is not available for their account. Never reveal another student\'s loans to a student.',
    '- If a result is ambiguous (candidates), ask one short question naming the options.',
    '- You never change anything yourself. For an action, call the matching prepare_ function; the app then shows the user a confirmation card and runs Tool Track\'s own workflow only if they confirm. Say it is waiting for their confirmation — never that it is done.',
    '  - request, borrow or reserve a tool: prepare_tool_request (check availability first if unsure; convert dates like "bukas" or "Friday" to YYYY-MM-DD from today).',
    '  - return a borrowed tool: prepare_return_request.',
    '  - report damage or a fault: prepare_problem_report.',
    '  - approve or reject a request (staff): prepare_request_decision.',
    '- Only when the user explicitly asks to open, go to or be taken to a page, call open_page — the app then goes there directly. A question about data is never a navigation request: answer it. For anything no function covers (editing inventory, users, maintenance jobs), say which page to use.',
    '- Reply in the language the user writes in — English, Filipino or Taglish.',
    '- Be brief and practical. Plain text; use "- " bullets for lists; no tables, no headings.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Shortcuts under the reply, derived from what TOBI actually looked at. */
function linksFor(name, args, result) {
  if (!result || result.error) return []
  switch (name) {
    case 'get_tool_details':
      return [
        ...(result.tool ? [{ label: result.tool.name, to: `/tools/${result.tool.toolId}` }] : []),
        ...(result.currentLoan?.location?.recorded ? [{ label: 'Tool Map', to: '/tools/map' }] : []),
      ]
    case 'get_tool_history':
      return result.tool ? [{ label: `${result.tool.name} history`, to: `/tools/${result.tool.toolId}/history` }] : []
    case 'get_my_loans':
    case 'get_active_loans':
      return [{ label: 'Transactions', to: '/transactions' }]
    case 'get_my_requests':
    case 'get_request_queue':
      return [{ label: 'Requests', to: '/requests' }]
    case 'get_maintenance':
      return [
        args?.problemReportsOnly
          ? { label: 'Report Problems', to: '/problem-reports' }
          : { label: 'Maintenance', to: '/maintenance' },
      ]
    case 'get_user_summary':
      return [{ label: 'Users', to: '/users' }]
    case 'search_tools':
    case 'get_inventory_summary':
      return [{ label: 'Inventory', to: '/tools' }]
    case 'prepare_problem_report':
      return result.tool ? [{ label: result.tool.name, to: `/tools/${result.tool.toolId}` }] : []
    default:
      return []
  }
}

/**
 * "Open Tool Map", "go to Requests", "take me to the inventory", "buksan mo yung
 * Requests" — an explicit request to go somewhere, as opposed to a question
 * about data. Deliberately strict: "show me overdue tools" is a question, and
 * only "show me the ... page" counts as navigation. Anything this does not
 * match, or matches but names no page, goes to the model as usual.
 */
const NAV_INTENT = [
  /^(?:hey\s+)?(?:tobi[\s,!.:]+)?(?:please\s+|pa\s*|paki\s*)?(?:open|go\s+to|goto|take\s+me\s+to|bring\s+me\s+to|navigate\s+to|switch\s+to|buksan(?:\s+mo)?|punta(?:\s+(?:tayo|ako))?(?:\s+sa)?|pumunta\s+sa|dalhin\s+mo\s+ako\s+sa)\s+(.+?)(?:\s+(?:please|po|naman|nga))*[\s.!?]*$/i,
  /^(?:hey\s+)?(?:tobi[\s,!.:]+)?show\s+me\s+the\s+(.+?\s+(?:page|tab|screen))[\s.!?]*$/i,
]

export function navigationIntent(text) {
  for (const pattern of NAV_INTENT) {
    const match = pattern.exec(text.trim())
    if (match) return match[1]
  }
  return null
}

/**
 * A chat's title, from what TOBI looked up to answer it — "Overdue tools check",
 * "Cordless Drill location" — rather than the user's own words. Null where the
 * function says nothing a title could use.
 */
function titleFor(name, args, result) {
  if (!result || result.error || result.ambiguous) return null
  const tool = result.tool?.name
  switch (name) {
    case 'get_my_loans':
      return (
        { overdue: 'Overdue tools check', history: 'Your loan history', all: 'Your loans' }[result.scope] ??
        'Your borrowed tools'
      )
    case 'get_my_requests':
      return 'Your requests'
    case 'search_tools':
      if (args?.status === 'Available') return 'Tool availability'
      return args?.query ? `Finding ${String(args.query).slice(0, 30)}` : 'Tool search'
    case 'get_inventory_summary':
      return 'Inventory summary'
    case 'get_tool_details':
      return tool ? `${tool} status & location` : null
    case 'get_tool_history':
      return tool ? `${tool} history` : null
    case 'get_active_loans':
      return args?.overdueOnly ? 'Overdue tools' : 'Active loans'
    case 'get_request_queue':
      return 'Pending requests'
    case 'get_maintenance':
      return args?.problemReportsOnly ? 'Problem reports' : 'Maintenance'
    case 'get_user_summary':
      return 'Accounts overview'
    case 'prepare_return_request':
      return result.loan?.toolName ? `Returning ${result.loan.toolName}` : 'Returning a tool'
    case 'prepare_tool_request':
      return tool ? `Requesting ${tool}` : 'Tool request'
    case 'prepare_problem_report':
      return tool ? `${tool} problem report` : 'Problem report'
    case 'prepare_request_decision':
      return result.request?.toolName ? `${result.request.toolName} request decision` : 'Request decision'
    case 'open_page':
      return result.page ? `Opening ${result.page}` : null
    default:
      return null
  }
}

const cleanTitle = (text) =>
  String(text ?? '')
    .replace(/["'“”*#]/g, '')
    .replace(/^title:\s*/i, '')
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)

/**
 * The title for a chat that no function named — greetings, how-to questions.
 * One short call inside the same request (and the same quota unit); any
 * failure just means no title, never an error for the user.
 */
async function generatedTitle(question, reply, { signal, tokens }) {
  try {
    const turn = await chatTurn({
      system:
        "Name the topic of this Tool Track chat in 2 to 4 words, as a short noun phrase like a chat title (for example: Tool request steps, Drill return, QR scanning help). Never a question and never the user's own sentence. Use the user's language. Reply with the title only, no quotes, no final punctuation.",
      messages: [userMessage(`User: ${question.slice(0, 400)}\nAssistant: ${reply.slice(0, 400)}`)],
      tools: [],
      signal,
      maxTokens: 16,
      timeoutMs: 5000,
    })
    tokens.input += turn.usage.input
    tokens.output += turn.usage.output
    return cleanTitle(turn.text) || null
  } catch {
    return null
  }
}

/**
 * The conversation as sent, checked and trimmed. Only `user` and `assistant`
 * turns with text are kept — a client cannot inject a system or tool message —
 * and only the most recent `CONTEXT_MESSAGES` of them.
 *
 * Returns { turns } or { error, status } for a request that is refused outright.
 */
function conversationFrom(raw) {
  if (!Array.isArray(raw) || raw.length > 200) return { status: 400, error: 'Send a question for TOBI.' }
  const turns = raw
    .filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim(),
    )
    .slice(-CONTEXT_MESSAGES)
  const last = turns[turns.length - 1]
  if (!last || last.role !== 'user') return { status: 400, error: 'Send a question for TOBI.' }
  if (last.content.length > MAX_MESSAGE_CHARS) {
    return { status: 413, error: 'That message is too long for TOBI. Try asking in a shorter message.' }
  }
  return { turns: turns.map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) })) }
}

/**
 * Fit the prompt to the role's input budget: the newest question must fit
 * whole, older turns are dropped from the front until everything does.
 */
function fitToBudget(system, turns, maxInputTokens) {
  const fixed = estimateTokens(system)
  const question = turns[turns.length - 1]
  if (fixed + estimateTokens(question.content) > maxInputTokens) return null
  const kept = [question]
  let used = fixed + estimateTokens(question.content)
  for (let i = turns.length - 2; i >= 0; i--) {
    const cost = estimateTokens(turns[i].content)
    if (used + cost > maxInputTokens) break
    kept.unshift(turns[i])
    used += cost
  }
  // The conversation must still open with the user, as the provider expects.
  while (kept.length > 1 && kept[0].role !== 'user') kept.shift()
  return { turns: kept, estimatedInput: used }
}

/** A function result, cut to size before it goes back to the model. */
function toolPayload(result) {
  const text = JSON.stringify(result)
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text
  return JSON.stringify({
    truncated: true,
    note: 'Only the first part of this result fits; say that more records exist and suggest the matching page in the app.',
    partial: text.slice(0, MAX_TOOL_RESULT_CHARS),
  })
}

const usageView = (used, limits) => ({
  used,
  limit: limits.daily,
  remaining: Math.max(0, limits.daily - used),
})

const DAILY_LIMIT_MESSAGE =
  "You've reached your daily TOBI limit. Your AI messages will be available again tomorrow."
const RATE_LIMIT_MESSAGE = 'Slow down a little. You can send another TOBI request shortly.'

/** Signed in, active, and who they are according to the database — never the request. */
async function authenticate(req) {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return { status: 401, error: 'Sign in to talk to TOBI.' }
  // Every read runs as the caller: the anon key plus their own session, so Row
  // Level Security applies to TOBI exactly as it does to the app.
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: auth, error: authError } = await db.auth.getUser(token)
  if (authError || !auth?.user) return { status: 401, error: 'Your session has ended. Sign in again.' }
  const { data: profile } = await db
    .from('profiles')
    .select('id, full_name, role, status')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (!profile || profile.status !== 'Active') {
    return { status: 403, error: 'TOBI is available once your account is active.' }
  }
  return { db, user: { id: profile.id, role: profile.role, fullName: profile.full_name } }
}

/** GET — today's usage, for "TOBI usage: 7 / 20 today" before the first question. */
async function usageStatus(req, res) {
  const who = await authenticate(req)
  if (!who.user) return res.status(who.status).json({ error: who.error })
  const limits = limitsFor(who.user.role)
  const { count, error } = await who.db
    .from('tobi_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', who.user.id)
    .eq('usage_date', usageDay())
    .in('status', ['pending', 'ok'])
  if (error) return res.status(503).json({ error: 'TOBI usage limits are not set up yet.' })
  return res.status(200).json({ usage: usageView(count ?? 0, limits) })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!SUPABASE_URL || !ANON_KEY || !providerConfigured()) {
    return res.status(503).json({ error: 'TOBI is not set up on this deployment yet.' })
  }
  if (req.method === 'GET') return usageStatus(req, res)

  // 1–2. Authenticated account and its role, from the session and the database.
  const who = await authenticate(req)
  if (!who.user) return res.status(who.status).json({ error: who.error })
  const { db, user } = who
  const limits = limitsFor(user.role)

  // 5. Request size — refused before any quota is used.
  const parsed = conversationFrom(req.body?.messages)
  if (!parsed.turns) return res.status(parsed.status).json({ error: parsed.error, code: 'too_large' })

  // "Open Tool Map": answered here, straight from the role's navigation, with
  // no model call and no quota used — it is a click, not a question. A page the
  // role lacks is refused by name, and nothing is opened.
  const question = parsed.turns[parsed.turns.length - 1].content
  const wanted = navigationIntent(question)
  const page = wanted ? resolvePage(user, wanted) : null
  if (page) {
    const firstQuestion = parsed.turns.filter((m) => m.role === 'user').length === 1
    return res.status(200).json({
      reply: page.allowed ? `Opening ${page.label}.` : `${page.label} isn't available for your account.`,
      navigate: page.allowed ? { to: page.to, label: page.label } : null,
      title: firstQuestion ? (page.allowed ? `Opening ${page.label}` : page.label) : null,
      actions: [],
      links: [],
    })
  }

  const now = new Date()
  const context = pageContext(req.body?.context?.path)
  const system = systemPrompt(user, context, now)
  const fitted = fitToBudget(system, parsed.turns, limits.maxInputTokens)
  if (!fitted) {
    return res
      .status(413)
      .json({ error: 'That message is too long for TOBI. Try asking in a shorter message.', code: 'too_large' })
  }

  // 3–4. Daily quota and rate window, checked and recorded atomically in the
  // database for this account. Nothing reaches the provider unless this says so.
  const nonce = randomBytes(24).toString('hex')
  const { data: gate, error: gateError } = await db.rpc('tobi_usage_begin', {
    p_nonce: nonce,
    p_daily_limit: limits.daily,
    p_minute_limit: limits.perMinute,
    p_timezone: TIMEZONE,
  })
  if (gateError || !gate) {
    // Fail closed: without the usage record there is no limit, so no request.
    console.warn('[tobi] usage gate unavailable', gateError?.message)
    return res.status(503).json({ error: 'TOBI usage limits are not set up yet. Ask an administrator to apply the latest migration.' })
  }
  if (!gate.allowed) {
    const usage = usageView(gate.used, limits)
    return gate.reason === 'rate'
      ? res.status(429).json({ error: RATE_LIMIT_MESSAGE, code: 'rate_limit', retryAfter: gate.retryAfter ?? 30, usage })
      : res.status(429).json({ error: DAILY_LIMIT_MESSAGE, code: 'daily_limit', usage })
  }

  const finish = (status, tokens) =>
    db
      .rpc('tobi_usage_finish', {
        p_id: gate.id,
        p_nonce: nonce,
        p_status: status,
        p_input_tokens: tokens.input,
        p_output_tokens: tokens.output,
      })
      .then(
        ({ error }) => error && console.warn('[tobi] usage not finished', error.message),
        (err) => console.warn('[tobi] usage not finished', err?.message),
      )

  // 6. Only the functions this role may use are offered to the model.
  const tools = toolsFor(user)
  const messages = fitted.turns.map((m) =>
    m.role === 'user' ? userMessage(m.content) : priorAssistantMessage(m.content),
  )
  const actions = []
  const links = []
  const tokens = { input: 0, output: 0 }
  // Only a chat's first question gets a title; later turns keep the one it has.
  const firstQuestion = parsed.turns.filter((m) => m.role === 'user').length === 1
  let title = null
  // Set by open_page: the model understood a request to go somewhere.
  let navigateTo = null
  const hooks = {
    propose: (action) => {
      if (actions.length < 3) actions.push(action)
    },
    link: (link) => links.push(link),
    navigate: (target) => {
      navigateTo = target
    },
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS)
  try {
    let reply = null
    for (let round = 0; round < MAX_ROUNDS && reply === null; round++) {
      const turn = await chatTurn({
        system,
        messages,
        tools,
        signal: controller.signal,
        maxTokens: limits.maxOutputTokens,
        timeoutMs: PROVIDER_TIMEOUT_MS,
      })
      tokens.input += turn.usage.input
      tokens.output += turn.usage.output
      if (!turn.toolCalls.length) {
        reply = turn.text || "Sorry, I couldn't put an answer together. Try asking another way."
        break
      }
      messages.push(turn.assistantMessage)
      for (const call of turn.toolCalls.slice(0, 4)) {
        const result = await runTool(call.name, call.args, { db, user, now }, hooks)
        links.push(...linksFor(call.name, call.args, result))
        if (firstQuestion && !title) title = titleFor(call.name, call.args, result)
        messages.push(toolResultMessage(call, toolPayload(result)))
      }
      // Going somewhere needs no further words from the model.
      if (navigateTo) {
        reply = `Opening ${navigateTo.label}.`
        break
      }
    }
    if (reply === null) {
      reply = 'That took more steps than I can manage at once. Could you ask about one thing at a time?'
    }
    if (firstQuestion && !title) {
      title = await generatedTitle(parsed.turns[parsed.turns.length - 1].content, reply, {
        signal: controller.signal,
        tokens,
      })
    }
    await finish('ok', tokens)
    const seen = new Set()
    return res.status(200).json({
      reply,
      title,
      navigate: navigateTo,
      actions,
      links: links.filter((link) => !seen.has(link.to) && seen.add(link.to)).slice(0, 4),
      usage: usageView(gate.used, limits),
    })
  } catch (err) {
    // A failed request gives its quota unit back.
    await finish('failed', tokens)
    const usage = usageView(Math.max(0, gate.used - 1), limits)
    if (err instanceof ProviderError) {
      return res
        .status(err.timeout ? 504 : 502)
        .json({ error: err.timeout ? 'TOBI took too long to answer. Try again.' : err.message, usage })
    }
    console.warn('[tobi] failed', err?.message)
    return res.status(500).json({ error: 'TOBI ran into a problem. Try again.', usage })
  } finally {
    clearTimeout(timer)
  }
}
