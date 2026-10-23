/* RaceLens service worker.
 *
 * - Precaches nothing at install (the app shell is tiny and always fetched fresh).
 * - /assets/* (hashed filenames from the Vite build): cache-first, so repeat
 *   opens on a phone are instant and work on a flaky signal.
 * - Navigations: network-first, falling back to the last good index.html so the
 *   app still opens offline (the pages then show their own "can't reach the
 *   server" states).
 * - /api/*: never touched. Results and predictions must always be live.
 *
 * Bump SW_VERSION whenever this file changes so old caches are dropped.
 */
const SW_VERSION = 'v1';
const CACHE_NAME = `racelens-${SW_VERSION}`;
const SHELL_KEY = '/index.html';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('racelens-') && k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone()).catch(() => undefined);
  return res;
}

async function navigationNetworkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(SHELL_KEY, res.clone()).catch(() => undefined);
    return res;
  } catch (err) {
    const shell = await cache.match(SHELL_KEY);
    if (shell) return shell;
    return new Response('<!doctype html><title>RaceLens</title><p style="font-family:system-ui;padding:24px">RaceLens is offline and has not been opened on this device before. Connect to the network and try again.</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live data only, never cached
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(navigationNetworkFirst(request));
  }
});
