/* On-device OCR (Tesseract.js, chi_sim + eng) — runs at evening review only.
   All assets are vendored under ./vendor so OCR works fully offline. */

const OCR = {
  _workerPromise: null,

  _worker() {
    if (!this._workerPromise) {
      const base = new URL('.', location.href).href.replace(/\/$/, '');
      this._workerPromise = Tesseract.createWorker(['eng', 'chi_sim'], 1, {
        workerPath: base + '/vendor/worker.min.js',
        corePath: base + '/vendor/core',
        langPath: base + '/vendor/lang',
        gzip: true,
      }).catch(err => {
        this._workerPromise = null;
        throw err;
      });
    }
    return this._workerPromise;
  },

  async read(blob) {
    const worker = await this._worker();
    const { data } = await worker.recognize(blob);
    return data.text || '';
  },

  _lines(text) {
    return text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 1);
  },

  /* Business card / signage → company name, contact person, WeChat / phone.
     Heuristics only — the user always confirms before anything is committed. */
  parseCard(text) {
    const lines = this._lines(text);
    const out = { company: '', contact: '', wechat: '' };
    const coRe = /(co\.?,?\s*ltd|company|corp|limited|有限公司|公司|厂|集团|建材|陶瓷|石材|家具|门窗|卫浴)/i;
    const wechatRe = /(wechat|weixin|微信|whatsapp|wxid)[:：]?\s*([A-Za-z0-9_@.\-]{3,})/i;
    const phoneRe = /(\+?\d[\d\s\-()]{6,}\d)/;
    const roleRe = /(manager|director|sales|export|经理|总监|销售|业务|主管|market)/i;
    const noiseRe = /^(www\.|http|e-?mail|mail[:：]|add(ress)?[:：]|tel[:：]?$|fax|邮箱|地址|电话|传真)/i;

    for (const l of lines) {
      if (!out.company && coRe.test(l) && !noiseRe.test(l)) { out.company = l; continue; }
      const w = l.match(wechatRe);
      if (!out.wechat && w) { out.wechat = w[2]; continue; }
      if (!out.contact && roleRe.test(l) && l.length <= 40) { out.contact = l; continue; }
    }
    if (!out.wechat) {
      for (const l of lines) {
        const p = l.match(phoneRe);
        if (p && p[1].replace(/\D/g, '').length >= 7) { out.wechat = p[1].trim(); break; }
      }
    }
    if (!out.company && lines.length) {
      out.company = lines.reduce((a, b) => (b.length > a.length ? b : a), '');
    }
    if (!out.contact) {
      const cand = lines.find(l => l !== out.company && /^[A-Za-z一-鿿 .·]{2,24}$/.test(l) && !noiseRe.test(l));
      if (cand) out.contact = cand;
    }
    return out;
  },

  /* Label / spec sticker → product name, model code, size. */
  parseLabel(text) {
    const lines = this._lines(text);
    const out = { pname: '', code: '', size: '' };
    const sizeRe = /(\d{2,5}\s*[×xX*]\s*\d{2,5}(\s*[×xX*]\s*\d{1,4})?\s*(mm|cm|m)?)/;
    const codeRe = /\b([A-Z]{1,5}[-_ ]?\d{2,6}[A-Z0-9-]*)\b/;

    for (const l of lines) {
      const s = l.match(sizeRe);
      if (!out.size && s) { out.size = s[1].replace(/\s*[xX*]\s*/g, ' × ').replace(/\s+/g, ' ').trim(); }
    }
    for (const l of lines) {
      const c = l.match(codeRe);
      if (!out.code && c && !sizeRe.test(c[1])) { out.code = c[1].trim(); break; }
    }
    const nameCand = lines.filter(l => !sizeRe.test(l) && l !== out.code && l.length >= 3 && !/^\d+$/.test(l));
    if (nameCand.length) out.pname = nameCand.reduce((a, b) => (b.length > a.length ? b : a), '');
    if (out.pname.length > 48) out.pname = out.pname.slice(0, 48).trim();
    return out;
  },

  async readCard(blob)  { return this.parseCard(await this.read(blob)); },
  async readLabel(blob) { return this.parseLabel(await this.read(blob)); },
};
