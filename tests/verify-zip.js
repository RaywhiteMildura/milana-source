/* Verify a deploy package from a clean extract: it must boot, load every
   module, register the service worker, precache everything (including the
   offline OCR models) and reload with the network off.
   Usage: unzip the package somewhere, serve that folder on 127.0.0.1:8129,
   then `npm run verify:zip` (or set ZIP_URL). */
const path = require('path');
const { launch, SHOTS, swCacheName } = require('./harness');
const URL = process.env.ZIP_URL || 'http://127.0.0.1:8129/index.html';

(async () => {
  const { browser, ctx, page } = await launch({ camera: false });
  const bad = [];
  page.on('pageerror', e => bad.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') bad.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) bad.push('HTTP ' + r.status() + ' ' + r.url()); });

  await page.goto(URL);
  await page.waitForSelector('#login-form', { timeout: 15000 });
  console.log('PASS: app boots from the package');

  const libs = await page.evaluate(() => ({
    tesseract: typeof Tesseract !== 'undefined', pinyin: typeof pinyinPro !== 'undefined',
    zh: typeof ZH !== 'undefined', ocr: typeof OCR !== 'undefined', lookup: typeof Lookup !== 'undefined',
    pdf: typeof DayPack !== 'undefined', views: typeof reviewItemView !== 'undefined', app: typeof Actions !== 'undefined',
  }));
  const missing = Object.entries(libs).filter(([, v]) => !v).map(([k]) => k);
  console.log(missing.length ? 'FAIL: missing modules ' + missing.join(', ') : 'PASS: all modules loaded (' + Object.keys(libs).join(', ') + ')');
  if (missing.length) bad.push('missing modules: ' + missing.join(', '));

  await page.fill('[data-input="login.name"]', 'Damian');
  await page.fill('[data-input="login.project"]', 'Villa Milana');
  await page.click('#login-form button.pf');
  await page.waitForSelector('text=Latest captures', { timeout: 10000 });
  console.log('PASS: signs in and renders the home screen');

  const want = swCacheName();
  const sw = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 90; i++) {
      const keys = await caches.keys();
      if (keys.length) {
        const c = await caches.open(keys[0]);
        const n = (await c.keys()).length;
        if (n >= 20) return { keys, n };
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    const keys = await caches.keys();
    const c = keys.length ? await caches.open(keys[0]) : null;
    return { keys, n: c ? (await c.keys()).length : 0, slow: true };
  });
  const cacheOk = want && sw.keys.includes(want);
  console.log((cacheOk ? 'PASS' : 'FAIL') + ': service worker cache = ' + JSON.stringify(sw.keys) + ' (expected ' + want + ') with ' + sw.n + ' assets');
  if (!cacheOk) bad.push('cache not ' + want + ': ' + JSON.stringify(sw.keys));

  // the 38 MB reader models are fetched by the worker AFTER install (so the
  // app itself installs in seconds) — give them up to two minutes to land
  const heavy = await page.evaluate(async (name) => {
    const files = ['./vendor/lang/chi_sim.traineddata.gz', './vendor/lang/eng.traineddata.gz',
      './vendor/core/tesseract-core-lstm.wasm.js', './vendor/core/tesseract-core-simd-lstm.wasm.js'];
    let out = {};
    for (let i = 0; i < 120; i++) {
      const c = await caches.open(name);
      out = {};
      for (const u of files) out[u.split('/').pop()] = !!(await c.match(u));
      if (Object.values(out).every(Boolean)) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    return out;
  }, want);
  const heavyOk = Object.values(heavy).every(Boolean);
  console.log((heavyOk ? 'PASS' : 'FAIL') + ': offline OCR assets cached after install ' + JSON.stringify(heavy));
  const readiness = await page.evaluate(() => ({ ready: S.ocrReady, missing: S.ocrMissing }));
  console.log((readiness.ready ? 'PASS' : 'FAIL') + ': app reports the offline reader as ready in Trip readiness ' + JSON.stringify(readiness));
  if (!readiness.ready) bad.push('S.ocrReady not set after the models were cached');
  if (!heavyOk) bad.push('OCR assets not fully cached');

  await ctx.setOffline(true);
  await page.reload();
  const offline = await page.waitForSelector('text=Latest captures', { timeout: 15000 }).then(() => true).catch(() => false);
  console.log((offline ? 'PASS' : 'FAIL') + ': app loads with no connection at all');
  if (!offline) bad.push('offline reload failed');
  await ctx.setOffline(false);

  await page.screenshot({ path: path.join(SHOTS, 'ZIP-verified.png') });
  console.log('\nPROBLEMS (' + bad.length + '):');
  bad.forEach(b => console.log('  ' + b));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
