/* Milana Source service worker — full offline install.
   Core shell is precached atomically; the heavy OCR assets (wasm cores +
   chi_sim/eng language data, ~38 MB) are cached best-effort at install and
   again on first use, so a flaky first load never blocks the app itself. */

// Bump this on every deploy so installed phones pick up the update.
// (js/app.js healOfflineAssets opens the same cache name — keep them in sync.)
const CACHE = 'milana-v2';

const CORE = [
  './',
  './index.html',
  './css/app.css',
  './js/db.js',
  './js/util.js',
  './js/ocr.js',
  './js/pdf.js',
  './js/views.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './vendor/tesseract.min.js',
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
    await Promise.allSettled(HEAVY.map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
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
