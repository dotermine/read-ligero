/* Service Worker — ReadLigero (strict offline-first)
 *
 * - Every app file (code, libraries, pdf.js CMaps/fonts, icons) is precached on install, ALL-OR-NOTHING:
 *   if one file cannot be fetched the install fails loudly instead of leaving a half-working offline app.
 * - Cache-first for everything same-origin; navigations always resolve to the cached app shell.
 * - A new version waits until the page asks for it (message SKIP_WAITING), so a running session
 *   never mixes old and new files. The page shows an "update available" prompt.
 * - The file list + cache version come from precache-manifest.js (node tools/gen-precache.js).
 */
importScripts('precache-manifest.js');

const CACHE_PREFIX = 'readligero-';
const CACHE_NAME = CACHE_PREFIX + self.PRECACHE_VERSION;
const SHELL = new URL('./index.html', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache:'reload' bypasses the HTTP cache so a fresh build can never be mixed with stale files
      cache.addAll(self.PRECACHE_URLS.map((u) => new Request(u, { cache: 'reload' })))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // the app never needs the network; leave foreign requests alone

  if (req.mode === 'navigate') {
    // Any navigation inside the scope gets the cached shell (works offline, ignores ?query / #hash variants)
    event.respondWith(
      caches.match(SHELL, { cacheName: CACHE_NAME })
        .then((hit) => hit || fetch(req))
        .catch(() => new Response('Offline and the app shell is not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { cacheName: CACHE_NAME, ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    }).catch(() => new Response('', { status: 504, statusText: 'Offline' }))
  );
});

self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  if (d.type === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: self.PRECACHE_VERSION });
});
