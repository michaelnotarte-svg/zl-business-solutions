// Minimal service worker — just enough to make the app installable (PWA)
// and launchable offline. Network-FIRST so the app is never stale; the
// cache is only a fallback when offline. Supabase (cross-origin) is never
// touched, so data always comes live from the network.

const CACHE = 'pos-shell-v3'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // leave Supabase & other APIs alone

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        return res
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match('/'))
      )
  )
})
