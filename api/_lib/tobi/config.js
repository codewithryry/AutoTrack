/**
 * TOBI's limits — the one place they are defined.
 *
 * Every value comes from the server environment, with these defaults:
 *
 *   role         per day   per minute   input tokens   output tokens
 *   Student         20          5           2000           1000
 *   Instructor      50         10           2000           1000
 *   Admin          100         15           3000           1500
 *
 *   TOBI_<ROLE>_DAILY_LIMIT, TOBI_<ROLE>_RATE_LIMIT     (ROLE = STUDENT | INSTRUCTOR | ADMIN)
 *   TOBI_<ROLE>_MAX_INPUT_TOKENS, TOBI_<ROLE>_MAX_OUTPUT_TOKENS
 *   TOBI_MAX_INPUT_TOKENS, TOBI_MAX_OUTPUT_TOKENS       (Student and Instructor, when the
 *                                                        role-specific value is not set)
 *   TOBI_CONTEXT_MESSAGES   recent messages sent as context       (15)
 *   TOBI_TIMEOUT_MS         one provider call, before it is cut   (15000)
 *   TOBI_TIMEZONE           whose midnight resets the daily quota (Asia/Manila)
 *
 * The daily and per-minute limits are enforced in the database
 * (`tobi_usage_begin`, migration 0037) before the provider is called; this file
 * only says what they are. The browser is told its usage in each response and
 * never decides anything with it.
 */

const int = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function roleLimits(key, defaults, { sharedTokens }) {
  const shared = (name, fallback) => (sharedTokens ? int(name, fallback) : fallback)
  return {
    daily: int(`TOBI_${key}_DAILY_LIMIT`, defaults.daily),
    perMinute: int(`TOBI_${key}_RATE_LIMIT`, defaults.perMinute),
    maxInputTokens: int(`TOBI_${key}_MAX_INPUT_TOKENS`, shared('TOBI_MAX_INPUT_TOKENS', defaults.input)),
    maxOutputTokens: int(`TOBI_${key}_MAX_OUTPUT_TOKENS`, shared('TOBI_MAX_OUTPUT_TOKENS', defaults.output)),
  }
}

export const TOBI_LIMITS = {
  Student: roleLimits('STUDENT', { daily: 20, perMinute: 5, input: 2000, output: 1000 }, { sharedTokens: true }),
  Instructor: roleLimits('INSTRUCTOR', { daily: 50, perMinute: 10, input: 2000, output: 1000 }, { sharedTokens: true }),
  Admin: roleLimits('ADMIN', { daily: 100, perMinute: 15, input: 3000, output: 1500 }, { sharedTokens: false }),
}

/** An unknown role gets the most restrictive limits, never the most generous. */
export const limitsFor = (role) => TOBI_LIMITS[role] ?? TOBI_LIMITS.Student

export const CONTEXT_MESSAGES = int('TOBI_CONTEXT_MESSAGES', 15)
export const PROVIDER_TIMEOUT_MS = int('TOBI_TIMEOUT_MS', 15_000)
/** The whole request, every function round included — under Vercel's 30s cap. */
export const DEADLINE_MS = 27_000
export const TIMEZONE = process.env.TOBI_TIMEZONE || 'Asia/Manila'

/** A single message longer than this is refused outright rather than trimmed. */
export const MAX_MESSAGE_CHARS = 4000
/** A function result is cut to this before it goes back to the model. */
export const MAX_TOOL_RESULT_CHARS = 6000

/**
 * A close, cheap estimate of tokens for English and Filipino text (about four
 * characters each). Used to refuse and trim before sending; the provider's own
 * count is what gets recorded afterwards.
 */
export const estimateTokens = (text) => Math.ceil(String(text ?? '').length / 4)

/** Today's date where the quota resets, as YYYY-MM-DD. */
export const usageDay = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
