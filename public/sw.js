// MDAS Service Worker: app-shell caching, offline emergency info, background push.
const CACHE_VERSION = 'mdas-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/login.html',
  '/dashboard.html',
  '/offline.html',
  '/manifest.json',
  '/css/style.css',
  '/js/common.js',
  '/js/index.js',
  '/js/login.js',
  '/js/dashboard.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Emergency endpoints whose last successful response is served when offline.
const OFFLINE_API = [
  '/api/contacts',
  '/api/alerts',
  '/api/weather',
  '/api/evacuation',
  '/api/missing',
  '/api/flood/sensors',
  '/api/barangays'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {
    // CDN assets (Leaflet etc.): cache-first so the map works offline after first load
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(resp => {
        if (resp.ok && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return resp;
      }).catch(() => caches.match(req)))
    );
    return;
  }

  // Emergency API data: network-first, always update cache, fallback offline
  if (OFFLINE_API.some(p => url.pathname === p || url.pathname.startsWith(p + '?'))) {
    event.respondWith(
      fetch(req).then(resp => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(url.pathname, copy));
        }
        return resp;
      }).catch(async () => {
        const cached = await caches.match(url.pathname);
        return cached || new Response(JSON.stringify({ offline: true, error: 'No cached data available.' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // App shell / pages: network-first, cache fallback, then offline page
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        return (await caches.match(url.pathname)) || (await caches.match('/')) || (await caches.match('/offline.html'));
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).catch(() => caches.match('/offline.html')))
  );
});

// Background push notifications - delivered even when the site is closed
self.addEventListener('push', event => {
  let data = { title: 'MDAS Emergency Alert', body: 'Open the app for details.' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { /* use defaults */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.alertId ? 'alert-' + data.alertId : 'mdas',
      renotify: true,
      requireInteraction: data.severity === 'critical',
      data: { url: data.url || '/', severity: data.severity || 'info' },
      vibrate: data.severity === 'critical' ? [400, 200, 400, 200, 400] : [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) { client.navigate(target); return client.focus(); }
      }
      return clients.openWindow(target);
    })
  );
});
