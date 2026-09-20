/**
 * The scheduled overdue and maintenance sweep.
 *
 * Deliberately thin: every decision lives in `run_scheduled_sweep()`, the
 * Postgres function added by migration `0033`. This endpoint authenticates the
 * caller, invokes it, and reports what it did. Nothing about overdue loans or
 * maintenance dates is decided here, so there is no second copy of that logic
 * to drift from `services/transactions.js` and `services/notifications.js`.
 *
 * Why it exists: the sweep used to run only from `AppContext`, and only when a
 * signed-in *staff* account opened the app. A quiet weekend meant no loan was
 * flipped to `Overdue` and nobody was told a tool was late. The records now
 * stay correct whether or not anybody opens ToolTrack.
 *
 * The client-side sweep is untouched and still runs — it keeps a staff member's
 * screen fresh the moment they arrive. Both are idempotent, so the two running
 * minutes apart is a no-op, not a double notification.
 *
 * Runs on the schedule in `vercel.json`. Also callable by hand for a one-off
 * reconciliation, with the same secret.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET

/** Mirrors the defaults in `utils/constants.js`. */
const DEFAULT_DUE_SOON_DAYS = 1

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'The scheduled sweep is not configured.' })
  }

  /*
   * Who may run this.
   *
   * Vercel Cron signs its own requests with `CRON_SECRET` in the Authorization
   * header. The same secret allows a manual run. There is no session-based
   * route in: the function is `security definer` and was revoked from
   * `authenticated`, so a browser cannot reach it even with a valid login —
   * the client has `runOverdueCheck()` for that, still governed by RLS.
   */
  if (!CRON_SECRET) {
    return res.status(503).json({ error: 'The scheduled sweep is not configured.' })
  }
  const offered = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (offered !== CRON_SECRET) {
    // Deliberately not "wrong secret": an unauthenticated caller learns nothing
    // about whether the endpoint exists in a usable state.
    return res.status(401).json({ error: 'Not authorised.' })
  }

  // The service role is what reaches a `security definer` function that no
  // client role may call. It never leaves the server.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Read the laboratory's own settings so the scheduled run uses the same
  // thresholds and toggles the staff already chose on the Settings page, rather
  // than a second set of defaults nobody can see.
  let dueSoonDays = DEFAULT_DUE_SOON_DAYS
  let notifyOverdue = true
  let notifyMaintenance = true
  try {
    const { data } = await admin
      .from('settings')
      .select('due_soon_threshold_days, notify_overdue, notify_maintenance')
      .limit(1)
      .maybeSingle()
    if (data) {
      if (Number.isFinite(data.due_soon_threshold_days)) {
        dueSoonDays = data.due_soon_threshold_days
      }
      notifyOverdue = data.notify_overdue !== false
      notifyMaintenance = data.notify_maintenance !== false
    }
  } catch (err) {
    // A settings row that cannot be read is not a reason to skip the sweep —
    // the defaults above are the same ones the application ships with.
    console.warn('[sweep] settings could not be read; using defaults', err?.message)
  }

  try {
    const { data, error } = await admin.rpc('run_scheduled_sweep', {
      due_soon_threshold_days: dueSoonDays,
      notify_overdue: notifyOverdue,
      notify_maintenance: notifyMaintenance,
    })
    if (error) throw error

    // The counts are useful in the Vercel log when somebody asks why a tool did
    // or did not flip. No record contents are logged.
    console.log('[sweep]', JSON.stringify(data))
    return res.status(200).json({ ok: true, ...data })
  } catch (err) {
    console.error('[sweep] failed', err?.message)
    return res.status(500).json({ error: 'The sweep could not be completed.' })
  }
}
