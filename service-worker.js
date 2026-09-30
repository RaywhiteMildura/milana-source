/* Milana Source service worker — full offline install.

   Install caches the app shell atomically and FAST: the heavy OCR assets
   (wasm cores + chi_sim/eng language data, ~38 MB) are not part of install,
   because on hotel wifi they can take minutes and iOS suspends a backgrounded
   page long before that — a user who "opened it once at the hotel" must
   still arrive at the fair with a working app.

   Activate carries the heavy files forward from the previous version's cache
   (they are identical between deploys) before deleting it, so an update never
   throws away language data the phone already has. The page then asks this
   worker to fill whatever is still missing (message 'warm-heavy') and gets a
   'heavy-status' report back. */

// Bump this on every deploy so installed phones pick up the update.
const CACHE = 'milana-v11';

const CORE = [
  './',
  './index.html',
  './css/app.css',
  './js/db.js',
  './js/util.js',
  './js/zh.js',
  './js/ocr.js',
  './js/pdf.js',
  './js/lookup.js',
  './js/backup.js',
  './js/views.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './vendor/tesseract.min.js',
  './vendor/pinyin-pro.min.js',
  './vendor/worker.min.js',
  './vendor/jspdf.umd.min.js',
];

const HEAVY = [
  './vendor/core/tesseract-core-lstm.wasm.js',
  './vendor/core/tesseract-core-simd-lstm.wasm.js',
  './vendor/lang/chi_sim.traineddata.gz',
  './vendor/lang/eng.traineddata.gz',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const names = (await caches.keys()).filter(n => n !== CACHE);
    // carry the big files forward before anything is deleted
    for (const url of HEAVY) {
      if (await cache.match(url)) continue;
      for (const n of names) {
        const old = await (await caches.open(n)).match(url);
        if (old) { await cache.put(url, old); break; }
      }
    }
    await Promise.all(names.map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

let _warming = null;
async function heavyStatus() {
  const cache = await caches.open(CACHE);
  const missing = [];
  for (const url of HEAVY) if (!(await cache.match(url))) missing.push(url);
  return { type: 'heavy-status', ready: missing.length === 0, missing };
}
async function warmHeavy(client, online) {
  const before = await heavyStatus();
  if (before.ready || !online) { if (client) client.postMessage(before); return; }
  if (!_warming) {
    _warming = (async () => {
      const cache = await caches.open(CACHE);
      for (const url of before.missing) {
        try { await cache.add(url); } catch (err) { /* reported as still missing */ }
      }
    })().finally(() => { _warming = null; });
  }
  await _warming;
  const after = await heavyStatus();
  after.justFinished = after.ready;
  if (client) client.postMessage(after);
}

self.addEventListener('message', event => {
  const d = event.data || {};
  if (d.type === 'warm-heavy') {
    event.waitUntil(warmHeavy(event.source, d.online !== false));
  } else if (d.type === 'heavy-status') {
    event.waitUntil(heavyStatus().then(s => event.source && event.source.postMessage(s)));
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok) event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
