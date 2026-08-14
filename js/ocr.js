/* On-device OCR (Tesseract.js) — runs at evening review only.
   All assets are vendored under ./vendor so OCR works fully offline.

   Why two passes: loading eng+chi_sim into a single recognition lets the
   Chinese model claim Latin words, which is what turned English text on
   cards into Chinese characters. Each script now gets its own pass with its
   own model, and the results are merged line by line — Latin lines come from
   the English model, Chinese lines from the Chinese model. Chinese is then
   translated (see js/zh.js) while the original characters are always kept. */

const OCR = {
  _workers: {},          // lang -> Promise<worker>
  _base() { return new URL('.', location.href).href.replace(/\/$/, ''); },

  _worker(lang) {
    if (!this._workers[lang]) {
      const base = this._base();
      this._workers[lang] = Tesseract.createWorker(lang, 1, {
        workerPath: base + '/vendor/worker.min.js',
        corePath: base + '/vendor/core',
        langPath: base + '/vendor/lang',
        gzip: true,
      }).then(async worker => {
        await worker.setParameters({
          user_defined_dpi: '300',
          preserve_interword_spaces: '1',
        });
        return worker;
      }).catch(err => {
        this._workers[lang] = null;
        throw err;
      });
    }
    return this._workers[lang];
  },

  /* Free both models — called when the review section is left. */
  async release() {
    const pending = Object.values(this._workers).filter(Boolean);
    this._workers = {};
    for (const p of pending) {
      try { const w = await p; await w.terminate(); } catch (err) { /* already gone */ }
    }
  },

  /* Real phone photos defeat OCR three ways: uneven light (a shadow across
     the label, a glare band on gloss), a few degrees of handheld rotation,
     and text on too few pixels.

     Two modes. 'gentle' (first attempt): grayscale + percentile contrast
     stretch — best for decent photos; it never distorts clean print.
     'flat' (the rescue attempt): estimate the local background by block-MAX
     pooling — paper is the brightest thing in any neighbourhood, so unlike a
     blur this never absorbs large display type into the "background" — and
     keep each pixel's difference from it. Shadows and glare cancel; a
     deadband flattens sensor grain so amplification can't turn it into a
     blizzard of specks. Light-on-dark labels are flipped dark-on-light
     first. Both modes finish with a projection-profile deskew, because a
     handheld photo is never square. */
  async preprocess(blob, opts = {}) {
    const target = opts.target || 2200;
    try {
      const bmp = await createImageBitmap(blob);
      const longEdge = Math.max(bmp.width, bmp.height);
      const scale = longEdge > target ? target / longEdge : Math.min(2.5, target / longEdge);
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(bmp, 0, 0, w, h);
      bmp.close && bmp.close();

      const img = x.getImageData(0, 0, w, h);
      const d = img.data;
      const g = new Uint8ClampedArray(w * h);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
        g[p] = v;
      }

      const hist = new Uint32Array(256);
      if (opts.mode === 'flat') {
        // polarity: compare against a rough average to see whether strokes
        // are darker or lighter than their surroundings; flip to dark-on-light
        x.putImageData(img, 0, 0); // (still colour; only used downscaled)
        const sw = Math.max(1, Math.round(w / 28)), sh = Math.max(1, Math.round(h / 28));
        const s1 = document.createElement('canvas'); s1.width = sw; s1.height = sh;
        s1.getContext('2d').drawImage(c, 0, 0, sw, sh);
        const bc = document.createElement('canvas'); bc.width = w; bc.height = h;
        const bx = bc.getContext('2d', { willReadFrequently: true });
        bx.drawImage(s1, 0, 0, w, h);
        const avg = bx.getImageData(0, 0, w, h).data;
        let dark = 0, light = 0;
        for (let p = 0; p < g.length; p++) {
          const diff = g[p] - (avg[p * 4] * 0.299 + avg[p * 4 + 1] * 0.587 + avg[p * 4 + 2] * 0.114);
          if (diff < -26) dark++;
          else if (diff > 26) light++;
        }
        if (light > dark * 1.35) for (let p = 0; p < g.length; p++) g[p] = 255 - g[p];

        // background = block-max pooling (cell 32px), lightly smoothed
        const cell = 32;
        const bw = Math.ceil(w / cell), bh = Math.ceil(h / cell);
        const bg = new Uint8Array(bw * bh);
        for (let by = 0; by < bh; by++) {
          for (let bxx = 0; bxx < bw; bxx++) {
            let m = 0;
            const y1 = Math.min(h, (by + 1) * cell), x1 = Math.min(w, (bxx + 1) * cell);
            for (let yy = by * cell; yy < y1; yy++) {
              for (let xx = bxx * cell; xx < x1; xx++) {
                if (g[yy * w + xx] > m) m = g[yy * w + xx];
              }
            }
            bg[by * bw + bxx] = m;
          }
        }
        const bg2 = new Uint8Array(bw * bh);
        for (let by = 0; by < bh; by++) {
          for (let bxx = 0; bxx < bw; bxx++) {
            let s = 0, n = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const yy = by + dy, xx = bxx + dx;
                if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) { s += bg[yy * bw + xx]; n++; }
              }
            }
            bg2[by * bw + bxx] = s / n;
          }
        }
        // difference from the background, deadband for grain, then amplify.
        // (bg is a max, so even background pixels sit a little below it —
        // the band is one-sided and slightly wider for it)
        const DEAD = 18;
        for (let p = 0; p < g.length; p++) {
          const px = p % w, py = (p / w) | 0;
          const gx = Math.min(bw - 1, Math.max(0, (px + 0.5) / cell - 0.5));
          const gy = Math.min(bh - 1, Math.max(0, (py + 0.5) / cell - 0.5));
          const x0 = gx | 0, y0 = gy | 0;
          const x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1);
          const fx = gx - x0, fy = gy - y0;
          const b = bg2[y0 * bw + x0] * (1 - fx) * (1 - fy) + bg2[y0 * bw + x1] * fx * (1 - fy)
            + bg2[y1 * bw + x0] * (1 - fx) * fy + bg2[y1 * bw + x1] * fx * fy;
          let diff = g[p] - b;
          diff = diff < -DEAD ? (diff + DEAD) * 2.4 : diff > DEAD ? (diff - DEAD) * 2.4 : 0;
          const v = Math.max(0, Math.min(255, 232 + diff)) | 0;
          g[p] = v;
          hist[v]++;
        }
      } else {
        // gentle: percentile contrast stretch (2nd–98th to full range)
        for (let p = 0; p < g.length; p++) hist[g[p]]++;
        const total = w * h;
        let lo = 0, hi = 255, acc = 0;
        for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.02) { lo = i; break; } }
        acc = 0;
        for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.02) { hi = i; break; } }
        if (hi - lo > 12) {
          hist.fill(0);
          const span = hi - lo;
          for (let p = 0; p < g.length; p++) {
            const v = Math.max(0, Math.min(255, ((g[p] - lo) * 255) / span)) | 0;
            g[p] = v;
            hist[v]++;
          }
        }
      }

      let thr = opts.binarize ? this._otsu(hist) : -1;
      if (thr >= 0) {
        // print covers a few percent of a real label; if the "ink" side of
        // the split is a third of the image, the threshold found texture,
        // not text. Stay grayscale instead.
        let ink = 0, total = 0;
        for (let i = 0; i < 256; i++) { total += hist[i]; if (i <= thr) ink += hist[i]; }
        if (ink / total > 0.3) thr = -1;
      }
      let bgVal = 0, bgN = 0;
      for (let i = 128; i < 256; i++) if (hist[i] > bgN) { bgN = hist[i]; bgVal = i; }
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const v = thr >= 0 ? (g[p] > thr ? 255 : 0) : g[p];
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
      x.putImageData(img, 0, 0);

      // deskew: find the rotation (±4°) that makes rows of dark pixels align
      const angle = this._skewAngle(g, w, h, opts.mode === 'flat' ? 160 : 110);
      let out = c;
      if (Math.abs(angle) >= 0.7) {
        const c2 = document.createElement('canvas');
        c2.width = w; c2.height = h;
        const x2 = c2.getContext('2d');
        x2.fillStyle = 'rgb(' + [thr >= 0 ? 255 : bgVal, thr >= 0 ? 255 : bgVal, thr >= 0 ? 255 : bgVal].join(',') + ')';
        x2.fillRect(0, 0, w, h);
        x2.translate(w / 2, h / 2);
        x2.rotate(-angle * Math.PI / 180);
        x2.drawImage(c, -w / 2, -h / 2);
        out = c2;
      }
      return await new Promise(res => out.toBlob(b => res(b || blob), 'image/png'));
    } catch (err) {
      return blob;
    }
  },

  /* Skew estimate: sample dark (text) pixels, project them onto rows at each
     candidate angle, and keep the angle whose row profile is spikiest — text
     aligned with the axis piles into few rows; skewed text smears. */
  _skewAngle(g, w, h, darkThr) {
    const pts = [];
    const stride = Math.max(1, Math.round(Math.sqrt((w * h) / 120000)));
    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        if (g[y * w + x] < darkThr) pts.push(x, y);
      }
    }
    const n = pts.length / 2;
    if (n < 400 || n > 200000) return 0;
    const binSize = 3 * stride;
    let bestA = 0, bestScore = -1;
    for (let a = -4; a <= 4; a += 0.8) {
      const rad = a * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const bins = new Map();
      for (let i = 0; i < pts.length; i += 2) {
        const b = Math.round((pts[i + 1] * cos - pts[i] * sin) / binSize);
        bins.set(b, (bins.get(b) || 0) + 1);
      }
      let sum = 0, sumSq = 0, k = 0;
      bins.forEach(v => { sum += v; sumSq += v * v; k++; });
      if (!k) continue;
      const mean = sum / k;
      const score = sumSq / k - mean * mean;
      if (score > bestScore) { bestScore = score; bestA = a; }
    }
    return bestA;
  },

  /* Otsu's threshold: split the histogram where between-class variance peaks. */
  _otsu(hist) {
    let total = 0, sum = 0;
    for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
    if (!total) return 128;
    let bg = 0, bgSum = 0, best = 128, bestVar = -1;
    for (let t = 0; t < 255; t++) {
      bg += hist[t]; bgSum += t * hist[t];
      if (!bg) continue;
      const fg = total - bg;
      if (!fg) break;
      const mb = bgSum / bg, mf = (sum - bgSum) / fg;
      const v = bg * fg * (mb - mf) * (mb - mf);
      if (v > bestVar) { bestVar = v; best = t; }
    }
    return best;
  },

  _linesOf(data) {
    if (Array.isArray(data.lines) && data.lines.length) return data.lines;
    const out = [];
    (data.blocks || []).forEach(b =>
      (b.paragraphs || []).forEach(p =>
        (p.lines || []).forEach(l => out.push(l))));
    if (out.length) return out;
    return String(data.text || '').split('\n')
      .filter(t => t.trim())
      .map((t, i) => ({ text: t, confidence: 60, bbox: { y0: i * 10, y1: i * 10 + 8, x0: 0, x1: 100 } }));
  },

  /* Glare edges and canvas borders read as stray junk glued to real lines
     ("t Danish Oil §"). Strip symbol runs and lone letters/digits from the
     line's edges — never from the middle. */
  _tidy(text) {
    let s = String(text).replace(/\s+/g, ' ').trim();
    s = s.replace(/^[^\w一-鿿(#$]+\s*/, '').replace(/\s*[^\w一-鿿)%.°"']+$/, '');
    const tokens = s.split(' ');
    while (tokens.length > 2 && /^[A-Za-z]$/.test(tokens[0])) tokens.shift();
    while (tokens.length > 2 && /^[A-Za-z0-9]$/.test(tokens[tokens.length - 1])) tokens.pop();
    return tokens.join(' ').trim();
  },

  /* psm '3' = automatic layout (best line grouping, but can discard very
     large display type as a "graphic"); psm '11' = sparse text (finds all
     text with no layout assumptions — catches what auto mode drops).
     NOTE: passes on the same language share one worker, so calls that change
     psm must be serialised per language, never Promise.all'd together. */
  async _pass(lang, image, psm) {
    const worker = await this._worker(lang);
    await worker.setParameters({ tessedit_pageseg_mode: psm || '3' });
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
    return this._linesOf(data).map(l => ({
      text: this._tidy(l.text),
      conf: typeof l.confidence === 'number' ? l.confidence : 60,
      y0: l.bbox ? l.bbox.y0 : 0,
      y1: l.bbox ? l.bbox.y1 : 0,
      x0: l.bbox ? (l.bbox.x0 || 0) : 0,
      x1: l.bbox ? (l.bbox.x1 || 0) : 0,
      lang, psm: psm || '3',
    })).filter(l => l.text.length > 1);
  },

  /* _pass with coordinates normalised to the image size, so lines from
     differently-scaled attempts can be compared row against row. */
  async _passN(lang, blob, psm) {
    let W = 1, H = 1;
    try {
      const bmp = await createImageBitmap(blob);
      W = bmp.width || 1; H = bmp.height || 1;
      bmp.close && bmp.close();
    } catch (err) { /* keep raw coords */ }
    const lines = await this._pass(lang, blob, psm);
    lines.forEach(l => { l.y0 /= H; l.y1 /= H; l.x0 /= W; l.x1 /= W; });
    return lines;
  },

  /* Confidence floors. Genuine printed text reads at 80–97 on a decent photo
     and can dip to 40–65 on a hard one; text invented out of blur or texture
     reads under 40. Latin lines between the floor and 70 must also pass the
     _wordish shape test, so a marginal real line survives while gibberish
     dies. The Chinese floor sits higher because a hallucinated Chinese line
     is the worse failure — it gets transliterated into confident-looking
     nonsense, whereas a dropped line just leaves the field blank to type. */
  MIN_CONF_LATIN: 45,
  MIN_CONF_CJK: 56,

  /* Does a low-confidence Latin line look like words? Gibberish read out of
     texture ("TR Ra Sy EG BTA…") is short vowel-less tokens; real label text
     has vowels, digits or units. */
  _wordish(text) {
    const tokens = String(text).split(/\s+/).filter(t => t.replace(/[^\w%.-]/g, '').length >= 2);
    if (!tokens.length) return false;
    const good = tokens.filter(t => /\d/.test(t)
      || (/[aeiouyAEIOUY]/.test(t) && t.replace(/\W/g, '').length >= 3)
      || /^(mm|cm|kg|ml|pcs?|no|qty|vac?|hz|kw)$/i.test(t.replace(/\W/g, '')));
    return good.length >= tokens.length * 0.5 && good.some(t => t.length >= 3);
  },

  /* How much believable text a pass produced — used to decide whether a
     second, harder attempt is worth it and which attempt to keep. */
  _strength(lines) {
    return lines.reduce((n, l) => n + (l.conf >= 45 && !this._noise(l.text)
      ? l.text.replace(/\s+/g, '').length * (l.conf / 100) : 0), 0);
  },

  /* Structural noise test, independent of confidence. Invented text has a
     shape real lines don't: isolated single glyphs, Latin letters sprinkled
     through Chinese, one character repeated over and over, or more
     punctuation than content. */
  _noise(text) {
    const t = String(text || '').trim();
    if (t.length < 2) return true;
    const chars = [...t];
    let letters = 0, cjk = 0, digits = 0;
    const seen = {};
    let topRepeat = 0;
    for (const ch of chars) {
      if (ZH.CJK.test(ch)) {
        cjk++;
        seen[ch] = (seen[ch] || 0) + 1;
        if (seen[ch] > topRepeat) topRepeat = seen[ch];
      } else if (/[A-Za-z]/.test(ch)) letters++;
      else if (/\d/.test(ch)) digits++;
    }
    const meaningful = letters + cjk + digits;
    if (!meaningful) return true;
    // more punctuation and stray symbols than actual content
    if (meaningful / chars.length < 0.55) return true;

    const tokens = t.split(/\s+/).filter(Boolean);
    // a scatter of loose single glyphs is a texture being read, not a line
    if (tokens.length >= 4) {
      const singles = tokens.filter(tk => [...tk].length === 1).length;
      if (singles / tokens.length > 0.5) return true;
    }
    if (cjk) {
      // Latin letters threaded through Chinese — the Chinese model chewing
      // on Latin text or on noise
      if (letters >= cjk * 0.4) return true;
      // one character stamped over and over ("沥 沥 沥 …"). Needs a long line
      // and a lot of repeats: 板 twice in 岩板 大板 is ordinary Chinese.
      if (cjk >= 6 && topRepeat >= 4 && topRepeat / cjk > 0.4) return true;
    }
    return false;
  },

  /* Run both models over both preprocessing variants and union the results
     line by line. The gentle variant is faithful to clean print; the flat
     variant recovers what shadows, glare and dark labels hide. Each physical
     row keeps its best reading — so a line only one variant caught still
     makes it through, instead of a wholesale winner dropping it. */
  async readLines(blob) {
    const [gentle, flat] = await Promise.all([
      this.preprocess(blob),
      this.preprocess(blob, { target: 2800, mode: 'flat', binarize: true }),
    ]);
    // per-language chains (a language's passes share one worker and change
    // psm, so they run in sequence; the two languages run side by side)
    const cjkOnly = ls => ls.filter(l => ZH.scriptOf(l.text) === 'cjk');
    const engChain = (async () => {
      // auto layout reads clean rows; sparse mode catches the display type
      // auto layout throws away as "graphics" — each covers the other
      const a = await this._passN('eng', gentle, '3').catch(() => []);
      const b = await this._passN('eng', flat, '3').catch(() => []);
      const c = await this._passN('eng', flat, '11').catch(() => []);
      return [...a, ...b, ...c];
    })();
    const chiChain = (async () => {
      const a = await this._passN('chi_sim', gentle, '3').catch(() => []);
      // a second Chinese pass only when the first saw Chinese but read it
      // poorly — an English-only photo never pays for it
      if (!cjkOnly(a).length || this._strength(cjkOnly(a)) >= 60) return a;
      const b = await this._passN('chi_sim', flat, '3').catch(() => []);
      return [...a, ...b];
    })();
    const [engAll, chiAll] = await Promise.all([engChain, chiChain]);

    const keep = [...engAll, ...chiAll].filter(l => {
      if (this._noise(l.text)) return false;
      const cjk = ZH.scriptOf(l.text) === 'cjk';
      // only the Chinese model may assert Chinese
      if (cjk && l.lang !== 'chi_sim') return false;
      if (cjk) return l.conf >= this.MIN_CONF_CJK;
      if (l.conf < this.MIN_CONF_LATIN) return false;
      // sparse mode reads specks of texture as tiny "words" — hold its lines
      // to a higher bar, and very short fragments to near-certainty
      if (l.psm === '11' && l.conf < 60) return false;
      if (l.text.replace(/[^A-Za-z0-9]/g, '').length <= 3 && l.conf < 90) return false;
      return l.conf >= 70 || this._wordish(l.text);
    });

    /* Same physical line read by both models → keep the stronger reading.
       A reading scores higher when it comes from the model trained on its
       script; Latin carries a further edge so a Chinese guess has to beat an
       English reading clearly, not merely tie it. */
    const score = x => {
      const s = ZH.scriptOf(x.text);
      return x.conf
        + (s === 'cjk' && x.lang === 'chi_sim' ? 15 : 0)
        + (s !== 'cjk' && x.lang === 'eng' ? 15 : 0)
        + (s !== 'cjk' ? 8 : 0);
    };
    const key = t => t.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');

    /* Cluster the surviving readings into physical rows by y-overlap. */
    keep.sort((a, b) => a.y0 - b.y0);
    const rows = [];
    for (const l of keep) {
      const row = rows.find(r => {
        const overlap = Math.min(r.y1, l.y1) - Math.max(r.y0, l.y0);
        const height = Math.max(1e-6, Math.min(r.y1 - r.y0, l.y1 - l.y0));
        return overlap / height > 0.55;
      });
      if (row) {
        row.items.push(l);
        row.y0 = Math.min(row.y0, l.y0); row.y1 = Math.max(row.y1, l.y1);
      } else {
        rows.push({ y0: l.y0, y1: l.y1, items: [l] });
      }
    }

    /* Within a row, competing readings of the same x-region resolve to one —
       widest-and-strongest first, so "DECKING SCRE" beats its own fragments —
       and what survives is stitched left-to-right back into a full line. */
    const merged = [];
    for (const row of rows) {
      const ordered = row.items.slice().sort((a, b) =>
        ((b.x1 - b.x0) * 2 + key(b.text).length * 0.01 + score(b) / 300)
        - ((a.x1 - a.x0) * 2 + key(a.text).length * 0.01 + score(a) / 300));
      const kept = [];
      for (const it of ordered) {
        const wid = Math.max(1e-6, it.x1 - it.x0);
        const covered = kept.some(k => {
          const ov = Math.min(k.x1, it.x1) - Math.max(k.x0, it.x0);
          return ov / wid > 0.55;
        });
        if (!covered) kept.push(it);
      }
      kept.sort((a, b) => a.x0 - b.x0);
      const text = kept.map(k => k.text).join(' ').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const len = kept.reduce((n, k) => n + k.text.length, 0) || 1;
      merged.push({
        text,
        conf: kept.reduce((n, k) => n + k.conf * k.text.length, 0) / len,
        y0: row.y0, y1: row.y1,
        x0: Math.min(...kept.map(k => k.x0)), x1: Math.max(...kept.map(k => k.x1)),
        lang: kept.slice().sort((a, b) => b.text.length - a.text.length)[0].lang,
      });
    }

    /* Variants can disagree slightly on where a row sits (deskew); if the
       same or a truncated copy of a line slipped past the row clustering,
       keep the fuller one only. */
    for (let i = merged.length - 1; i >= 0; i--) {
      const ki = key(merged[i].text);
      const dup = merged.findIndex((m, j) => j < i
        && (key(m.text) === ki || (ki.length > 5 && (key(m.text).startsWith(ki) || ki.startsWith(key(m.text))))));
      if (dup >= 0) {
        const a = merged[dup], b = merged[i];
        merged[dup] = key(a.text).length >= key(b.text).length ? a : b;
        merged.splice(i, 1);
      }
    }

    /* Whole-photo sanity check: a genuinely bilingual card carries at least
       one strong Chinese line. A page of English with a stray Chinese line
       left over is the model guessing — drop it. */
    const weigh = pred => merged.filter(pred).reduce((n, l) => n + [...l.text].length, 0);
    const latinWeight = weigh(l => ZH.scriptOf(l.text) !== 'cjk');
    const cjkWeight = weigh(l => ZH.scriptOf(l.text) === 'cjk');
    const strongCJK = merged.some(l => ZH.scriptOf(l.text) === 'cjk' && l.conf >= 75);
    if (cjkWeight && !strongCJK && latinWeight >= cjkWeight * 5) {
      return merged.filter(l => ZH.scriptOf(l.text) !== 'cjk');
    }
    return merged;
  },

  async read(blob) {
    const lines = await this.readLines(blob);
    return lines.map(l => l.text).join('\n');
  },

  // ── field extraction ───────────────────────────────────────────

  NOISE: /^(www\.|https?:|e-?mail|mail[:：]|add(ress)?[:：]|tel[:：]?$|fax|邮箱|地址|电话|传真|网址)/i,
  CO_ZH: /(有限公司|公司|集团|工厂|实业|建材|陶瓷|石材|门窗|家具|家私|木业|卫浴|灯饰|五金|铝业|厂$)/,
  CO_EN: /(co\.?\s*,?\s*ltd|company|corp|limited|industr|group|factory|enterprise|international|manufactur|trading|import|export|supplies|materials|works|studio|gallery|interiors|ceramics|tiles?|stone|marble|granite|quartz|slabs?|joinery|timber|cabinet|kitchens?|bath|doors?|windows?|glass|steel|alumini?um|metal|furniture|lighting|hardware|flooring|building material)/i,
  URL: /(https?:\/\/|www\.|\.com|\.cn|\.net|\.au)/i,
  ROLE: /(manager|director|sales|export|president|chairman|engineer|designer|经理|总监|销售|业务|外贸|工程师|设计师|主管|董事长|总裁)/i,
  // OCR often mangles the label itself ("WecChat", "Wechot") — stay loose
  WECHAT: /(w[a-z]{0,3}chat|weixin|微信(?:号|ID)?|wxid|whats\s?app)\s*[:：]?\s*([A-Za-z0-9_@.\-]{3,})/i,
  PHONE: /((?:\+?86[\s-]?)?1[3-9]\d{9}|\+?\d[\d\s\-()]{7,}\d)/,
  EMAIL: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,

  /* A field is always {value (English), zh (original characters)}. */
  _field(text, opts) {
    if (!text) return { value: '', zh: '' };
    const t = ZH.pair(text, opts);
    return { value: t.value, zh: ZH.hasCJK(text) ? text : '' };
  },

  /* Normalise lines (objects from readLines, or plain strings) into
     {text, conf, y0, y1, h} — h is the printed height of the line, the
     strongest clue to what a label is shouting vs whispering. */
  _items(lines) {
    return lines
      .map((l, i) => (typeof l === 'string'
        ? { text: l, conf: 70, y0: i * 10, y1: i * 10 + 8, h: 8 }
        : { text: l.text, conf: l.conf, y0: l.y0 || 0, y1: l.y1 || 0, h: Math.max(1, (l.y1 || 0) - (l.y0 || 0)) }))
      .filter(l => l.text);
  },

  /* The tallest believable line height — one junk bounding box that spans
     half the photo must not flatten everyone else's relative height. */
  _maxH(items) {
    const hs = items.map(l => l.h).sort((a, b) => a - b);
    if (!hs.length) return 1;
    const med = hs[(hs.length / 2) | 0] || 1;
    const sane = hs.filter(hh => hh <= med * 3.5);
    return Math.max(sane.length ? sane[sane.length - 1] : hs[hs.length - 1], 1e-6);
  },

  /* Business card / signage → company, contact person, WeChat / phone. */
  parseCard(lines) {
    const items = this._items(lines);
    const texts = items.map(l => l.text);
    const out = { company: { value: '', zh: '' }, contact: { value: '', zh: '' }, wechat: { value: '', zh: '' } };
    const maxH = this._maxH(items);
    const tallest = list => list.slice().sort((a, b) => Math.min(b.h, maxH) - Math.min(a.h, maxH))[0];

    // company: prefer the card's own printed English, keep the Chinese beside
    // it — and when several lines qualify, the one printed biggest wins
    const zhCo = tallest(items.filter(l => ZH.scriptOf(l.text) === 'cjk' && this.CO_ZH.test(l.text) && !this.NOISE.test(l.text)));
    const enCo = tallest(items.filter(l => ZH.scriptOf(l.text) === 'latin' && this.CO_EN.test(l.text)
      && !this.NOISE.test(l.text) && !this.EMAIL.test(l.text) && !this.URL.test(l.text)));
    if (enCo || zhCo) {
      out.company = {
        value: enCo ? enCo.text.trim() : ZH.pair(zhCo.text).value,
        zh: zhCo ? zhCo.text.trim() : '',
      };
    }

    // contact: a line carrying a role, minus the role word itself if it is the whole line
    const roleLine = texts.find(t => this.ROLE.test(t) && t.length <= 42 && t !== (out.company.zh || out.company.value));
    if (roleLine) out.contact = this._field(roleLine.trim(), { person: true });

    // wechat / phone
    for (const t of texts) {
      const m = t.match(this.WECHAT);
      if (m) { out.wechat = { value: m[2].trim(), zh: '' }; break; }
    }
    if (!out.wechat.value) {
      for (const t of texts) {
        const p = t.match(this.PHONE);
        if (p && p[1].replace(/\D/g, '').length >= 8) { out.wechat = { value: p[1].trim(), zh: '' }; break; }
      }
    }

    // last resort: the line printed biggest (and nearest the top) that could
    // plausibly be a name — an email address, a web address or a phone number
    // is never the company name
    if (!out.company.value) {
      const cands = items.filter(l => !this.NOISE.test(l.text) && !this.URL.test(l.text)
        && !this.EMAIL.test(l.text) && !this.PHONE.test(l.text)
        && l.text !== out.contact.value && l.text.length >= 3);
      if (cands.length) {
        const n = items.length;
        const score = l => (Math.min(l.h, maxH) / maxH) * 2 + l.conf / 100 - (items.indexOf(l) / n) * 0.5;
        out.company = this._field(cands.sort((a, b) => score(b) - score(a))[0].text.trim());
      }
    }
    if (!out.contact.value) {
      const cand = texts.find(t => t !== out.company.zh && t !== out.company.value
        && !this.NOISE.test(t) && !this.PHONE.test(t) && !this.EMAIL.test(t)
        && (/^[A-Za-z .·'-]{3,28}$/.test(t) || (ZH.scriptOf(t) === 'cjk' && t.length >= 2 && t.length <= 8)));
      if (cand) out.contact = this._field(cand.trim(), { person: true });
    }
    return out;
  },

  /* Label / spec sticker → product name, model code, size. */
  parseLabel(lines) {
    const items = this._items(lines);
    const texts = items.map(l => l.text);
    const out = { pname: { value: '', zh: '' }, code: { value: '', zh: '' }, size: { value: '', zh: '' } };
    const sizeRe = /(\d{2,5}(?:\.\d+)?\s*[×xX*✕]\s*\d{2,5}(?:\.\d+)?(?:\s*[×xX*✕]\s*\d{1,4}(?:\.\d+)?)?\s*(?:mm|cm|m)?|\d{1,4}(?:\.\d+)?\s*(?:mm|cm|ml|mg|kg|g|litres?|liters?|l)\b)/i;
    const codeRe = /\b([A-Z]{1,5}[-_ ]?\d{2,6}[A-Z0-9-]*)\b/;

    for (const t of texts) {
      // common OCR confusions inside sizes: 500m1 / 500mI → 500ml
      const s = t.replace(/(\d)\s*m[1iI]\b/g, '$1ml').match(sizeRe);
      if (s) {
        out.size = { value: s[1].replace(/\s*[xX*✕×]\s*/g, ' × ').replace(/\s+/g, ' ').trim(), zh: '' };
        break;
      }
    }
    for (const t of texts) {
      const stripped = t.replace(sizeRe, ' ');
      const c = stripped.match(codeRe);
      if (c) { out.code = { value: c[1].trim(), zh: '' }; break; }
    }

    // product name: prefer a labelled line (品名 / 名称 / Product), else the
    // line the label prints BIGGEST, weighted toward the top — the name is
    // shouted, while the longest line is usually directions or a warning
    const labelled = texts.find(t => /(品名|产品名称|名称|product\s*name)/i.test(t));
    if (labelled) {
      const after = labelled.split(/[:：]/).slice(1).join(':').trim();
      if (after) out.pname = this._field(after);
    }
    if (!out.pname.value) {
      const maxH = this._maxH(items);
      const n = items.length;
      const cands = items.filter(l => !sizeRe.test(l.text) && l.text !== out.code.value
        && l.text.length >= 3 && !/^[\d\s.,%-]+$/.test(l.text) && !this.NOISE.test(l.text)
        && !this.EMAIL.test(l.text) && !this.URL.test(l.text) && !this.PHONE.test(l.text)
        && !/^(model|size|type|art|item|code|sku|batch|serial|qty|made in)\b/i.test(l.text));
      if (cands.length) {
        const score = l => (Math.min(l.h, maxH) / maxH) * 2 + (1 - items.indexOf(l) / n) * 0.6 + l.conf / 200;
        const ranked = cands.slice().sort((a, b) => score(b) - score(a));
        // a bilingual label prints the product's own Latin name too — prefer
        // it over a Chinese category line when it's printed comparably big
        const latin = ranked.find(l => ZH.scriptOf(l.text) === 'latin');
        const best = latin && score(latin) >= score(ranked[0]) * 0.72 ? latin : ranked[0];
        out.pname = this._field(best.text.trim());
      }
    }
    // a bilingual label prints the Chinese name too — keep it beside the English
    if (out.pname.value && !out.pname.zh) {
      const zhLine = texts.find(t => ZH.scriptOf(t) === 'cjk' && !/[:：]/.test(t)
        && !sizeRe.test(t) && t.length >= 2 && t.length <= 20);
      if (zhLine) out.pname.zh = zhLine.trim();
    }
    if (out.pname.value.length > 60) out.pname.value = out.pname.value.slice(0, 60).trim();
    return out;
  },

  async readCard(blob) { return this.parseCard(await this.readLines(blob)); },
  async readLabel(blob) { return this.parseLabel(await this.readLines(blob)); },
};
