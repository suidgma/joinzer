// Joinzer service worker — app shell caching for offline resilience
// Strategy:
//   Navigation requests  → network-first, cache on success, serve cache on failure
//   Static assets (JS/CSS/fonts/images) → cache-first, fetch and cache on miss
//   API routes + Supabase → always network, never cache

const CACHE = 'jz-shell-v2'

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
        .catch(() => caches.match(request))
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
