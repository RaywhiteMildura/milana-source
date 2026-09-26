/* English product labels drawn the way phone photos look (glare, shadow,
   light-on-dark, rotation, small text). A useful record must come out of each
   and no Chinese may ever be hallucinated from an English photo. */
const { launch, URL } = require('./harness');

(async () => {
  const { browser, page } = await launch({ camera: false });
  
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(URL);
  await page.waitForSelector('#login-form');

  const cases = await page.evaluate(async () => {
    // deterministic "sensor noise" so a run is reproducible, not a coin flip
    let seed = 20261012;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    function shot(draw, w, h, o = {}) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, w * 0.7, h);
      g.addColorStop(0, o.bg1 || '#f0ece4'); g.addColorStop(1, o.bg2 || '#b9b2a6'); // shadow gradient
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      if (o.blur) x.filter = 'blur(' + o.blur + 'px)';
      x.save();
      x.translate(w / 2, h / 2); x.rotate((o.rot || 0) * Math.PI / 180); x.translate(-w / 2, -h / 2);
      x.fillStyle = o.ink || '#26221d';
      draw(x, w, h);
      x.restore(); x.filter = 'none';
      if (o.glare) {
        const gg = x.createLinearGradient(0, 0, w, h * 0.8);
        gg.addColorStop(0.30, 'rgba(255,255,255,0)');
        gg.addColorStop(0.46, 'rgba(255,255,255,.62)');
        gg.addColorStop(0.60, 'rgba(255,255,255,0)');
        x.fillStyle = gg; x.fillRect(0, 0, w, h);
      }
      const img = x.getImageData(0, 0, w, h), d = img.data;
      const amp = o.noise == null ? 26 : o.noise;
      for (let i = 0; i < d.length; i += 4) {
        const n = (rnd() * amp * 2) - amp;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      x.putImageData(img, 0, 0);
      return c;
    }

    const imgs = {};

    // 1. paint tin, serif brand, glare band across the middle
    imgs['paint-tin-serif-glare'] = shot(x => {
      x.font = 'bold 78px Georgia'; x.fillText("CABOT'S", 90, 150);
      x.font = 'italic 46px Georgia'; x.fillText('Danish Oil', 90, 235);
      x.font = '34px Georgia'; x.fillText('Interior Timber Finish', 90, 320);
      x.font = '30px Georgia'; x.fillText('Enhances natural timber grain', 90, 390);
      x.font = 'bold 38px Arial'; x.fillText('500ml', 90, 470);
    }, 1300, 560, { rot: -2, glare: true });

    // 2. sealant cartridge, condensed bold caps (scaled narrow), shadow
    imgs['sealant-condensed'] = shot(x => {
      x.save(); x.scale(0.72, 1);
      x.font = 'bold 92px Arial'; x.fillText('SIKAFLEX PRO', 120, 160);
      x.restore();
      x.font = '36px Arial'; x.fillText('Polyurethane Joint Sealant', 88, 260);
      x.font = '34px Arial'; x.fillText('Colour: Limestone  310ml', 88, 330);
      x.font = '28px Arial'; x.fillText('AS/NZS 4858 compliant', 88, 400);
    }, 1250, 500, { rot: 1.6, bg2: '#a49c8e' });

    // 3. glue bottle — WHITE text on a near-black label (polarity flip test)
    imgs['glue-light-on-dark'] = shot(x => {
      x.fillStyle = '#17140f'; x.fillRect(60, 40, 1080, 420);
      x.fillStyle = '#f4f1ea';
      x.font = 'bold 84px Arial'; x.fillText('TITEBOND III', 110, 170);
      x.font = '40px Arial'; x.fillText('Ultimate Wood Glue', 110, 260);
      x.font = '34px Arial'; x.fillText('Waterproof  ANSI Type I', 110, 330);
      x.font = 'bold 36px Arial'; x.fillText('946ml', 110, 410);
    }, 1200, 520, { rot: -1, noise: 20 });

    // 4. hardware box, sans caps + digits, rotated harder
    imgs['screws-box'] = shot(x => {
      x.font = 'bold 64px Arial'; x.fillText('DECKING SCREWS', 80, 140);
      x.font = '42px Arial'; x.fillText('10g x 50mm  Square Drive', 80, 230);
      x.font = '38px Arial'; x.fillText('Stainless 316  Pack of 500', 80, 300);
      x.font = '30px Arial'; x.fillText('For hardwood and treated pine decks', 80, 370);
    }, 1250, 470, { rot: 3.4, glare: true });

    // 5. small rating plate — tiny text, blur, glare (previously unreadable)
    imgs['rating-plate-small'] = shot(x => {
      x.font = '26px Arial';
      ['MIELE PROFESSIONAL', 'Type: PWM 507 DV', 'Nominal capacity 7 kg',
        'Drum volume 64 litres', 'Made in Germany  2026'].forEach((t, i) => x.fillText(t, 60, 90 + i * 52));
    }, 900, 420, { blur: 1.4, rot: -3, glare: true, noise: 30 });

    // 6. tile sample sticker — mixed serif/sans, a size the parser must find
    imgs['tile-sticker'] = shot(x => {
      x.font = 'bold 58px Georgia'; x.fillText('Carrara Look', 80, 130);
      x.font = '40px Arial'; x.fillText('Porcelain  Matt  Rectified', 80, 220);
      x.font = '38px Arial'; x.fillText('600 x 1200 x 9mm', 80, 300);
      x.font = '32px Arial'; x.fillText('Item TL-4471  Grade AAA', 80, 370);
    }, 1200, 470, { rot: 0.8 });

    // 7. texture-only control — must still read as nothing
    imgs['texture-control'] = shot((x, w, h) => {
      for (let i = 0; i < 260; i++) {
        x.fillStyle = 'rgba(' + (90 + rnd() * 70 | 0) + ',' + (70 + rnd() * 55 | 0) + ',50,.5)';
        x.fillRect(rnd() * w, rnd() * h, 4 + rnd() * 90, 3 + rnd() * 26);
      }
    }, 900, 500, { blur: 0.8, noise: 34 });

    const out = {};
    for (const [name, canvas] of Object.entries(imgs)) {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const t0 = Date.now();
      const lines = await OCR.readLines(blob);
      out[name] = {
        ms: Date.now() - t0,
        lines: lines.map(l => l.lang + ' ' + Math.round(l.conf) + ' | ' + l.text),
        label: OCR.parseLabel(lines),
        card: OCR.parseCard(lines),
        cjk: lines.some(l => /[一-鿿]/.test(l.text)),
      };
    }
    return out;
  });

  /* Pass = a useful record: the product name field lands on the brand OR the
     descriptive product line (both are honest answers on a real label), sizes
     found where legible, and — the original bug — zero Chinese from English
     photos. The mangled-on-purpose images accept partial reads. */
  const expect = {
    'paint-tin-serif-glare': { pname: /CABOT|Danish Oil/i },
    'sealant-condensed': { pname: /SIKAFLEX/i, size: /310\s*ml/i },
    'glue-light-on-dark': { pname: /TITEBOND|Wood Glue/i, size: /946\s*ml/i },
    'screws-box': { pname: /DECKING/i, size: /50mm|10g/i },
    'rating-plate-small': { pname: /MIELE|PWM|capacity|Drum|Germany/i, size: /7\s*kg|64\s*litres/i },
    'tile-sticker': { pname: /Carrara/i, size: /600\s*×\s*1200/i },
    'texture-control': { junkMax: 2 },
  };
  let fails = 0;
  for (const [name, r] of Object.entries(cases)) {
    console.log('\n══════ ' + name + ' (' + (r.ms / 1000).toFixed(1) + 's) ══════');
    r.lines.forEach(l => console.log('   ' + l));
    console.log('  pname:', JSON.stringify(r.label.pname.value), ' code:', JSON.stringify(r.label.code.value), ' size:', JSON.stringify(r.label.size.value));
    const e = expect[name];
    const ok = e.junkMax != null
      ? (r.lines.length <= e.junkMax && !r.cjk)
      : (e.pname.test(r.label.pname.value) && (!e.size || e.size.test(r.label.size.value)) && !r.cjk);
    console.log('  ' + (ok ? 'PASS' : '*** FAIL'));
    if (!ok) fails++;
  }
  console.log('\nRESULT: ' + (Object.keys(cases).length - fails) + '/' + Object.keys(cases).length + ' labels correct');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
