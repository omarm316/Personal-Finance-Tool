// Moresheth — Service Worker
const CACHE_VERSION = 'v8';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;

// Static CDN assets — safe to cache-first (versioned URLs)
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js'
];

// Key API endpoints to eagerly cache on first load — these power offline mode
const EAGER_API = [
  '/api/categories',
  '/api/accounts',
  '/api/stats',
  '/api/net-worth/current'
];

// Install — precache CDN assets and warm key API endpoints
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then(cache =>
        cache.addAll(CDN_ASSETS).catch(err => {
          console.warn('[SW] CDN cache failed:', err);
        })
      ),
      // Warm the API cache — failures are non-fatal
      caches.open(API_CACHE).then(cache =>
        Promise.allSettled(
          EAGER_API.map(url =>
            fetch(url).then(r => r.ok ? cache.put(url, r) : null)
          )
        )
      )
    ])
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests (mutations can't be cached)
  if (event.request.method !== 'GET') return;

  // HTML pages (/, /plaid/oauth-return) — network-first, cache fallback
  if (event.request.mode === 'navigate' || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // API calls — network-first, cache fallback for offline
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(cached => {
            if (cached) return cached;
            // Return empty JSON so the app doesn't crash
            return new Response(JSON.stringify([]), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          })
        )
    );
    return;
  }

  // CDN & static assets — cache-first (versioned/immutable)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && (
          url.origin === self.location.origin ||
          url.hostname.includes('googleapis.com') ||
          url.hostname.includes('gstatic.com') ||
          url.hostname.includes('cdnjs.cloudflare.com')
        )) {
          const clone = response.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// Background sync — queue failed mutations and retry when back online
self.addEventListener('sync', event => {
  if (event.tag === 'retry-mutations') {
    event.waitUntil(
      // Future: dequeue saved mutations from IndexedDB and replay
      Promise.resolve()
    );
  }
});
