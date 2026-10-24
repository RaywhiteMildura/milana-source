/* RaceLens service worker.
 *
 * - Install: keeps the current app shell and the assets it names, best effort,
 *   so the app opens offline from the next launch (even right after a first
 *   visit, or a deploy). Activate: carries the shell and good assets over from
 *   an older version's cache before dropping it – the page that version just
 *   served must still open with no signal next time, and so must the meetings
 *   saved on the phone.
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
/** A real asset (not an HTML page answered for one), worth keeping under /assets/. */
const isAsset = (res) => !!res && res.ok && ASSET_TYPE.test(res.headers.get('Content-Type') || '');

/** How long install waits for the app shell and its assets before going ahead without them. */
const PRECACHE_TIMEOUT_MS = 30000;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Best effort: a failure (no signal, a 502 while the Mac restarts) never stops the update; activate still carries the old copy over.
  event.waitUntil(Promise.race([precache().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, PRECACHE_TIMEOUT_MS))]));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const old = (await caches.keys()).filter((k) => k.startsWith('racelens-') && k !== CACHE_NAME);
      try {
        await carryOver(old);
      } catch {
        /* start afresh: the next open with a signal keeps the shell again */
      }
      await Promise.all(old.map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (isAsset(res)) cache.put(request, res.clone()).catch(() => undefined);
  return res;
}

/** The app's own index.html (names its /assets/), not an error or Wi-Fi login page. */
const isShell = (html) => /(?:src|href)=["']?\/assets\//.test(html);

/** The full URLs of the /assets/* files this index.html references. */
function namedAssets(html) {
  const live = new Set();
  for (const m of html.matchAll(/(?:src|href)=["']?(\/assets\/[^"'\s>]+)/g)) live.add(new URL(m[1], self.location.origin).href);
  return live;
}

/** Delete cached /assets/* entries that this index.html does not reference. */
async function pruneAssets(cache, html) {
  const live = namedAssets(html);
  for (const req of await cache.keys()) {
    if (new URL(req.url).pathname.startsWith('/assets/') && !live.has(req.url)) await cache.delete(req);
  }
}

const shellResponse = (html, type) => new Response(html, { headers: { 'Content-Type': type || 'text/html; charset=utf-8' } });

/** Keep a fresh app shell for the next time the network lets us down. */
async function keepShell(cache, res) {
  const html = await res.text();
  if (!isShell(html)) return;
  await cache.put(SHELL_KEY, shellResponse(html, res.headers.get('Content-Type')));
  await pruneAssets(cache, html);
}

/** At install: the current app shell and every asset it names, straight from the network – or nothing, if any of it fails. */
async function precache() {
  const res = await fetch('/', { cache: 'no-cache' });
  if (!res.ok) return;
  const html = await res.text();
  if (!isShell(html)) return;
  const urls = [...namedAssets(html)];
  const assets = await Promise.all(urls.map((url) => fetch(url)));
  if (!assets.every(isAsset)) return;
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(urls.map((url, i) => cache.put(url, assets[i])));
  await cache.put(SHELL_KEY, shellResponse(html, res.headers.get('Content-Type')));
  await pruneAssets(cache, html);
}

/**
 * At activate: the app shell and assets an older version of this worker kept,
 * for whatever install could not fetch – that version served the page now on
 * screen, so without them the next launch with no signal could not open the
 * app at all. Only what passes today's checks comes over: real assets (never
 * an HTML page kept under an asset's name), and an index.html that is the app
 * shell with every asset it names at hand (a shell without its script would
 * open a blank app).
 */
async function carryOver(oldNames) {
  const cache = await caches.open(CACHE_NAME);
  // Newest first: caches.keys() lists them in the order they were made.
  for (const name of [...oldNames].reverse()) {
    const old = await caches.open(name);
    for (const req of await old.keys()) {
      if (!new URL(req.url).pathname.startsWith('/assets/') || (await cache.match(req))) continue;
      const res = await old.match(req);
      if (isAsset(res)) await cache.put(req, res);
    }
    if (await cache.match(SHELL_KEY)) continue;
    const shell = await old.match(SHELL_KEY);
    if (!shell || !shell.ok) continue;
    const html = await shell.text();
    if (!isShell(html)) continue;
    const have = await Promise.all([...namedAssets(html)].map((url) => cache.match(url)));
    if (have.every(Boolean)) await cache.put(SHELL_KEY, shellResponse(html, shell.headers.get('Content-Type')));
  }
  // Only the assets of the shell kept stay (install may already have kept a newer one).
  const kept = await cache.match(SHELL_KEY);
  if (kept) await pruneAssets(cache, await kept.text());
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
