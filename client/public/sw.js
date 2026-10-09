// QualiCore service worker: offline-capable shell, always-fresh data.
// - Static bundles under /assets/*: cache-first (fast + offline).
// - Page navigations: network-first, fall back to cached shell offline.
// - /api/* requests are NEVER cached (data always fresh).
const STATIC_CACHE = 'qualicore-static-v1';
const SHELL_CACHE = 'qualicore-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add('/')).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never cache API traffic.
  if (url.pathname.startsWith('/api/')) return;
  // Versioned bundles: cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(event.request).then((hit) => {
          if (hit) return hit;
          return fetch(event.request).then((res) => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }
  // Navigations: network-first, offline fallback to shell.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          return res;
        })
        .catch(() => caches.open(SHELL_CACHE).then((cache) => cache.match('/')))
    );
  }
});
