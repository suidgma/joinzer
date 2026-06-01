// Joinzer service worker — app shell caching + push notifications

// ── Push notifications ────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Joinzer', {
      body: data.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url ?? '/home' },
      // tag deduplicates — same tag replaces previous notification of same kind
      tag: data.tag ?? 'joinzer',
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/home'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing open window and navigate it to the deep link
        for (const client of clientList) {
          if ('navigate' in client && 'focus' in client) {
            client.navigate(url)
            return client.focus()
          }
        }
        // No open window — open a new one
        if (self.clients.openWindow) return self.clients.openWindow(url)
      })
  )
})

// ── App shell caching for offline resilience ─────────────────────────────────
// Strategy:
//   Navigation requests  → network-first, cache on success, serve cache on failure
//   Static assets (JS/CSS/fonts/images) → cache-first, fetch and cache on miss
//   API routes + Supabase → always network, never cache

const CACHE = 'jz-shell-v3'

self.addEventListener('install', (e) => {
  // Activate immediately without waiting for old tabs to close
  e.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (e) => {
  // Delete old cache versions and take control of all open clients
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  const url = new URL(request.url)

  // Never intercept API routes, Supabase, or non-GET requests
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('supabase')
  ) return

  // Navigation (HTML pages) — network first, fall back to cache
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE).then(c => c.put(request, clone))
          }
          return res
        })
        .catch(() => caches.match(request).then(r => r ?? Response.error()))
    )
    return
  }

  // Static assets — cache first, network fallback + cache on miss
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    request.destination === 'image'
  ) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE).then(c => c.put(request, clone))
          }
          return res
        })
      })
    )
  }
})
