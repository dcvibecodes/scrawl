const CACHE_NAME = 'microblog-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-light-192.png',
  '/icon-light-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.url.startsWith('http') && !request.url.startsWith(self.location.origin)) return;

  // For navigation requests (HTML pages), use network-first to always show fresh content
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, response.clone());
          return response;
        });
      }).catch(() => {
        return caches.match(request);
      })
    );
    return;
  }

  // For static assets, use cache-first for speed
  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request).then((response) => {
        return caches.open(CACHE_NAME).then((cache) => {
          if (request.url.startsWith(self.location.origin)) {
            cache.put(request, response.clone());
          }
          return response;
        });
      });
    })
  );
});
