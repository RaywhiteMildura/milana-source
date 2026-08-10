/* Day-pack export — one tidy PDF of the day's captures (photos, tags, quotes, notes).
   Pages are composed on <canvas> (so Chinese text renders with system fonts) and
   embedded into a PDF via vendored jsPDF. Shared through the system share sheet. */

const DayPack = {
  W: 1240, H: 1754, M: 84, // A4 @150dpi-ish

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
    const c = document.createElement('canvas');
    c.width = this.W; c.height = this.H;
    const x = c.getContext('2d');
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

  async _img(blob) {
    if (!blob) return null;
    try {
      const img = new Image();
      img.src = urlFor(blob);
      await (img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = rej; }));
      return img;
    } catch (err) { return null; }
  },

  _cover(x, img, dx, dy, dw, dh, r) {
    this._rr(x, dx, dy, dw, dh, r);
    x.save(); x.clip();
    if (img) {
      const s = Math.max(dw / img.naturalWidth, dh / img.naturalHeight);
      const sw = dw / s, sh = dh / s;
      x.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, dx, dy, dw, dh);
    } else {
      x.fillStyle = '#ebe3d8'; x.fillRect(dx, dy, dw, dh);
      x.fillStyle = '#a2937f'; x.font = this._sans(20, 700);
      x.fillText('no photo', dx + 18, dy + dh / 2 - 10);
    }
    x.restore();
    this._rr(x, dx, dy, dw, dh, r);
    x.strokeStyle = '#d7cbbd'; x.lineWidth = 2; x.stroke();
  },

  async build(captures, supName) {
    const { jsPDF } = await this._jspdf();
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

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
      x.fillText(dateStr + ' · Villa Milana d’Oro · China sourcing trip', this.M, 320);

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
      pdf.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 595.28, 841.89);
    }

    // ---- one page per capture ----
    const ST_COLORS = { Preferred: ['#e3efe8', '#355f4b'], Shortlisted: ['#e3efe8', '#355f4b'], Captured: ['#ebe3d8', '#625852'], 'Needs review': ['#f5ead8', '#94601e'], 'Quote requested': ['#f5ead8', '#94601e'], Rejected: ['#f6e5e3', '#8b2d2d'] };
    for (const cpt of captures) {
      const { c, x } = this._page();
      x.fillStyle = '#201a17'; x.fillRect(0, 0, this.W, 250);
      const name = cpt.name || (cpt.category + ' — untitled');
      x.fillStyle = '#fff';
      let hy = this._text(x, name, this.M, 70, { font: this._serif(52), color: '#ffffff', max: 2 });
      this._text(x, supName(cpt) + ' · ' + cpt.venue + ' · ' + fmtTime(cpt.createdAt), this.M, Math.min(hy + 8, 186), { font: this._sans(26), color: 'rgba(255,255,255,.72)', max: 1 });

      // photos: product hero + label/card column
      const heroImg = await this._img(cpt.photos.product[0] && cpt.photos.product[0].blob);
      const labelImg = await this._img(cpt.photos.label && cpt.photos.label.blob);
      const cardImg = await this._img(cpt.photos.card && cpt.photos.card.blob);
      let y = 300;
      this._cover(x, heroImg, this.M, y, 700, 540, 22);
      this._cover(x, labelImg, this.M + 724, y, 348, 260, 18);
      x.fillStyle = '#625852'; x.font = this._sans(20, 700);
      x.fillText('label / spec', this.M + 724, y + 268);
      this._cover(x, cardImg, this.M + 724, y + 306, 348, 200, 18);
      x.fillText('company card', this.M + 724, y + 514);
      // extra product faces
      const extras = cpt.photos.product.slice(1, 5);
      if (extras.length) {
        let ex = this.M;
        for (const p of extras) {
          const img = await this._img(p.blob);
          this._cover(x, img, ex, y + 564, 166, 124, 14);
          ex += 178;
        }
      }
      y += extras.length ? 730 : 600;

      // chips
      let cx2 = this.M;
      const st = ST_COLORS[cpt.needsReview ? 'Needs review' : cpt.status] || ST_COLORS.Captured;
      cx2 += this._chip(x, cpt.needsReview ? 'Needs review' : cpt.status, cx2, y, st[0], st[1]) + 14;
      cx2 += this._chip(x, cpt.category, cx2, y, '#201a17', '#ffffff') + 14;
      cx2 += this._chip(x, '◎ ' + cpt.venue, cx2, y, '#ebe3d8', '#625852') + 14;
      if (cpt.rating) cx2 += this._chip(x, '★ ' + cpt.rating + '/5', cx2, y, '#f5ead8', '#94601e') + 14;
      let y2 = y + 66, cx3 = this.M;
      for (const r of (cpt.rooms || [])) cx3 += this._chip(x, r, cx3, y2, '#f4e6ea', '#6f273a') + 14;
      if (cpt.price) cx3 += this._chip(x, cpt.currency + ' ' + cpt.price, cx3, y2, '#ebe3d8', '#625852') + 14;
      y = y2 + 100;

      // facts
      x.font = this._sans(26);
      const facts = [];
      if (cpt.code) facts.push(['Model / code', cpt.code]);
      if (cpt.size) facts.push(['Size / spec', cpt.size]);
      const co = cpt._company;
      if (co && co.contact) facts.push(['Contact', co.contact]);
      if (co && co.wechat) facts.push(['WeChat / phone', co.wechat]);
      for (const [k, v] of facts) {
        x.fillStyle = '#625852'; x.fillText(k, this.M, y);
        x.fillStyle = '#201a17'; x.font = this._sans(26, 700);
        x.fillText(String(v), this.M + 320, y, this.W - this.M * 2 - 320);
        x.font = this._sans(26);
        y += 48;
      }
      if (cpt.note) {
        y += 16;
        y = this._text(x, cpt.note, this.M, y, { font: this._sans(26), color: '#3d3530', max: 5 });
      }
      if (cpt.voiceNote) {
        x.fillStyle = '#9d7643'; x.font = this._sans(22, 700);
        x.fillText('● voice note ' + fmtClock(cpt.voiceNote.duration) + ' — on the phone record', this.M, y + 16);
      }

      pdf.addPage();
      pdf.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 595.28, 841.89);
    }

    return pdf.output('blob');
  },

  async share(blob, filename) {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      } catch (err) {
        if (err && err.name === 'AbortError') return 'cancelled';
      }
    }
    downloadFile(filename, blob, 'application/pdf');
    return 'downloaded';
  },
};
