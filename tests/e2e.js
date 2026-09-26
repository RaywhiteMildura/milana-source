/* Milana Source — end-to-end suite.
   Drives the real app in headless Chromium with a fake camera: capture flows,
   session logic, places, native camera, evening review + OCR, company lookup,
   exports, offline install, delete and clear-all. */
const path = require('path');
const { URL, SHOTS, sleep, swCacheName, launch, loadCJKFont, makeReporter } = require('./harness');

(async () => {
  const { browser, ctx, page } = await launch();
  const { errors, check, section } = makeReporter();
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('dialog', d => d.accept());

  const shot = async name => { await page.screenshot({ path: path.join(SHOTS, name + '.png') }); console.log('shot:', name); };
  const tap = async (sel, why) => {
    const el = page.locator(sel).first();
    await el.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { throw new Error('not visible: ' + sel + ' (' + why + ')'); });
    await el.click();
  };
  const S = fn => page.evaluate(fn);
  const closeSheet = async flag => { await page.mouse.click(201, 60); await page.waitForFunction(f => !S[f], flag, { timeout: 5000 }); };

  section('login with project name');
  await page.goto(URL);
  await loadCJKFont(page);
  await page.waitForSelector('#login-form', { timeout: 8000 });
  await shot('00-login');
  await page.fill('[data-input="login.name"]', 'Damian');
  await page.fill('[data-input="login.project"]', 'Casa Verde');
  await tap('[data-act="pickRole"][data-arg="Owner"]', 'role');
  await page.click('#login-form button.pf');
  await page.waitForSelector('text=Latest captures', { timeout: 8000 });
  check(await S(() => S.projectName) === 'Casa Verde', 'project name stored at login');
  await shot('01-home-empty');

  section('settings reachable from a real gear button');
  const gear = await S(() => {
    const btns = [...document.querySelectorAll('header [data-act="openSettings"]')];
    const g = btns.find(b => b.getAttribute('aria-label') === 'Settings');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    const pill = btns.find(b => b !== g);
    const pr = pill ? pill.getBoundingClientRect() : null;
    return { n: btns.length, w: r.width, h: r.height, pillH: pr ? pr.height : 0, overlap: pr ? pr.right > r.left : false };
  });
  check(gear && gear.n === 2, 'home header has both the sync pill and a settings button');
  check(gear && gear.w >= 44 && gear.h >= 44, 'gear button meets the 44px hit target (' + (gear && gear.w) + 'x' + (gear && gear.h) + ')');
  check(gear && !gear.overlap && gear.pillH >= 34, 'pill still tappable and does not overlap the gear');
  await page.locator('header [aria-label="Settings"]').click();
  await page.waitForFunction(() => S.settingsOn, null, { timeout: 5000 });
  await shot('02-settings-from-gear');
  await closeSheet('settingsOn');
  await page.locator('header [data-act="openSettings"]').first().click();
  await page.waitForFunction(() => S.settingsOn, null, { timeout: 5000 });
  check(true, 'the "N local" pill still opens settings too');
  await closeSheet('settingsOn');

  section('capture 1: full flow, portrait + landscape camera');
  await tap('[data-act="startCapture"]', 'plus button');
  await page.waitForSelector('#cam-root .cam', { timeout: 8000 });
  await page.waitForFunction(() => { const v = document.querySelector('#cam-root video'); return v && v.videoWidth > 0; }, null, { timeout: 10000 });
  const scrims = await S(() => [...document.querySelectorAll('#cam-root .cam [style*="linear-gradient"]')].length);
  check(scrims === 0, 'no gradient scrim over the camera preview');
  const bleed = await S(() => {
    const v = document.querySelector('#cam-root video');
    const top = document.querySelector('.cam-top');
    const ctrl = document.querySelector('.cam-ctrl');
    if (!v || !top || !ctrl) return null;
    const r = v.getBoundingClientRect(), t = top.getBoundingClientRect(), c = ctrl.getBoundingClientRect();
    const cs = getComputedStyle(v);
    return {
      full: Math.round(r.width) >= innerWidth && Math.round(r.height) >= innerHeight && r.top <= 0.5 && r.left <= 0.5,
      fit: cs.objectFit,
      topOver: t.top < r.bottom && t.bottom > r.top && getComputedStyle(top).position === 'absolute',
      ctrlOver: c.top < r.bottom && getComputedStyle(ctrl).position === 'absolute',
      topBg: getComputedStyle(top).backgroundColor,
      guides: document.querySelectorAll('.cam-guide').length,
      marks: document.querySelectorAll('.cam-marks i').length,
    };
  });
  check(bleed && bleed.full, 'PORTRAIT: video fills the viewport edge to edge');
  check(bleed && bleed.fit === 'cover', 'video uses object-fit: cover');
  check(bleed && bleed.topOver && bleed.ctrlOver, 'top bar and controls float over the preview');
  check(bleed && bleed.topBg === 'rgba(22, 17, 15, 0.55)', 'chrome bars are translucent rgba(22,17,15,.55) — got ' + (bleed && bleed.topBg));
  check(bleed && bleed.guides === 0 && bleed.marks === 4, 'no 4:3 guide box; only faint corner marks');
  await shot('03-camera-portrait');

  await tap('[data-act="snap"]', 'shutter 1 portrait');
  await page.waitForFunction(() => S.draft.product.length === 1, null, { timeout: 8000 });
  const dims = await S(async () => {
    const p = S.draft.product[0];
    const bmp = await createImageBitmap(p.blob);
    return { w: bmp.width, h: bmp.height, vw: Cam.video.videoWidth, vh: Cam.video.videoHeight,
      hasThumb: !!p.thumb, thumbSize: p.thumb ? p.thumb.size : 0, fullSize: p.blob.size };
  });
  check(dims.w >= 1280, 'photo stored at full stream resolution (' + dims.w + 'x' + dims.h + ')');
  check(dims.w === dims.vw && dims.h === dims.vh,
    'capture is the whole native video frame, uncropped (' + dims.w + 'x' + dims.h + ' vs video ' + dims.vw + 'x' + dims.vh + ')');
  check(dims.hasThumb && dims.thumbSize < dims.fullSize, 'thumbnail derived alongside full photo');

  // landscape: controls must stay visible and usable
  await page.setViewportSize({ width: 874, height: 402 });
  await sleep(700);
  await shot('04-camera-landscape');
  const inView = await S(() => {
    const ok = el => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
    };
    return ok(document.querySelector('[data-act="snap"]')) && ok(document.querySelector('[data-act="camNext"]')) && ok(document.querySelector('[data-act="cancelCam"]'));
  });
  check(inView, 'shutter, next and cancel fully on screen in landscape');
  const bleedL = await S(() => {
    const v = document.querySelector('#cam-root video');
    if (!v) return false;
    const r = v.getBoundingClientRect();
    return Math.round(r.width) >= innerWidth && Math.round(r.height) >= innerHeight;
  });
  check(bleedL, 'LANDSCAPE: video fills the viewport edge to edge');
  await tap('[data-act="snap"]', 'shutter 2 landscape');
  await page.waitForFunction(() => S.draft.product.length === 2, null, { timeout: 8000 });
  const dimsL = await S(async () => {
    const p = S.draft.product[1];
    const bmp = await createImageBitmap(p.blob);
    return { n: S.draft.product.length, w: bmp.width, h: bmp.height, vw: Cam.video.videoWidth, vh: Cam.video.videoHeight };
  });
  check(dimsL.n === 2, 'landscape shutter captured a photo');
  check(dimsL.w === dimsL.vw && dimsL.h === dimsL.vh, 'landscape capture is the full native frame (' + dimsL.w + 'x' + dimsL.h + ')');
  await page.setViewportSize({ width: 402, height: 874 });
  await sleep(400);

  await tap('[data-act="camNext"]', 'next → label');
  await page.waitForFunction(() => S.camera === 'label', null, { timeout: 8000 });
  await tap('[data-act="snap"]', 'label shot');
  await page.waitForFunction(() => S.camera === 'card', null, { timeout: 8000 });
  await tap('[data-act="snap"]', 'card shot');
  await page.waitForFunction(() => S.view === 'tag' && !S.camera, null, { timeout: 8000 });
  await shot('05-tag');

  section('tag + save capture 1');
  await tap('[data-act="pickCat"][data-arg="Tiles"]', 'category');
  await tap('[data-act="toggleRoom"][data-arg="Kitchen"]', 'room');
  await tap('[data-act="setRating"][data-arg="4"]', 'rating');

  // the in-progress capture is persisted: a reload must bring it back intact
  // (waitForFunction treats a returned Promise as truthy — poll from Node instead)
  let storedOk = false;
  for (let i = 0; i < 50 && !storedOk; i++) {
    storedOk = await S(async () => { const d = await settingGet('draft', null); const m = await settingGet('draftMeta', null); return !!(d && d.product && d.product.length === 2 && d.label && d.card && m && m.category === 'Tiles' && m.rating === 4 && m.rooms && m.rooms.includes('Kitchen')); });
    if (!storedOk) await sleep(100);
  }
  check(storedOk, 'photos and tags are in storage within a moment of the last tap');
  await page.reload();
  await page.waitForSelector('text=Latest captures', { timeout: 10000 });
  const restored = await S(() => ({ resume: S.draftResume, n: S.draft.product.length, cat: S.draft.category, rating: S.draft.rating, rooms: S.draft.rooms, label: !!S.draft.label, card: !!S.draft.card }));
  check(restored.resume && restored.n === 2 && restored.cat === 'Tiles' && restored.rating === 4 && restored.label && restored.card,
    'unfinished capture survives a reload with its photos and tags: ' + JSON.stringify(restored));
  check(await page.locator('[data-act="resumeDraft"]').count() === 1, 'Today offers to resume the unfinished capture');
  await tap('[data-act="resumeDraft"]', 'resume');
  await page.waitForFunction(() => S.view === 'shoot', null, { timeout: 5000 });
  await tap('[data-act="toDetails"]', 'tag it');
  await page.waitForFunction(() => S.view === 'tag', null, { timeout: 5000 });

  // a storage failure on save must be loud and must keep the draft
  // (the app logs the failure with console.error by design — expected here)
  await S(() => { window.__realBatch = dbBatch; window.__ce = console.error; console.error = () => {}; window.dbBatch = async () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }; });
  await tap('[data-act="save"]', 'save with storage full');
  await sleep(500);
  const quota = await S(() => ({ view: S.view, n: S.draft.product.length, caps: S.captures.length, toast: (document.querySelector('.toast') || {}).textContent || '', sticky: !!document.querySelector('.toast-sticky') }));
  check(quota.view === 'tag' && quota.n === 2 && quota.caps === 0, 'storage-full save keeps the draft and its photos');
  check(/out of storage/i.test(quota.toast) && quota.sticky, 'storage-full save shows a sticky, plain-language message: ' + quota.toast.slice(0, 60));
  await S(() => { window.dbBatch = window.__realBatch; console.error = window.__ce; document.querySelectorAll('.toast').forEach(t => t.remove()); });

  await tap('[data-act="save"]', 'save');
  await page.waitForFunction(() => S.view === 'saved', null, { timeout: 8000 });
  const savedTxt = await S(() => document.body.innerText);
  check(savedTxt.includes('Casa Verde'), 'saved screen shows the custom project name');
  check(await S(() => S.captures.length === 1 && !!S.session.key && S.companies.length === 1), 'capture saved with a company session started');
  check(await S(async () => (await settingGet('draft', null)) === null), 'saving clears the persisted draft');
  await shot('06-saved');

  section('capture 2: same booth (session skip)');
  await tap('[data-act="startCapture"]', 'next capture');
  await page.waitForFunction(() => S.camera === 'product', null, { timeout: 8000 });
  await page.waitForFunction(() => { const v = document.querySelector('#cam-root video'); return v && v.videoWidth > 0; }, null, { timeout: 10000 });
  await tap('[data-act="snap"]', 'product');
  await page.waitForFunction(() => S.draft.product.length === 1, null, { timeout: 8000 });
  await tap('[data-act="camNext"]', 'next → label');
  await page.waitForFunction(() => S.camera === 'label', null, { timeout: 8000 });
  await tap('[data-act="snap"]', 'label');
  // the company card is reused from the session: straight to Tag it
  await page.waitForFunction(() => S.view === 'tag' && !S.camera, null, { timeout: 8000 });
  check(await S(() => !S.draft.card && !!sessionCompany()), 'same booth: card step skipped, session company reused');
  await tap('[data-act="pickCat"][data-arg="Natural stone"]', 'category');
  await tap('[data-act="save"]', 'save');
  await page.waitForFunction(() => S.view === 'saved', null, { timeout: 8000 });
  check(await S(() => S.captures.length === 2 && S.captures[0].companyKey === S.captures[1].companyKey), 'second capture filed under the same company');

  section('capture 3: from tab bar shows reused slot 3 with new-booth action');
  await tap('[data-act="nav"][data-arg="home"]', 'home');
  await tap('[data-act="startCapture"]', 'plus from tab bar');
  await page.waitForFunction(() => S.camera === 'product', null, { timeout: 8000 });
  await tap('[data-act="cancelCam"]', 'cancel camera to see the shoot screen');
  await page.waitForFunction(() => !S.camera && S.view === 'shoot', null, { timeout: 5000 });
  await shot('07-shoot-same-booth');
  const reusedVisible = await page.locator('[data-act="newBooth"]').first().isVisible();
  check(reusedVisible, 'slot 3 reused state shows the New booth / new card action');
  const sessBefore = await S(() => S.session.key);
  check(sessBefore !== '', 'session active before newBooth');
  await tap('[data-act="newBooth"]', 'new booth');
  await page.waitForFunction(() => S.camera === 'card', null, { timeout: 5000 });
  const nb = await S(() => ({ key: S.session.key, cam: S.camera }));
  check(nb.key === '' && nb.cam === 'card', 'newBooth cleared the session and opened the card camera');
  await tap('[data-act="cancelCam"]', 'cancel');
  await page.waitForFunction(() => !S.camera, null, { timeout: 5000 });
  check(await S(() => S.session.key) === sessBefore, 'cancelling the new-booth camera puts the previous booth back');
  await tap('[data-act="closeFlow"]', 'abandon this capture');
  await page.waitForFunction(() => S.view === 'home', null, { timeout: 5000 });

  section('session must clear on venue change');
  await tap('[data-act="startCapture"]', 'capture 4');
  await page.waitForFunction(() => S.camera === 'product', null, { timeout: 8000 });
  await page.waitForFunction(() => { const v = document.querySelector('#cam-root video'); return v && v.videoWidth > 0; }, null, { timeout: 10000 });
  await tap('[data-act="snap"]', 'product');
  await page.waitForFunction(() => S.draft.product.length === 1, null, { timeout: 8000 });
  await tap('[data-act="camNext"]', 'next');
  await page.waitForFunction(() => S.camera === 'label', null, { timeout: 8000 });
  await tap('[data-act="snap"]', 'label');
  // the booth was put back when the new-card camera was cancelled: straight to Tag it
  await page.waitForFunction(() => S.view === 'tag' && !S.camera, null, { timeout: 8000 });
  await tap('[data-act="pickCat"][data-arg="Joinery"]', 'category');
  await tap('[data-act="save"]', 'save');
  await page.waitForFunction(() => S.view === 'saved', null, { timeout: 8000 });
  check(await S(() => S.session.key) !== '', 'session active before venue change');
  await tap('[data-act="nav"][data-arg="home"]', 'home');
  await tap('[data-act="openVenueSheet"]', 'venue sheet');
  await page.locator('[data-act="pickVenue"]', { hasText: 'Meiju' }).first().click();
  await page.waitForFunction(() => !S.venueSheetOn, null, { timeout: 5000 });
  check(await S(() => S.session.key) === '', 'venue change cleared the session');
  check(await S(() => S.venue) === 'Meiju', 'venue switched to Meiju');
  check(await S(() => sessWord()) === 'showroom', 'session word follows the place type (showroom)');

  section('places: add typed, delete, grouping');
  await tap('[data-act="openVenueSheet"]', 'venue sheet');
  await tap('[data-act="addPlaceOpen"]', 'add a place');
  await page.fill('[data-input="newPlace"]', 'Joinery Factory C');
  await tap('[data-act="setNewPlaceType"][data-arg="factory"]', 'type factory');
  await tap('[data-act="addPlaceSave"]', 'save place');
  await page.waitForFunction(() => !S.venueSheetOn, null, { timeout: 5000 });
  const placed = await S(() => {
    const p = S.places.find(x => x.name === 'Joinery Factory C');
    return { exists: !!p, type: p && p.type, venue: S.venue, word: sessWord(), n: S.places.length };
  });
  check(placed.exists && placed.type === 'factory', 'custom place saved under the type you picked');
  check(placed.venue === 'Joinery Factory C' && placed.word === 'factory', 'new place selected, session word = factory');
  check(placed.n >= 14, 'place list holds the seeded defaults plus the new one (' + placed.n + ')');
  await tap('[data-act="openVenueSheet"]', 'venue sheet');
  await shot('08-places-sheet');
  await tap('[data-act="togglePlaceEdit"]', 'edit places');
  await shot('09-places-edit');
  await page.locator('span', { hasText: 'Canton Fair Phase 3' }).locator('[data-act="deletePlace"]').first().click();
  await sleep(400);
  check(await S(() => !S.places.some(p => p.name === 'Canton Fair Phase 3')), 'place removed from the list');
  await tap('[data-act="togglePlaceEdit"]', 'done editing');
  await closeSheet('venueSheetOn');

  section('native camera path');
  await tap('[data-act="openSettings"]', 'settings');
  await tap('[data-act="toggleNativeCamera"]', 'enable native camera');
  check(await S(() => S.nativeCamera) === true, 'native camera setting persisted');
  await closeSheet('settingsOn');
  await tap('[data-act="startCapture"]', 'capture with native camera');
  await page.waitForFunction(() => S.camera === 'product', null, { timeout: 8000 });
  await page.waitForFunction(() => { const n = document.querySelector('#cam-fallback-note'); return n && n.style.display === 'block'; }, null, { timeout: 5000 });
  await shot('10-native-camera-note');
  const png = await S(async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const x = c.getContext('2d'); x.fillStyle = '#cc4433'; x.fillRect(0, 0, 640, 480);
    x.fillStyle = '#fff'; x.font = 'bold 60px sans-serif'; x.fillText('NATIVE', 60, 260);
    return c.toDataURL('image/png').split(',')[1];
  });
  const buf = Buffer.from(png, 'base64');
  await page.setInputFiles('#fallback-file', { name: 'native.png', mimeType: 'image/png', buffer: buf });
  await page.waitForFunction(() => S.draft.product.length === 1, null, { timeout: 8000 });
  const nat = await S(() => ({ n: S.draft.product.length, type: S.draft.product[0].blob.type, size: S.draft.product[0].blob.size }));
  check(nat.n === 1 && nat.size === buf.length && nat.type === 'image/png', 'native-camera shot stored (' + nat.type + ', ' + nat.size + ' bytes, unmodified)');
  await tap('[data-act="cancelCam"]', 'cancel');
  await tap('[data-act="closeFlow"]', 'abandon native capture');
  await tap('[data-act="openSettings"]', 'settings again');
  await tap('[data-act="toggleNativeCamera"]', 'disable native camera');
  await closeSheet('settingsOn');

  section('review + OCR');
  await tap('[data-act="nav"][data-arg="review"]', 'review');
  await page.waitForFunction(() => S.view === 'review', null, { timeout: 8000 });
  check(await S(() => !document.querySelector('.toast')), 'opening the review list raises no error toast');
  await shot('11-review-list');
  await page.locator('[data-act="openReview"]').first().click();
  await page.waitForSelector('text=FROM THE COMPANY CARD', { timeout: 8000 });
  await page.waitForFunction(() => !S.rvBusy.card && !S.rvBusy.label, null, { timeout: 240000 });

  // OCR on a rendered bilingual card: English must stay English, Chinese kept
  const ocr = await S(async () => {
    const c = document.createElement('canvas');
    c.width = 1400; c.height = 620;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#111';
    x.font = 'bold 62px TestSC, sans-serif'; x.fillText('厦门万利石材有限公司', 60, 120);
    x.font = 'bold 46px Arial'; x.fillText('XIAMEN WANLI STONE CO., LTD', 60, 205);
    x.font = '48px TestSC, sans-serif'; x.fillText('周文强 外贸经理', 60, 310);
    x.font = '40px Arial'; x.fillText('WeChat: wanli-stone-mark', 60, 400);
    x.fillText('Tel: +86 592 5566 778', 60, 470);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const lines = await OCR.readLines(blob);
    return { fields: OCR.parseCard(lines), langs: lines.map(l => l.lang + ':' + ZH.scriptOf(l.text)), texts: lines.map(l => l.text) };
  });
  const wrongScript = ocr.langs.filter(l => l === 'eng:cjk' || l === 'chi_sim:latin');
  check(wrongScript.length === 0, 'no line came from the wrong-script model: ' + JSON.stringify(ocr.langs));
  check(/XIAMEN|WANLI/i.test(ocr.fields.company.value), 'English company read as English: ' + JSON.stringify(ocr.fields.company.value));
  check(/[一-鿿]/.test(ocr.fields.company.zh) && /有限公司$/.test(ocr.fields.company.zh),
    'Chinese company kept alongside for checking: ' + ocr.fields.company.zh);
  check(/wanli-stone-mark/.test(ocr.fields.wechat.value), 'WeChat id read over the phone number: ' + ocr.fields.wechat.value);
  check(/^Zhou /.test(ocr.fields.contact.value), 'contact transliterated with surname split: ' + ocr.fields.contact.value + '  (read: ' + JSON.stringify(ocr.texts) + ')');

  // English-only photos must never come back as Chinese
  const enOnly = await S(async () => {
    const draw = (fn, w, h, opts) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = '#ece7de'; x.fillRect(0, 0, w, h);
      x.filter = 'blur(' + (opts.blur || 0) + 'px)';
      x.save();
      x.translate(w / 2, h / 2); x.rotate((opts.rot || 0) * Math.PI / 180); x.translate(-w / 2, -h / 2);
      x.fillStyle = '#272320'; fn(x);
      x.restore(); x.filter = 'none';
      const img = x.getImageData(0, 0, w, h), d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() * 64) - 32;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      x.putImageData(img, 0, 0);
      return c;
    };
    const imgs = {
      blurryPlate: draw(x => {
        x.font = '26px Arial';
        ['MIELE PROFESSIONAL', 'Type: PWM 507 DV', 'Nominal capacity 7 kg',
          'Drum volume 64 litres', 'Made in Germany 2026'].forEach((t, i) => x.fillText(t, 60, 90 + i * 52));
      }, 900, 420, { blur: 1.6, rot: -3.5 }),
      texture: draw(x => {
        for (let i = 0; i < 240; i++) {
          x.fillStyle = 'rgba(' + (90 + Math.random() * 70 | 0) + ',70,50,.5)';
          x.fillRect(Math.random() * 900, Math.random() * 500, 4 + Math.random() * 90, 3 + Math.random() * 26);
        }
      }, 900, 500, { blur: 0.8 }),
      cleanEnglish: draw(x => {
        x.font = 'bold 54px Arial'; x.fillText('HARLOW JOINERY', 70, 130);
        x.font = '40px Arial';
        x.fillText('Michael Harlow', 70, 230);
        x.fillText('Tel: +61 3 9555 2288', 70, 320);
      }, 1200, 420, { blur: 0 }),
    };
    const out = {};
    for (const [k, canvas] of Object.entries(imgs)) {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const lines = await OCR.readLines(blob);
      const card = OCR.parseCard(lines);
      out[k] = { text: lines.map(l => l.text).join(' | '), cjk: lines.some(l => /[一-鿿]/.test(l.text)), company: card.company };
    }
    return out;
  });
  check(!enOnly.blurryPlate.cjk, 'blurry English photo produces no Chinese: ' + enOnly.blurryPlate.text.slice(0, 90));
  check(!/[一-鿿]/.test(enOnly.blurryPlate.company.value + enOnly.blurryPlate.company.zh),
    'no Chinese reaches the company field from an English photo: ' + JSON.stringify(enOnly.blurryPlate.company));
  check(!enOnly.texture.cjk && !enOnly.texture.text, 'a textured object with no text reads as nothing, not Chinese: ' + enOnly.texture.text.slice(0, 90));
  check(/HARLOW JOINERY/i.test(enOnly.cleanEnglish.company.value), 'clean English card still names the company: ' + JSON.stringify(enOnly.cleanEnglish.company.value));
  check(!enOnly.cleanEnglish.cjk, 'clean English card stays free of Chinese');

  // every raw OCR line is offered as a tap-to-use chip
  await S(() => {
    S.rvLines.label = ['CABOT’S Danish Oil', 'Interior Timber Finish', '500ml'];
    S.rv.pname = ''; S.rv.code = 'X-1'; renderAll();
  });
  check(await page.locator('[data-act="useLine"]').count() >= 3, 'raw OCR lines offered as tap-to-use chips');
  await page.locator('[data-act="useLine"][data-arg="label@0"]').click();
  await sleep(250);
  check(await S(() => S.rv.pname) === 'CABOT’S Danish Oil', 'tapping a line fills the first empty field');

  // the Chinese companion is offered in the UI and can be tapped back in
  await S(() => { S.rvZh.company = '厦门万利石材有限公司'; S.rv.company = 'Xiamen Wanli Stone Co., Ltd'; renderAll(); });
  check(await page.locator('[data-act="useZh"][data-arg="company"]').count() > 0, 'use 中文 control offered next to the field');
  await page.locator('[data-act="useZh"][data-arg="company"]').first().click();
  await sleep(200);
  check(await S(() => S.rv.company) === '厦门万利石材有限公司', 'tapping use 中文 puts the characters back');
  await shot('12-complete-record-bilingual');

  section('company lookup: level 1 links');
  await page.waitForSelector('a[data-search]', { timeout: 5000 });
  const links = await S(() => [...document.querySelectorAll('a[data-search]')].map(el => el.getAttribute('href')));
  check(links.length === 4, 'four search links on the Complete Record screen');
  check(links.some(u => u.startsWith('https://www.bing.com/search?q=')) &&
        links.some(u => u.startsWith('https://www.bing.com/images/search?q=')) &&
        links.some(u => u.includes('alibaba.com/trade/search')) &&
        links.some(u => u.includes('s.1688.com/company')),
        'Bing web/images + Alibaba + 1688 links present');
  check(!links.some(u => u.includes('google')), 'no Google links (blocked in mainland China)');
  check(links[0].includes(encodeURIComponent('厦门万利石材有限公司')), 'links prefilled with the confirmed company name');
  await page.fill('[data-input="rv.website"]', 'https://wanlistone.example.cn');
  await page.fill('[data-input="rv.notes"]', 'Verified booth at CeramBath. Ask for slab thickness options.');
  check(await page.locator('[data-act="fetchBio"]').count() === 0, 'no bio button without an API key');

  section('company lookup: level 2 AI bio (offline queue → mocked retry)');
  await S(() => { S.aiKey = 'sk-ant-test-key'; renderAll(); });
  await ctx.setOffline(true);
  await tap('[data-act="fetchBio"]', 'fetch bio while offline');
  await sleep(400);
  check(await S(() => S.rvLookupPending) === true, 'offline fetch queues a lookup-pending flag');
  check(await page.locator('text=Lookup pending').count() > 0, 'pending banner with retry shown');
  await ctx.setOffline(false);
  let apiReq = null, apiHeaders = null;
  await page.route('https://api.anthropic.com/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS',
      } });
      return;
    }
    apiHeaders = req.headers();
    apiReq = req.postDataJSON();
    await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({
      content: [
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'Xiamen Wanli Stone' } },
        { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [] },
        { type: 'text', text: 'Xiamen Wanli Stone Co., Ltd is a natural-stone fabricator based in Xiamen. Main products: granite, quartz and sintered slabs. Website: wanlistone.cn. Alibaba verified supplier, 8 years. A buyer should confirm the export licence and slab grading before ordering.' },
      ],
      stop_reason: 'end_turn',
    }) });
  });
  await tap('[data-act="fetchBio"]', 'retry the lookup');
  await page.waitForFunction(() => !!S.rv.bio, null, { timeout: 8000 });
  check(apiReq && apiReq.model === 'claude-haiku-4-5', 'bio call uses claude-haiku: ' + (apiReq && apiReq.model));
  check(apiReq && apiReq.tools && apiReq.tools[0] && apiReq.tools[0].type === 'web_search_20250305', 'web search tool enabled on the call');
  check(apiReq && JSON.stringify(apiReq.messages).includes('厦门万利石材有限公司'), 'OCR-read company details included in the prompt');
  check(apiReq && /Do not assume where the company is based/.test(JSON.stringify(apiReq.messages))
    && !/China sourcing trip/.test(JSON.stringify(apiReq.messages)), 'lookup prompt is country-neutral, not China-only');
  check(apiHeaders && apiHeaders['x-api-key'] === 'sk-ant-test-key' && apiHeaders['anthropic-dangerous-direct-browser-access'] === 'true',
    'browser-direct API headers set');
  check(await S(() => S.rvLookupPending) === false, 'pending flag cleared after a successful lookup');
  check(await page.locator('text=AI lookup — verify yourself').count() > 0, 'bio marked "AI lookup — verify yourself"');
  check(await S(() => { const el = document.querySelector('[data-input="rv.bio"]'); return !!el && el.tagName === 'TEXTAREA' && el.value.includes('Wanli'); }), 'bio shown in an editable field');
  await shot('13-company-lookup');

  await page.fill('[data-input="rv.company"]', 'Foshan Jinlan Joinery Co., Ltd');
  await page.fill('[data-input="rv.pname"]', 'Fluted walnut veneer door');
  await page.fill('[data-input="rv.note"]', 'Ask about a 45mm leaf and the lead time.');
  // the card photo opens full screen for checking characters
  await tap('[data-act="viewPhoto"][data-arg="rv@card"]', 'enlarge card photo');
  check(await S(() => !!S.viewPhoto && !!document.querySelector('[data-act="closePhoto"]')), 'card photo opens full screen');
  await tap('[data-act="zoomPhoto"]', 'zoom');
  check(await S(() => S.viewPhoto && S.viewPhoto.zoom > 1), 'tap zooms the photo');
  await tap('[data-act="closePhoto"]', 'close photo');
  check(await S(() => !S.viewPhoto), 'photo viewer closes');
  await tap('[data-act="confirmReview"]', 'confirm');
  await page.waitForFunction(() => S.view === 'review', null, { timeout: 8000 });
  check(await S(() => { const co = S.companies.find(c => c.name === 'Foshan Jinlan Joinery Co., Ltd'); return !!co && co.nameZh === '厦门万利石材有限公司'; }),
    'confirmed record stored the English name and the characters');
  check(await S(() => S.captures.some(c => c.name === 'Fluted walnut veneer door' && c.note === 'Ask about a 45mm leaf and the lead time.')), 'product note saved with the record');
  check(await S(() => {
    const co = S.companies.find(c => c.name === 'Foshan Jinlan Joinery Co., Ltd');
    return !!co && co.website === 'https://wanlistone.example.cn' && co.notes.includes('CeramBath') && co.bio.includes('Wanli') && !!co.bioAt && !co.lookupPending;
  }), 'website, notes and AI bio persisted on the company record at confirm');

  section('company detail view with lookup');
  await tap('[data-act="nav"][data-arg="home"]', 'back home from review');
  await tap('[data-act="nav"][data-arg="suppliers"]', 'companies tab');
  await shot('14-companies');
  await page.locator('[data-act="openCompany"]:has-text("Foshan Jinlan")').first().click();
  await page.waitForFunction(() => !!S.companyKey, null, { timeout: 5000 });
  await shot('15-company-detail');
  check(await page.locator('a[data-search]').count() >= 4, 'company detail view has the search links');
  check(await S(() => { const el = document.querySelector('[data-input="co.website"]'); return !!el && el.value === 'https://wanlistone.example.cn'; }), 'company detail shows the saved website');
  check(await page.locator('text=AI lookup — verify yourself').count() > 0, 'bio shown on the company detail view');
  await page.fill('[data-input="co.notes"]', 'Updated from the company view');
  await sleep(700);
  check(await S(() => S.companies.some(c => c.notes === 'Updated from the company view')), 'edits on the company view persist');
  await tap('[data-act="openCompanyProducts"]', 'open products from the company');
  await page.waitForFunction(() => S.view === 'products', null, { timeout: 5000 });
  check(await S(() => S.view === 'products' && S.q.includes('Foshan Jinlan')), 'Open products jumps to that company’s list');
  await page.fill('[data-input="q"]', '');
  await sleep(400);
  await shot('16-products');

  section('CSV carries the lookup columns');
  const csv = await S(async () => {
    let out = null;
    const orig = window.shareOrDownload;
    window.shareOrDownload = async (name, blob) => { out = await blob.text(); return 'downloaded'; };
    Actions.exportCSV();
    await new Promise(r => setTimeout(r, 300));
    window.shareOrDownload = orig;
    return out;
  });
  check(!!csv && csv.includes('"website","company_notes","company_bio"'), 'CSV header has website / notes / bio columns');
  check(!!csv && csv.includes('wanlistone.example.cn'), 'CSV rows carry the saved website');

  section('compare tray');
  await page.locator('[data-act="openDetail"]').first().click();
  await page.waitForFunction(() => !!S.detailId, null, { timeout: 5000 });
  await tap('[data-act="toggleCompare"]', 'add to compare');
  check(await S(() => S.compareIds.length === 1), 'capture added to compare');
  await tap('[data-act="closeDetail"]', 'close detail');
  await tap('[data-act="nav"][data-arg="compare"]', 'compare tab');
  await shot('17-compare');
  check(await page.locator('[data-act="toggleCompare"]').count() >= 1, 'compare view lists the selected capture');
  await tap('[data-act="nav"][data-arg="products"]', 'products');

  section('save-to-photos + delete with company offer');
  await page.locator('[data-act="openDetail"]').first().click();
  await page.waitForFunction(() => !!S.detailId, null, { timeout: 5000 });
  await shot('18-detail');
  check(await page.locator('[data-act="sharePhoto"]').count() > 0, 'per-photo Save to Photos buttons present');
  await page.locator('[data-act="sharePhoto"]').first().click().catch(() => {});
  await sleep(700); // headless: falls back to download + toast
  const before = await S(() => ({ caps: S.captures.length, cos: S.companies.length, id: S.detailId }));
  const delTargetCo = await S(() => {
    const c = S.captures.find(x => x.id === S.detailId);
    return c ? { key: c.companyKey, others: S.captures.filter(x => x.id !== c.id && x.companyKey === c.companyKey).length } : null;
  });
  await tap('[data-act="deleteCapture"]', 'delete capture'); // confirm + company confirm auto-accepted
  await page.waitForFunction(n => S.captures.length === n - 1, before.caps, { timeout: 5000 });
  const after = await S(() => ({ caps: S.captures.length, cos: S.companies.length }));
  check(after.caps === before.caps - 1, 'capture deleted after confirm');
  if (delTargetCo && delTargetCo.key && delTargetCo.others === 0) {
    check(after.cos === before.cos - 1, 'last-product company record deleted after second confirm');
  }
  check(await S(() => !S.compareIds.some(id => !S.captures.some(c => c.id === id))), 'compare tray never references a deleted capture');

  section('day pack PDF');
  const pdfInfo = await S(async () => {
    const list = S.captures.slice();
    list.forEach(c => { c._company = companyOf(c.companyKey); });
    const { blob, pages } = await DayPack.build(list, supName, { title: 'Test day' });
    list.forEach(c => { delete c._company; });
    return { size: blob.size, type: blob.type, pages, n: list.length };
  });
  check(pdfInfo.size > 10000 && pdfInfo.type === 'application/pdf', 'day pack PDF built (' + pdfInfo.size + ' bytes)');
  check(pdfInfo.pages >= pdfInfo.n + 1, 'one page per capture plus a cover (' + pdfInfo.pages + ' pages for ' + pdfInfo.n + ')');

  section('day pack: choose a day, build, then share from a fresh tap');
  await tap('[data-act="nav"][data-arg="home"]', 'home');
  check(await page.locator('[data-act="nav"][data-arg="review"]').count() >= 1, 'review / day pack stays reachable from Today');
  await tap('[data-act="nav"][data-arg="review"]', 'review');
  await page.waitForSelector('[data-act="buildPack"]', { timeout: 5000 });
  check(await page.locator('[data-act="setPackDay"]').count() >= 1, 'day pack offers a day to choose');
  await tap('[data-act="togglePackShort"]', 'shortlisted only');
  check(await S(() => S.packShortOnly === true), 'shortlist-only scope toggles');
  await tap('[data-act="togglePackShort"]', 'all captures again');
  let shared = null;
  await S(() => { navigator.share = async (d) => { window.__shared = { n: d.files.length, name: d.files[0].name, type: d.files[0].type, size: d.files[0].size }; }; navigator.canShare = () => true; });
  await tap('[data-act="buildPack"]', 'build PDF');
  await page.waitForFunction(() => !!S.pack && !S.packBusy, null, { timeout: 120000 });
  check(await S(() => S.pack.pages >= 2 && /milana-day-pack-\d{4}-\d{2}-\d{2}\.pdf/.test(S.pack.name)), 'PDF built and named after the selected day: ' + await S(() => S.pack.name));
  await shot('20-day-pack-ready');
  await tap('[data-act="sharePack"]', 'share PDF');
  await sleep(300);
  shared = await S(() => window.__shared);
  check(shared && shared.type === 'application/pdf' && shared.size > 10000, 'share sheet receives the PDF file from the second tap');

  section('backup: pack today, save, wipe, import — everything comes back');
  const before2 = await S(() => ({ caps: S.captures.length, cos: S.companies.length, names: S.captures.map(c => c.name).sort() }));
  await tap('[data-act="nav"][data-arg="home"]', 'home');
  await tap('[data-act="openSettings"]', 'settings');
  await page.waitForSelector('[data-act="exportBackup"][data-arg="today"]', { timeout: 5000 });
  check(await page.locator('text=Trip readiness').count() === 1, 'settings shows a trip-readiness checklist');
  check(await page.locator('text=nothing is uploaded').count() >= 1, 'settings copy is honest about there being no sync');
  await tap('[data-act="exportBackup"][data-arg="today"]', 'back up today');
  await page.waitForFunction(() => !!S.backupReady && !S.backupBusy, null, { timeout: 60000 });
  const bk = await S(() => ({ n: S.backupReady.files.length, name: S.backupReady.files[0].name, bytes: S.backupReady.bytes }));
  check(bk.n === 1 && /\.milana$/.test(bk.name) && bk.bytes > 1000, 'backup packed into a .milana file (' + bk.name + ', ' + bk.bytes + ' bytes)');
  // keep the file in-page so it can be re-imported after a wipe
  await S(() => { window.__backupFile = S.backupReady.files[0]; navigator.share = async () => {}; });
  await tap('[data-act="shareBackup"]', 'save backup');
  await page.waitForFunction(() => !S.backupReady, null, { timeout: 5000 });
  check(await S(() => !!S.lastBackupAt), 'backup marked as saved');
  await closeSheet('settingsOn');
  await tap('[data-act="openSettings"]', 'settings');
  await tap('[data-act="eraseData"]', 'clear all data'); // confirm auto-accepted, no PIN
  await page.waitForFunction(() => S.captures.length === 0, null, { timeout: 8000 });
  check(await S(() => S.captures.length === 0 && S.companies.length === 0), 'clear all data wiped captures and companies');
  // clearing closes the sheet and returns to Today — import lives in Settings
  await tap('[data-act="openSettings"]', 'settings after the wipe');
  await page.waitForFunction(() => S.settingsOn && !!document.querySelector('#import-json'), null, { timeout: 5000 });
  await S(async () => {
    const dt = new DataTransfer(); dt.items.add(window.__backupFile);
    const inp = document.querySelector('#import-json'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(n => S.captures.length === n && !S.backupBusy, before2.caps, { timeout: 60000 });
  const after2 = await S(() => ({ caps: S.captures.length, cos: S.companies.length, names: S.captures.map(c => c.name).sort(),
    photosOk: S.captures.every(c => c.photos.product.length && c.photos.product.every(p => p.blob && p.blob.size > 0 && p.thumb)) }));
  check(after2.caps === before2.caps && JSON.stringify(after2.names) === JSON.stringify(before2.names), 'import restored every capture (' + after2.caps + ')');
  check(after2.cos >= 1, 'import restored the companies (' + after2.cos + ')');
  check(after2.photosOk, 'imported photos are real blobs with fresh thumbnails');
  await closeSheet('settingsOn');

  section('edit a completed record later');
  await tap('[data-act="nav"][data-arg="products"]', 'products');
  await page.locator('[data-act="openDetail"]').first().click();
  await page.waitForFunction(() => !!S.detailId, null, { timeout: 5000 });
  check(await page.locator('[data-act="openReview"]').count() === 1, 'a completed record still offers Edit');
  await tap('[data-act="openReview"]', 'edit');
  await page.waitForFunction(() => S.view === 'reviewItem', null, { timeout: 5000 });
  await page.waitForFunction(() => !S.rvBusy.card && !S.rvBusy.label, null, { timeout: 240000 });
  await page.fill('[data-input="rv.code"]', 'FW-45');
  await tap('[data-act="confirmReview"]', 'save changes');
  await page.waitForFunction(() => S.view === 'review', null, { timeout: 8000 });
  check(await S(() => S.captures.some(c => c.code === 'FW-45')), 'edited code saved on the completed record');
  await tap('[data-act="nav"][data-arg="home"]', 'home');

  section('service worker + offline');
  const cacheName = swCacheName();
  const swState = await S(async () => { await navigator.serviceWorker.ready; return caches.keys(); });
  check(cacheName && swState.includes(cacheName) && swState.filter(k => k.startsWith('milana-')).length === 1,
    'service worker installed cache ' + cacheName + ' and no stale ones: ' + JSON.stringify(swState));
  await ctx.setOffline(true);
  await page.reload();
  const offlineOk = await page.waitForSelector('text=Latest captures', { timeout: 15000 }).then(() => true).catch(() => false);
  check(offlineOk, 'app loads with no connection at all');
  await ctx.setOffline(false);

  section('clear all data (no PIN set → single confirm)');
  await tap('[data-act="openSettings"]', 'settings');
  await shot('19-settings');
  await tap('[data-act="eraseData"]', 'clear all data');
  await page.waitForFunction(() => S.captures.length === 0, null, { timeout: 8000 });
  check(await S(() => S.captures.length === 0 && S.companies.length === 0), 'clear all data wiped captures and companies');

  console.log('\nERRORS (' + errors.length + '):');
  errors.forEach(e => console.log('  ' + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(async e => {
  console.error('FATAL:', e.message);
  process.exit(2);
});
