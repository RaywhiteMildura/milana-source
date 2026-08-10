/* Shared helpers: escaping, formatting, blob URLs, image downscaling, ids. */

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function uid(prefix = 'id') {
  return prefix + '_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}

function fmtClock(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function ord(n) {
  const rem100 = n % 100, rem10 = n % 10;
  if (rem100 >= 11 && rem100 <= 13) return n + 'th';
  return n + (rem10 === 1 ? 'st' : rem10 === 2 ? 'nd' : rem10 === 3 ? 'rd' : 'th');
}

function dayKey(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}

function fmtTime(iso) {
  const d = new Date(iso), now = new Date();
  if (dayKey(iso) === dayKey()) {
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (dayKey(iso) === dayKey(yest.toISOString())) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
}

/* Object URLs for stored Blobs — cached for the session so re-renders reuse them. */
const _blobUrls = new Map();
function urlFor(blob) {
  if (!blob || !(blob instanceof Blob)) return '';
  if (!_blobUrls.has(blob)) _blobUrls.set(blob, URL.createObjectURL(blob));
  return _blobUrls.get(blob);
}
function revokeUrlFor(blob) {
  if (blob && _blobUrls.has(blob)) {
    URL.revokeObjectURL(_blobUrls.get(blob));
    _blobUrls.delete(blob);
  }
}
function revokeAllUrls() {
  _blobUrls.forEach(url => URL.revokeObjectURL(url));
  _blobUrls.clear();
}

/* Decode an image blob honoring EXIF orientation, downscale, re-encode as JPEG. */
async function downscaleImage(blob, maxDim = 1600, quality = 0.82) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await (img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = rej; }));
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return blob;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
    const out = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    return out || blob;
  } catch (err) {
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* Photos are stored at full resolution; a small derived thumbnail keeps
   lists and slots cheap to render. */
async function makePhoto(blob) {
  const thumb = await downscaleImage(blob, 480, 0.72);
  return { id: uid('ph'), blob, thumb: thumb === blob ? null : thumb };
}
function photoThumb(p) {
  return p ? (p.thumb || p.blob) : null;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

function downloadFile(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* thumb style helper — real photo or empty */
function thumbBg(blob) {
  return blob ? `background-image:url('${urlFor(blob)}');background-size:cover;background-position:center` : '';
}
