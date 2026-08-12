const CACHE_VERSION = 'qsf-crm-v1'
const STATIC_CACHE = `${CACHE_VERSION}-static`
const OFFLINE_URL = '/offline.html'

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Quero Ser Fit CRM', body: event.data.text(), url: '/inbox' }
  }
  const title = typeof payload?.title === 'string' ? payload.title.slice(0, 120) : 'Quero Ser Fit CRM'
  const body = typeof payload?.body === 'string' ? payload.body.slice(0, 240) : 'Você recebeu uma nova atualização.'
  const tag = typeof payload?.tag === 'string' ? payload.tag.slice(0, 120) : 'qsf-crm-message'
  const url = typeof payload?.url === 'string' ? payload.url : '/inbox'
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag,
    data: { url },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  let targetUrl = '/inbox'
  try {
    const candidate = new URL(event.notification.data?.url || '/inbox', self.location.origin)
    if (candidate.origin === self.location.origin && candidate.pathname === '/inbox') {
      targetUrl = `${candidate.pathname}${candidate.search}`
    }
  } catch {
    // Keep the safe Inbox fallback for malformed notification data.
  }

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => {
      try { return new URL(client.url).origin === self.location.origin && 'focus' in client } catch { return false }
    })
    if (existing) {
      existing.navigate(new URL(targetUrl, self.location.origin).href)
      return existing.focus()
    }
    return self.clients.openWindow(new URL(targetUrl, self.location.origin).href)
  }))
})

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, '/manifest.json', '/icon-192.png', '/icon-512.png']))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) return
  if (url.pathname === '/login' || url.pathname === '/recuperar-senha' || url.pathname.startsWith('/configuracoes')) return

  if (request.destination === 'image' || request.destination === 'style' || request.destination === 'script' || url.pathname === '/manifest.json') {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      }))
    )
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    )
  }
})
