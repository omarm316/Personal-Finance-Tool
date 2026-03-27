// Moresheth — Service Worker
const CACHE_VERSION = 'v3';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;

// Static CDN assets — safe to cache-first (versioned URLs)
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js'
];

// Install — precache CDN assets only (not the HTML page)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      cache.addAll(CDN_ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
      })
    )
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

  // HTML pages (/, /plaid/oauth-return) — ALWAYS network-first
  // This ensures deploys are immediately visible
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

  // API calls — network-first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (event.request.method === 'GET' && response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // CDN & static assets — cache-first (they're versioned/immutable)
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
