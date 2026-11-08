// Noldo service worker — offline-first caching + web push notifications.
// IMPORTANT: this file MUST be plain JavaScript (no TypeScript annotations),
// because browsers evaluate service worker scripts as raw JS.

const CACHE = 'noldo-v2'
const SHELL = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Never cache API or uploads — always live
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return
  }

  // Navigation: network-first, fall back to cached shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/').then((r) => r || new Response('Offline', { status: 503 })))
    )
    return
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy))
        return res
      }).catch(() => cached)
    )
  )
})

// -------- Web push notifications --------
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (e) {
    payload = { body: event.data ? event.data.text() : '' }
  }
  const title = payload.title || 'Noldo'
  const options = {
    body: payload.body || 'Новое сообщение',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: payload.url || '/' },
    tag: payload.tag,
    renotify: !!payload.tag,
    vibrate: [80, 40, 80],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// Click on a notification — focus existing tab or open the URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      // If a tab is already open on our origin, focus it (and try to navigate it)
      for (const client of allClients) {
        if ('focus' in client) {
          try { await client.navigate(targetUrl) } catch (e) { /* ignore */ }
          return client.focus()
        }
      }
      // Otherwise open a new tab
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
    })()
  )
})

// Allow the page to trigger skipWaiting via postMessage
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})
