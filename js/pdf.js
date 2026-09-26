/* Day-pack export — one tidy PDF of a day's captures (photos, tags, quotes, notes).
   Pages are composed on <canvas> (so Chinese text renders with system fonts) and
   embedded into a PDF via vendored jsPDF, then handed to the share sheet.

   Built for a phone: ONE page canvas is reused for every page (iOS caps total
   canvas memory), small slots draw from the stored 480px thumbnails, only the
   hero decodes the full photo — resized on decode where the browser allows —
   and every bitmap is released as soon as it is drawn. Text is budgeted
   against the page: what does not fit continues on an extra page instead of
   being drawn off the bottom. */

const DayPack = {
  W: 1240, H: 1754, M: 84, // A4 @150dpi-ish
  _canvas: null,

  _jspdfPromise: null,
  _jspdf() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    if (!this._jspdfPromise) {
      this._jspdfPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = './vendor/jspdf.umd.min.js';
        s.onload = () => resolve(window.jspdf);
        s.onerror = () => { this._jspdfPromise = null; reject(new Error('jsPDF failed to load')); };
        document.head.appendChild(s);
      });
    }
    return this._jspdfPromise;
  },

  _page() {
    const c = this._canvas || (this._canvas = document.createElement('canvas'));
    if (c.width !== this.W || c.height !== this.H) { c.width = this.W; c.height = this.H; }
    const x = c.getContext('2d');
    if (!x) throw new Error('The phone is short of drawing memory — close other apps and try again.');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#f4f0e9'; x.fillRect(0, 0, this.W, this.H);
    return { c, x };
  },

  _serif(px, weight = 400) { return `${weight === 700 ? 'bold ' : ''}${px}px Georgia, "Times New Roman", serif`; },
  _sans(px, weight = 400) { return `${weight >= 700 ? 'bold ' : ''}${px}px -apple-system, "Helvetica Neue", "PingFang SC", "Noto Sans CJK SC", sans-serif`; },

  _wrap(x, text, maxWidth) {
    const out = [];
    for (const rawLine of String(text).split('\n')) {
      let line = '';
      // split on spaces but also break long CJK runs char-by-char
      const tokens = rawLine.split(/(\s+)/);
      for (const tok of tokens) {
        for (const piece of (x.measureText(tok).width > maxWidth ? tok.split('') : [tok])) {
          if (x.measureText(line + piece).width > maxWidth && line.trim()) { out.push(line.trimEnd()); line = piece.trimStart(); }
          else line += piece;
        }
      }
      out.push(line.trimEnd());
    }
    return out;
  },

  /* Height a block of text will take, so the page budget can be checked
     before drawing. */
  _measure(x, text, font, maxWidth, lineH = 1.35, max = 0) {
    x.font = font;
    let lines = this._wrap(x, text, maxWidth);
    if (max && lines.length > max) lines = lines.slice(0, max);
    const px = parseInt(font.match(/(\d+)px/)[1], 10);
    return lines.length * px * lineH;
  },

  _text(x, text, tx, ty, { font, color = '#201a17', maxWidth = this.W - 2 * this.M, lineH = 1.35, max = 0 } = {}) {
    x.font = font; x.fillStyle = color; x.textBaseline = 'top';
    let lines = this._wrap(x, text, maxWidth);
    if (max && lines.length > max) { lines = lines.slice(0, max); lines[max - 1] += '…'; }
    const px = parseInt(font.match(/(\d+)px/)[1], 10);
    lines.forEach((l, i) => x.fillText(l, tx, ty + i * px * lineH));
    return ty + lines.length * px * lineH;
  },

  _rr(x, rx, ry, rw, rh, r) {
    x.beginPath();
    x.moveTo(rx + r, ry);
    x.arcTo(rx + rw, ry, rx + rw, ry + rh, r);
    x.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
    x.arcTo(rx, ry + rh, rx, ry, r);
    x.arcTo(rx, ry, rx + rw, ry, r);
    x.closePath();
  },

  _chip(x, label, cx, cy, bg, fg) {
    x.font = this._sans(22, 700);
    const w = x.measureText(label).width + 40;
    this._rr(x, cx, cy, w, 46, 23);
    x.fillStyle = bg; x.fill();
    x.fillStyle = fg; x.textBaseline = 'middle';
    x.fillText(label, cx + 20, cy + 24);
    x.textBaseline = 'top';
    return w;
  },

  /* A row of chips that wraps onto new lines instead of running off the page. */
  _chips(x, chips, cy) {
    let px = this.M, py = cy;
    x.font = this._sans(22, 700);
    for (const ch of chips) {
      const w = x.measureText(ch.t).width + 40;
      if (px > this.M && px + w > this.W - this.M) { px = this.M; py += 60; }
      this._chip(x, ch.t, px, py, ch.bg, ch.fg);
      px += w + 14;
    }
    return py + 66;
  },

  /* Decode for drawing. maxW asks the browser to resize on decode (no 12 MP
     bitmap ever exists); the plain Image path is the fallback. */
  async _img(blob, maxW) {
    if (!blob) return null;
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob, maxW ? { resizeWidth: maxW, resizeQuality: 'high' } : {}); } catch (e) { /* fall through */ }
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await (img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = rej; }));
      return img;
    } catch (err) { return null; } finally { URL.revokeObjectURL(url); }
  },
  _release(img) {
    if (!img) return;
    try { if (img.close) img.close(); else img.src = ''; } catch (e) { /* already gone */ }
  },

  _cover(x, img, dx, dy, dw, dh, r) {
    this._rr(x, dx, dy, dw, dh, r);
    x.save(); x.clip();
    if (img) {
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const s = Math.max(dw / iw, dh / ih);
      const sw = dw / s, sh = dh / s;
      x.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, dx, dy, dw, dh);
    } else {
      x.fillStyle = '#ebe3d8'; x.fillRect(dx, dy, dw, dh);
      x.fillStyle = '#a2937f'; x.font = this._sans(20, 700);
      x.fillText('no photo', dx + 18, dy + dh / 2 - 10);
    }
    x.restore();
    this._rr(x, dx, dy, dw, dh, r);
    x.strokeStyle = '#d7cbbd'; x.lineWidth = 2; x.stroke();
  },

  /* captures: the records to include (each may carry _company);
     opts.title — "Day 3 · 14 Oct"; opts.dateStr — long date for the cover;
     opts.onProgress(done, total). Returns {blob, pages}. */
  async build(captures, supName, opts = {}) {
    const { jsPDF } = await this._jspdf();
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const dateStr = opts.dateStr || new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const title = opts.title || '';
    let pages = 0;
    const commit = (c) => {
      if (pages > 0) pdf.addPage();
      pdf.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 595.28, 841.89);
      pages++;
    };
    const yieldUI = () => new Promise(r => setTimeout(r, 0));

    // ---- cover page ----
    {
      const { c, x } = this._page();
      x.fillStyle = '#201a17'; x.fillRect(0, 0, this.W, 420);
      x.strokeStyle = '#c9aa78'; x.lineWidth = 3;
      x.beginPath(); x.arc(this.M + 44, 150, 44, 0, Math.PI * 2); x.stroke();
      x.fillStyle = '#c9aa78'; x.font = this._serif(52, 700); x.textBaseline = 'middle';
      x.fillText('M', this.M + 27, 156); x.textBaseline = 'top';
      x.fillStyle = '#ffffff'; x.font = this._serif(64);
      x.fillText('Milana Source — Day pack', this.M, 230);
      x.fillStyle = 'rgba(255,255,255,.7)'; x.font = this._sans(26);
      x.fillText([title, dateStr, projName()].filter(Boolean).join(' · '), this.M, 320, this.W - 2 * this.M);

      let y = 500;
      x.fillStyle = '#201a17'; x.font = this._serif(40);
      x.fillText(captures.length + (captures.length === 1 ? ' capture' : ' captures'), this.M, y);
      y += 80;
      x.font = this._sans(26);
      for (const cpt of captures) {
        if (y > this.H - 160) { x.fillStyle = '#625852'; x.fillText('…and more inside', this.M, y); break; }
        x.fillStyle = '#625852';
        const name = cpt.name || (cpt.category + ' — untitled');
        x.fillText('•  ' + name + '   —   ' + supName(cpt) + ' · ' + cpt.venue, this.M, y, this.W - 2 * this.M);
        y += 44;
      }
      x.fillStyle = '#9d7643'; x.font = this._sans(22);
      x.fillText('Captured with Milana Source · photos, tags and quotes together · one page per product', this.M, this.H - 100);
      commit(c);
    }

    // ---- one page per capture ----
    const ST_COLORS = { Preferred: ['#e3efe8', '#355f4b'], Shortlisted: ['#e3efe8', '#355f4b'], Captured: ['#ebe3d8', '#625852'], 'Needs review': ['#f5ead8', '#94601e'], 'Quote requested': ['#f5ead8', '#94601e'], Rejected: ['#f6e5e3', '#8b2d2d'] };
    let done = 0;
    for (const cpt of captures) {
      const name = cpt.name || (cpt.category + ' — untitled');
      let { c, x } = this._page();
      const header = (continued) => {
        x.fillStyle = '#201a17'; x.fillRect(0, 0, this.W, continued ? 150 : 250);
        const hy = this._text(x, name + (continued ? '  (continued)' : ''), this.M, continued ? 44 : 70, { font: this._serif(continued ? 40 : 52), color: '#ffffff', max: continued ? 1 : 2 });
        if (!continued) this._text(x, supName(cpt) + ' · ' + cpt.venue + ' · ' + fmtTime(cpt.createdAt), this.M, Math.min(hy + 8, 186), { font: this._sans(26), color: 'rgba(255,255,255,.72)', max: 1 });
      };
      header(false);

      // photos: product hero + label/card column
      const hero = cpt.photos.product[0];
      const heroImg = await this._img(hero && hero.blob, 1400);
      const labelImg = await this._img(cpt.photos.label && photoThumb(cpt.photos.label));
      const cardP = cpt.photos.card || (typeof cardPhotoOf === 'function' ? cardPhotoOf(cpt) : null);
      const cardImg = await this._img(cardP && photoThumb(cardP));
      let y = 300;
      this._cover(x, heroImg, this.M, y, 700, 540, 22);
      this._cover(x, labelImg, this.M + 724, y, 348, 260, 18);
      x.fillStyle = '#625852'; x.font = this._sans(20, 700);
      x.fillText('label / spec', this.M + 724, y + 268);
      this._cover(x, cardImg, this.M + 724, y + 306, 348, 200, 18);
      x.fillText('company card', this.M + 724, y + 514);
      this._release(heroImg); this._release(labelImg); this._release(cardImg);
      // extra product faces
      const extras = cpt.photos.product.slice(1, 5);
      if (extras.length) {
        let ex = this.M;
        for (const p of extras) {
          const img = await this._img(photoThumb(p));
          this._cover(x, img, ex, y + 564, 166, 124, 14);
          this._release(img);
          ex += 178;
        }
      }
      y += extras.length ? 730 : 600;

      // chips (wrapping)
      const st = ST_COLORS[cpt.needsReview ? 'Needs review' : cpt.status] || ST_COLORS.Captured;
      const chips = [{ t: cpt.needsReview ? 'Needs review' : cpt.status, bg: st[0], fg: st[1] },
        { t: cpt.category, bg: '#201a17', fg: '#ffffff' }, { t: '◎ ' + cpt.venue, bg: '#ebe3d8', fg: '#625852' }];
      if (cpt.rating) chips.push({ t: '★ ' + cpt.rating + '/5', bg: '#f5ead8', fg: '#94601e' });
      (cpt.rooms || []).forEach(r => chips.push({ t: r, bg: '#f4e6ea', fg: '#6f273a' }));
      if (cpt.price) chips.push({ t: cpt.currency + ' ' + cpt.price, bg: '#ebe3d8', fg: '#625852' });
      y = this._chips(x, chips, y) + 20;

      // text blocks, budgeted: anything that will not fit goes to a
      // continuation page rather than off the bottom
      const bottom = this.H - this.M;
      const ensure = (need) => {
        if (y + need <= bottom) return;
        commit(c);
        ({ c, x } = this._page());
        header(true);
        y = 190;
      };
      const facts = [];
      if (cpt.nameZh) facts.push(['Name (中文)', cpt.nameZh]);
      if (cpt.code) facts.push(['Model / code', cpt.code]);
      if (cpt.size) facts.push(['Size / spec', cpt.size]);
      const co = cpt._company;
      if (co && co.nameZh) facts.push(['Company (中文)', co.nameZh]);
      if (co && co.contact) facts.push(['Contact', co.contact]);
      if (co && co.wechat) facts.push(['WeChat / phone', co.wechat]);
      if (co && co.website) facts.push(['Website', co.website]);
      for (const [k, v] of facts) {
        ensure(48);
        x.font = this._sans(26); x.fillStyle = '#625852'; x.textBaseline = 'top'; x.fillText(k, this.M, y);
        x.fillStyle = '#201a17'; x.font = this._sans(26, 700);
        x.fillText(String(v), this.M + 320, y, this.W - this.M * 2 - 320);
        y += 48;
      }
      const block = (label, text, font, color, max) => {
        if (!text) return;
        const need = (label ? 36 : 0) + this._measure(x, text, font, this.W - 2 * this.M, 1.35, max) + 16;
        ensure(Math.min(need, bottom - 190));
        y += 16;
        if (label) { x.fillStyle = '#94601e'; x.font = this._sans(20, 700); x.textBaseline = 'top'; x.fillText(label, this.M, y); y += 36; }
        y = this._text(x, text, this.M, y, { font, color, max });
      };
      block('', cpt.note, this._sans(26), '#3d3530', 12);
      block('LOOKUP NOTES', co && co.notes, this._sans(24), '#3d3530', 10);
      block('AI LOOKUP — VERIFY YOURSELF', co && co.bio, this._sans(24), '#3d3530', 14);
      if (cpt.voiceNote) {
        ensure(40);
        x.fillStyle = '#9d7643'; x.font = this._sans(22, 700); x.textBaseline = 'top';
        x.fillText('● voice note ' + fmtClock(cpt.voiceNote.duration) + ' — on the phone record', this.M, y + 16);
      }
      commit(c);
      done++;
      if (opts.onProgress) opts.onProgress(done, captures.length);
      await yieldUI();
    }

    const blob = pdf.output('blob');
    if (this._canvas) { this._canvas.width = this._canvas.height = 0; }
    return { blob, pages };
  },

  /* Kept for callers that only want the file. */
  async share(blob, filename) {
    return shareOrDownload(filename, blob, 'application/pdf');
  },
};
