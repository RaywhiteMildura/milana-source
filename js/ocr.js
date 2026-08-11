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

  /* Photos are full-resolution now; Tesseract reads document text best around
     2000px on the long edge. Grayscale + a contrast stretch lifts printed text
     off card stock and glossy label plastic. */
  async preprocess(blob, target = 2000) {
    try {
      const bmp = await createImageBitmap(blob);
      // downscale big photos to `target`; upscale small crops so dense Chinese
      // glyphs land on enough pixels to be told apart
      const longEdge = Math.max(bmp.width, bmp.height);
      const scale = longEdge > target ? target / longEdge : Math.min(2, target / longEdge);
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(bmp, 0, 0, w, h);
      bmp.close && bmp.close();

      const img = x.getImageData(0, 0, w, h);
      const d = img.data;
      const hist = new Uint32Array(256);
      for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
        d[i] = d[i + 1] = d[i + 2] = g;
        hist[g]++;
      }
      // stretch the 2nd–98th percentile to full range
      const total = w * h;
      let lo = 0, hi = 255, acc = 0;
      for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.02) { lo = i; break; } }
      acc = 0;
      for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.02) { hi = i; break; } }
      if (hi - lo > 12) {
        const span = hi - lo;
        for (let i = 0; i < d.length; i += 4) {
          const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span));
          d[i] = d[i + 1] = d[i + 2] = v;
        }
      }
      x.putImageData(img, 0, 0);
      return await new Promise(res => c.toBlob(b => res(b || blob), 'image/png'));
    } catch (err) {
      return blob;
    }
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

  async _pass(lang, image) {
    const worker = await this._worker(lang);
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
    return this._linesOf(data).map(l => ({
      text: String(l.text || '').replace(/\s+/g, ' ').trim(),
      conf: typeof l.confidence === 'number' ? l.confidence : 60,
      y0: l.bbox ? l.bbox.y0 : 0,
      y1: l.bbox ? l.bbox.y1 : 0,
      lang,
    })).filter(l => l.text.length > 1);
  },

  /* Confidence floors. Measured on real photos: genuine printed text reads at
     80–97, while text invented out of blur, grain or a wood grain texture
     reads under 35. The Chinese floor sits higher because a hallucinated
     Chinese line is the worse failure — it gets transliterated into
     confident-looking nonsense, whereas a dropped line just leaves the field
     blank for the user to type. */
  MIN_CONF_LATIN: 50,
  MIN_CONF_CJK: 58,

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

  /* Run both models and keep, for each physical line, the best reading that
     is confident enough and structurally looks like text. */
  async readLines(blob) {
    const image = await this.preprocess(blob);
    const [eng, chi] = await Promise.all([
      this._pass('eng', image).catch(() => []),
      this._pass('chi_sim', image).catch(() => []),
    ]);

    const keep = [...eng, ...chi].filter(l => {
      if (this._noise(l.text)) return false;
      const cjk = ZH.scriptOf(l.text) === 'cjk';
      // only the Chinese model may assert Chinese
      if (cjk && l.lang !== 'chi_sim') return false;
      return l.conf >= (cjk ? this.MIN_CONF_CJK : this.MIN_CONF_LATIN);
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
    keep.sort((a, b) => a.y0 - b.y0);
    const merged = [];
    for (const l of keep) {
      const clash = merged.find(m => {
        const overlap = Math.min(m.y1, l.y1) - Math.max(m.y0, l.y0);
        const height = Math.max(1, Math.min(m.y1 - m.y0, l.y1 - l.y0));
        return overlap / height > 0.6;
      });
      if (!clash) { merged.push(l); continue; }
      if (score(l) > score(clash)) merged[merged.indexOf(clash)] = l;
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

  /* Business card / signage → company, contact person, WeChat / phone. */
  parseCard(lines) {
    const texts = lines.map(l => (typeof l === 'string' ? l : l.text)).filter(Boolean);
    const out = { company: { value: '', zh: '' }, contact: { value: '', zh: '' }, wechat: { value: '', zh: '' } };

    // company: prefer the card's own printed English, keep the Chinese beside it
    const zhCo = texts.find(t => ZH.scriptOf(t) === 'cjk' && this.CO_ZH.test(t) && !this.NOISE.test(t));
    const enCo = texts.find(t => ZH.scriptOf(t) === 'latin' && this.CO_EN.test(t) && !this.NOISE.test(t));
    if (enCo || zhCo) {
      out.company = {
        value: enCo ? enCo.trim() : ZH.pair(zhCo).value,
        zh: zhCo ? zhCo.trim() : '',
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

    // last resort: the longest line that could plausibly be a name — an email
    // address, a web address or a phone number is never the company name
    if (!out.company.value) {
      const cands = texts.filter(t => !this.NOISE.test(t) && !this.URL.test(t)
        && !this.EMAIL.test(t) && !this.PHONE.test(t) && t !== out.contact.value);
      if (cands.length) out.company = this._field(cands.reduce((a, b) => (b.length > a.length ? b : a)).trim());
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
    const texts = lines.map(l => (typeof l === 'string' ? l : l.text)).filter(Boolean);
    const out = { pname: { value: '', zh: '' }, code: { value: '', zh: '' }, size: { value: '', zh: '' } };
    const sizeRe = /(\d{2,5}\s*[×xX*✕]\s*\d{2,5}(?:\s*[×xX*✕]\s*\d{1,4})?\s*(?:mm|cm|m)?)/;
    const codeRe = /\b([A-Z]{1,5}[-_ ]?\d{2,6}[A-Z0-9-]*)\b/;

    for (const t of texts) {
      const s = t.match(sizeRe);
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

    // product name: prefer a labelled line (品名 / 名称 / Product), else the longest non-numeric line
    const labelled = texts.find(t => /(品名|产品名称|名称|product\s*name)/i.test(t));
    if (labelled) {
      const after = labelled.split(/[:：]/).slice(1).join(':').trim();
      if (after) out.pname = this._field(after);
    }
    if (!out.pname.value) {
      const cand = texts.filter(t => !sizeRe.test(t) && t !== out.code.value
        && t.length >= 3 && !/^[\d\s.,%-]+$/.test(t) && !this.NOISE.test(t));
      if (cand.length) out.pname = this._field(cand.reduce((a, b) => (b.length > a.length ? b : a)).trim());
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
