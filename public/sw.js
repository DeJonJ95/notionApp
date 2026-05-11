// Minimal service worker - cache-first for static assets, network-first for API
const CACHE = 'workspace-v1';
const STATIC = ['/', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-first for API
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request) as any)
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
    )
  );
});
