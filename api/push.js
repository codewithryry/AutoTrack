/**
 * Push delivery: `POST /api/push`.
 *
 * A Vercel serverless function, alongside `api/assistant.js`, so it runs in the
 * project's existing deployment with no extra infrastructure. It exists for two
 * reasons the browser cannot cover: the VAPID private key must never reach a
 * client, and reading somebody else's push subscriptions needs the service role.
 *
 * The client sends only a notification id. The row is re-read here and its own
 * `user_id` decides who is pushed, so a request edited in the browser cannot
 * address an alert at anyone — the worst it can do is re-send a notification
 * that already exists to the person it was already written for.
 *
 * Broadcasts (`user_id is null`) are deliberately not pushed: they are the
 * laboratory-wide stream and are read in the app, not fanned out to every
 * registered device.
 *
 * Not configured is a normal state, not a fault — the app runs without this
 * endpoint and the notification centre behaves exactly as it always has.
 */

import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? process.env.VITE_VAPID_PUBLIC_KEY
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:admin@tooltrack.local'

/** Endpoints the push service says are gone for good. */
const DEAD = [404, 410]

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY || !VAPID_PUBLIC || !VAPID_PRIVATE) {
    return res.status(503).json({ error: 'Push notifications are not configured.' })
  }

  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Sign in to send a notification.' })

  const notificationId = req.body?.notificationId
  if (typeof notificationId !== 'string' || !notificationId) {
    return res.status(400).json({ error: 'A "notificationId" is required.' })
  }

  // The caller's own session decides whether they are anybody at all. The anon
  // client is the right one here: it validates the token without elevating it.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: caller, error: authError } = await asCaller.auth.getUser(token)
  if (authError || !caller?.user) {
    return res.status(401).json({ error: 'That session is no longer valid.' })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { data: notification, error: readError } = await admin
    .from('notifications')
    .select('id, title, message, user_id, link')
    .eq('id', notificationId)
    .maybeSingle()

  if (readError) return res.status(500).json({ error: 'The notification could not be read.' })
  if (!notification) return res.status(404).json({ error: 'No such notification.' })
  if (!notification.user_id) return res.status(200).json({ sent: 0, skipped: 'broadcast' })

  const { data: subscriptions, error: subsError } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', notification.user_id)

  if (subsError) return res.status(500).json({ error: 'Subscriptions could not be read.' })
  if (!subscriptions?.length) return res.status(200).json({ sent: 0 })

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

  const payload = JSON.stringify({
    id: notification.id,
    title: notification.title,
    message: notification.message,
    link: notification.link || '/notifications',
  })

  let sent = 0
  const gone = []

  await Promise.all(
    subscriptions.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload,
        )
        sent += 1
      } catch (err) {
        // An uninstalled app or a cleared browser leaves a dead endpoint behind.
        if (DEAD.includes(err?.statusCode)) gone.push(row.endpoint)
        else console.warn('[push] delivery failed', err?.statusCode, err?.message)
      }
    }),
  )

  if (gone.length) {
    await admin.from('push_subscriptions').delete().in('endpoint', gone)
  }

  return res.status(200).json({ sent, removed: gone.length })
}
