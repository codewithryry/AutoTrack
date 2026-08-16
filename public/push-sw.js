/**
 * Push handlers, imported into the generated service worker.
 *
 * Workbox generates the service worker from `vite.config.js`, so this file is
 * pulled in with `importScripts` rather than replacing it: the precache, the
 * navigation fallback and the runtime caching are all untouched, and the only
 * thing added is the pair of listeners a push needs.
 *
 * The payload is written by `api/push.js` and mirrors the notification row the
 * app already stores — title, message and the in-app link — so a phone
 * notification says exactly what the notification centre says.
 */

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    // A push that is not JSON still deserves to be shown.
    payload = { message: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'ToolTrack AutoLab'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.message || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // The notification id, so a re-send replaces the alert instead of
      // stacking a second copy of the same event on the lock screen.
      tag: payload.id || undefined,
      data: { url: payload.link || '/notifications' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/notifications'

  // Focus the app if it is already open — the router then handles the link —
  // and only open a new window when it is not.
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue
        await client.focus()
        if ('navigate' in client) await client.navigate(url)
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
