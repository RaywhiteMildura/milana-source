/* RaceLens service worker.
 *
 * - Precaches nothing at install (the app shell is tiny and always fetched fresh).
 * - /assets/* (hashed filenames from the Vite build): cache-first, so repeat
 *   opens on a phone are instant and work on a flaky signal. Only real assets
 *   (JavaScript, CSS, fonts, images) are kept: the server answers a file it
 *   does not have with the app's index.html, and that cached under an asset's
 *   name would blank the app for good.
 * - Navigations: network-first, falling back to the last good index.html when
 *   the network fails, takes longer than NAV_TIMEOUT_MS (a stalled connection
 *   at the track), or answers with an error page (Tailscale Serve says 502
 *   while the Mac restarts RaceLens) – so the app always opens, and shows its
 *   own "can't reach RaceLens" state with a Retry button, or the meetings saved
 *   on the phone. Only a page that is the app shell replaces the cached one,
 *   and each fresh shell also prunes the cached /assets/* files it no longer
 *   references, so the bundles of earlier deploys do not pile up on the phone
 *   (the build has no lazy chunks: index.html names every asset; a pruned file
 *   would simply be fetched again).
 * - /api/*: never touched. The page keeps its own, labelled copy of the
 *   researched meetings (src/web/lib/saved.ts).
 *
 * App deploys need nothing here. Bump SW_VERSION only when the caching
 * strategy in this file changes, so caches written the old way are dropped
 * (v3: v2 could have kept an HTML page as an asset).
 */
const SW_VERSION = 'v3';
const CACHE_NAME = `racelens-${SW_VERSION}`;
const SHELL_KEY = '/index.html';
/** How long a navigation waits for the network before opening the cached shell instead. */
const NAV_TIMEOUT_MS = 5000;
/** Content types worth keeping under /assets/. */
const ASSET_TYPE = /javascript|ecmascript|text\/css|font|image\/|manifest\+json|wasm/i;
const TIMED_OUT = Symbol('timed out');

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
  if (res.ok && ASSET_TYPE.test(res.headers.get('Content-Type') || '')) cache.put(request, res.clone()).catch(() => undefined);
  return res;
}

/** The app's own index.html (names its /assets/), not an error or Wi-Fi login page. */
const isShell = (html) => /(?:src|href)=["']?\/assets\//.test(html);

/** Delete cached /assets/* entries that this index.html does not reference. */
async function pruneAssets(cache, html) {
  const live = new Set();
  for (const m of html.matchAll(/(?:src|href)=["']?(\/assets\/[^"'\s>]+)/g)) live.add(new URL(m[1], self.location.origin).href);
  for (const req of await cache.keys()) {
    if (new URL(req.url).pathname.startsWith('/assets/') && !live.has(req.url)) await cache.delete(req);
  }
}

/** Keep a fresh app shell for the next time the network lets us down. */
async function keepShell(cache, res) {
  const html = await res.text();
  if (!isShell(html)) return;
  await cache.put(SHELL_KEY, new Response(html, { headers: { 'Content-Type': res.headers.get('Content-Type') || 'text/html; charset=utf-8' } }));
  await pruneAssets(cache, html);
}

async function navigationNetworkFirst(request, keepAlive) {
  const cache = await caches.open(CACHE_NAME);
  const shell = await cache.match(SHELL_KEY);
  const network = fetch(request);
  let res;
  try {
    // Without a saved shell there is nothing better to show: wait as long as the browser does.
    res = shell ? await Promise.race([network, new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), NAV_TIMEOUT_MS))]) : await network;
  } catch {
    res = undefined;
  }
  if (res === TIMED_OUT) {
    // Open the saved shell now. A late fresh page is not kept: its assets are not cached yet, and the next open fetches it anyway.
    network.catch(() => undefined);
    return shell;
  }
  if (res && res.ok) {
    keepAlive(keepShell(cache, res.clone()).catch(() => undefined));
    return res;
  }
  // An error page in front of RaceLens (502 while the Mac restarts it), or no network: the saved shell, whose pages say what is wrong.
  if (shell && (!res || res.status >= 500 || res.status === 404 || res.status === 421)) return shell;
  if (res) return res;
  return new Response(
    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>RaceLens</title><div style="font-family:system-ui;padding:24px;padding-top:calc(24px + env(safe-area-inset-top))"><p>RaceLens is offline and has not been opened on this device before. Check Tailscale is on and you have signal, then try again.</p><p><button onclick="location.reload()" style="font:inherit;padding:12px 20px">Try again</button></p></div>',
    {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    },
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live data only, never cached here
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === 'navigate') {
    // Keep the worker alive until the prune has finished, not just until the page has its response.
    const keepAlive = (p) => {
      try {
        event.waitUntil(p);
      } catch {
        /* the event already settled: the prune still runs while the worker is up, and again next time */
      }
    };
    event.respondWith(navigationNetworkFirst(request, keepAlive));
  }
});
