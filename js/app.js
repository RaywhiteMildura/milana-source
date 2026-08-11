/* Milana Source — app state, actions and rendering.
   Local-first: IndexedDB on device, service worker for offline, no network required. */

const S = {
  ready: false,
  user: null, locked: false,
  loginTmp: { name: '', pin: '', project: '' }, loginRole: 'Owner',
  view: 'home', camera: null,
  venueSheetOn: false, settingsOn: false,
  addPlaceOpen: false, newPlace: '', newPlaceType: 'factory', placeEdit: false,
  captures: [], companies: [],
  draft: null,
  session: { key: '', venue: '' }, cardN: 0, flowSeq: 0,
  startedAt: null, lastSaved: null,
  venue: 'Canton Fair Phase 1', places: [],
  q: '', catFilter: 'All', venueFilter: 'All places',
  detailId: null, compareIds: [], reviewId: null, companyKey: null,
  rv: { company: '', contact: '', wechat: '', pname: '', code: '', size: '', website: '', notes: '', bio: '' },
  rvZh: { company: '', contact: '', pname: '' },   // characters as read, kept for checking
  rvBusy: { card: false, label: false },
  rvBioAt: '', rvLookupPending: false, bioBusy: false,
  aiKey: '',
  leftHanded: false, nativeCamera: false,
  projectName: '',
  firstUse: null,
};

function projName() { return S.projectName || 'My project'; }

function freshDraft() {
  return {
    product: [], label: null, card: null,
    category: '', rooms: [], roomsMore: false, rating: 0,
    priceOpen: false, currency: 'CNY', price: '',
    rec: 'idle', recSec: 0, voice: null,
    supplierKey: '',
  };
}
S.draft = freshDraft();

/* ── derived helpers (used by views) ─────────────────────────── */
function firstName() { return ((S.user && S.user.name) || '').trim().split(/\s+/)[0] || 'there'; }

function dayNumber() {
  if (!S.firstUse) return 1;
  const a = new Date(S.firstUse); a.setHours(0, 0, 0, 0);
  const b = new Date(); b.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function placeByName(name) { return S.places.find(p => p.name === name) || null; }

function sessWord() {
  const p = placeByName(S.venue);
  const t = PLACE_TYPES.find(x => x.key === (p ? p.type : 'other'));
  return t ? t.word : 'company';
}

function companyOf(key) { return S.companies.find(c => c.key === key) || null; }
function sessionCompany() { return S.session.key ? companyOf(S.session.key) : null; }
function sessionCount() { return S.session.key ? S.captures.filter(c => c.companyKey === S.session.key).length : 0; }
function coName(co) { return co ? (co.name || co.label || co.key) : ''; }
function supName(c) { const co = companyOf(c.companyKey); return co ? coName(co) : 'No company yet'; }
function dispName(c) { return c.name || (c.category + ' — untitled'); }
function displaySt(c) { return c.needsReview && c.status === 'Captured' ? 'Needs review' : c.status; }
function elapsedSec() { return S.startedAt ? Math.max(0, Math.floor((Date.now() - S.startedAt) / 1000)) : 0; }

function companyRows() {
  const byKey = {};
  S.captures.forEach(c => { if (c.companyKey) (byKey[c.companyKey] = byKey[c.companyKey] || []).push(c); });
  return S.companies
    .filter(co => co.name || byKey[co.key])
    .map(co => {
      const list = byKey[co.key] || [];
      const venues = [...new Set(list.map(c => c.venue))].join(', ') || co.venue || '';
      const name = coName(co);
      return {
        key: co.key, name, nameZh: co.nameZh || '', initial: name.charAt(0) || 'M',
        cardPhoto: co.cardPhoto, cardThumb: co.cardThumb,
        sub: list.length + (list.length === 1 ? ' product' : ' products') + (venues ? ' · ' + venues : ''),
        latest: list.length ? list[0].createdAt : (co.createdAt || ''),
      };
    })
    .sort((a, b) => (b.latest || '').localeCompare(a.latest || ''));
}

/* ── fx: toast + shutter flash ───────────────────────────────── */
const Fx = {
  toastT: null,
  toast(msg) {
    const root = document.querySelector('#fx-root');
    const old = root.querySelector('.toast'); if (old) old.remove();
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    root.appendChild(t);
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.remove(), 2400);
  },
  flash() {
    const root = document.querySelector('#fx-root');
    const f = document.createElement('div'); f.className = 'flash';
    root.appendChild(f);
    setTimeout(() => f.remove(), 320);
  },
};

/* ── camera ──────────────────────────────────────────────────── */
const Cam = {
  stream: null, video: null, fallback: false, opening: false,

  async open() {
    if (S.nativeCamera) { this.stop(); this.fallback = true; this.attach(); return; }
    if (this.stream || this.opening) { this.attach(); return; }
    this.opening = true;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no camera API');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } },
        audio: false,
      });
      if (!S.camera) { // cancelled while permission/open was pending
        stream.getTracks().forEach(t => t.stop());
        this.opening = false;
        return;
      }
      this.stream = stream;
      this.fallback = false;
    } catch (err) {
      this.fallback = true;
    }
    this.opening = false;
    this.attach();
  },

  attach() {
    const wrap = document.querySelector('#cam-video-wrap');
    if (!wrap) return;
    if (this.fallback || !this.stream) {
      const note = document.querySelector('#cam-fallback-note');
      if (note) { note.classList.remove('hidden'); note.style.display = 'block'; }
      return;
    }
    if (!this.video) {
      this.video = document.createElement('video');
      this.video.setAttribute('playsinline', '');
      this.video.muted = true;
      this.video.autoplay = true;
    }
    if (this.video.srcObject !== this.stream) this.video.srcObject = this.stream;
    if (this.video.parentElement !== wrap) wrap.appendChild(this.video);
    this.video.play().catch(() => {});
  },

  // The whole native video frame at full stream resolution — the on-screen
  // corner marks are a framing hint, never a crop. Thumbnails are derived later.
  async capture(quality = 0.92) {
    if (!this.video || !this.video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = this.video.videoWidth; c.height = this.video.videoHeight;
    c.getContext('2d').drawImage(this.video, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(res, 'image/jpeg', quality));
  },

  stop() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  },
};

/* ── voice notes ─────────────────────────────────────────────── */
const Rec = {
  mr: null, chunks: [], timer: null, stream: null,
  async toggle() {
    const dr = S.draft;
    if (dr.rec === 'rec') { if (this.mr && this.mr.state === 'recording') this.mr.stop(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      Fx.toast('Voice recording is not supported in this browser'); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.stream = stream;
      this.chunks = [];
      const mr = new MediaRecorder(stream);
      this.mr = mr;
      mr.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(this.chunks, { type: mr.mimeType || 'audio/mp4' });
        stream.getTracks().forEach(t => t.stop());
        this.stream = null;
        clearInterval(this.timer);
        S.draft.voice = { blob, duration: Math.max(1, S.draft.recSec) };
        S.draft.rec = 'done';
        this.mr = null;
        render();
      };
      mr.start();
      dr.rec = 'rec'; dr.recSec = 0;
      render();
      this.timer = setInterval(() => {
        S.draft.recSec += 1;
        const el = document.querySelector('#rec-label');
        if (el) el.textContent = 'Recording ' + fmtClock(S.draft.recSec) + ' — tap to stop';
      }, 1000);
    } catch (err) {
      Fx.toast('Microphone permission was not granted');
    }
  },
  reset() {
    clearInterval(this.timer);
    if (this.mr && this.mr.state === 'recording') { this.mr.onstop = null; this.mr.stop(); }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    this.mr = null;
  },
};

let _audioEl = null;
function playBlob(blob) {
  if (_audioEl) { _audioEl.pause(); _audioEl = null; return; }
  _audioEl = new Audio(urlFor(blob));
  _audioEl.onended = () => { _audioEl = null; };
  _audioEl.play().catch(() => { _audioEl = null; Fx.toast('Could not play the voice note'); });
}

/* ── capture flow ────────────────────────────────────────────── */
function advanceFrom(k) {
  if (S.view === 'tag') { S.camera = null; renderAll(); return; }
  if (k === 'product') { S.camera = 'label'; renderCam(); return; }
  if (k === 'label') {
    if (S.draft.card || sessionCompany()) { S.camera = null; S.view = 'tag'; renderAll(); }
    else { S.camera = 'card'; renderCam(); }
    return;
  }
  S.camera = null; S.view = 'tag'; renderAll();
}

let _advancePending = false;
function scheduleAdvance(k) {
  const flow = S.flowSeq;
  _advancePending = true;
  setTimeout(() => {
    _advancePending = false;
    if (S.flowSeq === flow && S.camera === k) advanceFrom(k);
  }, 340);
}

async function handleShot(k, blob) {
  if (!blob) return;
  if (k !== 'product' && _advancePending) return; // double-tap on an auto-advancing slot
  const flow = S.flowSeq;
  const photo = await makePhoto(blob);
  if (S.flowSeq !== flow || S.camera !== k) return; // flow changed while deriving the thumb
  if (k === 'product') {
    if (S.draft.product.length >= 6) { Fx.toast('Six product photos is plenty — tap Next.'); return; }
    S.draft.product.push(photo);
    renderAll();
    return;
  }
  if (k === 'label') {
    S.draft.label = photo;
    renderAll();
    scheduleAdvance('label');
    return;
  }
  // company card — starts (or replaces) the session for this place
  S.cardN += 1;
  const key = uid('co');
  const co = {
    key, label: 'Card #' + S.cardN + ' · ' + S.venue,
    name: '', nameZh: '', contact: '', contactZh: '', wechat: '',
    cardPhoto: blob, cardThumb: photo.thumb,
    venue: S.venue, word: sessWord(), createdAt: new Date().toISOString(),
  };
  S.companies.push(co);
  S.session = { key, venue: S.venue };
  S.draft.card = photo;
  S.draft.supplierKey = '';
  await dbPut('companies', co);
  await settingSet('cardN', S.cardN);
  await settingSet('session', S.session);
  renderAll();
  scheduleAdvance('card');
}

function savedChips(rec) {
  const chips = [];
  if (rec.category) chips.push({ t: rec.category, bg: '#201a17', fg: '#fff' });
  chips.push({ t: '◎ ' + rec.venue, bg: '#ebe3d8', fg: '#625852' });
  rec.rooms.slice(0, 3).forEach(r => chips.push({ t: r, bg: '#f4e6ea', fg: '#6f273a' }));
  if (rec.rating) chips.push({ t: '★ ' + rec.rating + '/5', bg: '#f5ead8', fg: '#94601e' });
  if (rec.price) chips.push({ t: rec.currency + ' ' + rec.price, bg: '#ebe3d8', fg: '#625852' });
  if (rec.companyKey && rec.companyKey === S.session.key) {
    chips.push({ t: ord(sessionCount()) + ' product at this ' + sessWord(), bg: '#e3efe8', fg: '#355f4b' });
  } else if (rec.companyKey) {
    const co = companyOf(rec.companyKey);
    if (co) chips.push({ t: coName(co), bg: '#e3efe8', fg: '#355f4b' });
  }
  if (rec.voiceNote) chips.push({ t: '● voice ' + fmtClock(rec.voiceNote.duration), bg: '#ebe3d8', fg: '#625852' });
  return chips;
}

/* ── actions (delegated via data-act) ────────────────────────── */
const Actions = {
  nav(arg) {
    S.view = arg; S.detailId = null; S.companyKey = null;
    if (arg !== 'reviewItem') S.reviewId = null;
    // leaving the review section entirely — hand the OCR models' memory back
    if (arg !== 'review' && arg !== 'reviewItem') OCR.release();
    renderAll();
  },

  /* "use the characters instead" — swap the original Chinese into the field */
  useZh(arg) {
    if (S.rvZh[arg]) { S.rv[arg] = S.rvZh[arg]; renderAll(); }
  },

  openSettings() { S.settingsOn = true; renderAll(); },
  closeSettings() { S.settingsOn = false; renderAll(); },
  openVenueSheet() { S.venueSheetOn = true; S.addPlaceOpen = false; S.placeEdit = false; renderAll(); },
  closeVenueSheet() { S.venueSheetOn = false; S.addPlaceOpen = false; S.placeEdit = false; renderAll(); },
  togglePlaceEdit() { S.placeEdit = !S.placeEdit; S.addPlaceOpen = false; renderAll(); },

  async pickVenue(arg) {
    const place = S.places.find(p => p.id === arg) || placeByName(arg);
    const name = place ? place.name : arg;
    if (name === S.venue) { S.venueSheetOn = false; S.addPlaceOpen = false; renderAll(); return; }
    const hadSession = !!S.session.key;
    S.flowSeq += 1;
    S.venue = name; S.venueSheetOn = false; S.addPlaceOpen = false; S.placeEdit = false;
    S.session = { key: '', venue: '' };
    S.draft.card = null;
    await settingSet('venue', name);
    await settingSet('session', S.session);
    renderAll();
    if (hadSession) Fx.toast('New place — the company card was reset.');
  },

  addPlaceOpen() {
    S.addPlaceOpen = true; S.placeEdit = false; S.newPlace = '';
    renderAll();
    const el = document.querySelector('#new-place-input');
    if (el) el.focus();
  },
  addPlaceCancel() { S.addPlaceOpen = false; S.newPlace = ''; renderAll(); },
  setNewPlaceType(arg) { S.newPlaceType = arg; renderAll(); },

  async addPlaceSave() {
    const name = S.newPlace.trim();
    if (!name) { Fx.toast('Give the place a name first'); return; }
    const existing = placeByName(name);
    if (!existing) {
      S.places.push({ id: uid('pl'), name, type: S.newPlaceType || 'other' });
      await settingSet('places', S.places);
    }
    S.newPlace = ''; S.addPlaceOpen = false;
    Actions.pickVenue(name);
  },

  async deletePlace(arg) {
    const p = S.places.find(x => x.id === arg);
    if (!p) return;
    const used = S.captures.filter(c => c.venue === p.name).length;
    const msg = used
      ? 'Remove “' + p.name + '” from the list? ' + used + (used === 1 ? ' capture stays' : ' captures stay') + ' filed under it.'
      : 'Remove “' + p.name + '” from the list?';
    if (!confirm(msg)) return;
    S.places = S.places.filter(x => x.id !== arg);
    await settingSet('places', S.places);
    if (S.venue === p.name && S.places.length) {
      S.venue = S.places[0].name;
      S.session = { key: '', venue: '' };
      await settingSet('venue', S.venue);
      await settingSet('session', S.session);
    }
    renderAll();
  },

  startCapture() {
    Rec.reset();
    S.flowSeq += 1;
    S.draft = freshDraft();
    S.view = 'shoot';
    S.detailId = null; S.reviewId = null;
    S.startedAt = Date.now();
    S.camera = 'product';
    renderAll();
  },
  closeFlow() {
    Rec.reset();
    S.flowSeq += 1;
    S.view = 'home'; S.camera = null; S.startedAt = null;
    S.draft = freshDraft();
    renderAll();
  },

  openCam(arg) { S.camera = arg; renderAll(); },
  cancelCam() { S.flowSeq += 1; S.camera = null; renderAll(); },

  // "↻ New booth / new card": break the company session and shoot the new card in one tap
  async newBooth() {
    S.flowSeq += 1;
    S.session = { key: '', venue: '' };
    S.draft.card = null;
    S.draft.supplierKey = '';
    await settingSet('session', S.session);
    S.camera = 'card';
    renderAll();
  },

  async sharePhoto(arg) {
    const [capId, idxStr] = String(arg).split('@');
    const c = S.captures.find(x => x.id === capId);
    if (!c) return;
    const all = c.photos.product
      .map((p, i) => ({ p, name: 'face-' + (i + 1) }))
      .concat(c.photos.label ? [{ p: c.photos.label, name: 'label' }] : [])
      .concat(c.photos.card ? [{ p: c.photos.card, name: 'company-card' }] : []);
    const entry = all[Number(idxStr)];
    if (!entry) return;
    const base = (dispName(c) || 'photo').replace(/[^\w一-鿿-]+/g, '-').slice(0, 40);
    const type = entry.p.blob.type || 'image/jpeg';
    const ext = type.includes('png') ? '.png' : type.includes('heic') || type.includes('heif') ? '.heic' : '.jpg';
    const file = new File([entry.p.blob], base + '-' + entry.name + ext, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    downloadFile(file.name, entry.p.blob, type);
    Fx.toast('Photo saved as a download');
  },

  async toggleNativeCamera() {
    S.nativeCamera = !S.nativeCamera;
    await settingSet('nativeCamera', S.nativeCamera);
    if (S.nativeCamera) Cam.stop();
    renderAll();
  },
  camNext() { advanceFrom(S.camera); },

  async snap() {
    const k = S.camera;
    if (!k) return;
    if (Cam.opening) return; // live camera is about to appear — don't double-open capture UIs
    if (Cam.fallback || !Cam.stream) {
      const input = document.querySelector('#fallback-file');
      if (input) input.click();
      return;
    }
    Fx.flash();
    const flow = S.flowSeq;
    const blob = await Cam.capture();
    if (S.flowSeq !== flow || S.camera !== k) return; // flow changed while capturing
    if (!blob) { Fx.toast('The camera is still starting — try again.'); return; }
    handleShot(k, blob);
  },

  toDetails() {
    if (!S.draft.product.length) return;
    S.view = 'tag'; S.camera = null;
    renderAll();
  },
  backToShoot() { S.view = 'shoot'; S.camera = null; renderAll(); },

  pickCat(arg) { S.draft.category = S.draft.category === arg ? '' : arg; renderAll(); },
  toggleRoom(arg) {
    const r = S.draft.rooms;
    S.draft.rooms = r.includes(arg) ? r.filter(x => x !== arg) : r.concat(arg);
    renderAll();
  },
  toggleRoomsMore() { S.draft.roomsMore = !S.draft.roomsMore; renderAll(); },
  setRating(arg) { const n = Number(arg); S.draft.rating = S.draft.rating === n ? 0 : n; renderAll(); },
  togglePrice() { S.draft.priceOpen = !S.draft.priceOpen; renderAll(); },
  setCurrency(arg) { S.draft.currency = arg; renderAll(); },
  pickSupplier(arg) { S.draft.supplierKey = S.draft.supplierKey === arg ? '' : arg; renderAll(); },

  rec() { Rec.toggle(); },
  delVoice() { S.draft.voice = null; S.draft.rec = 'idle'; S.draft.recSec = 0; renderAll(); },
  playVoice() { if (S.draft.voice) playBlob(S.draft.voice.blob); },
  playVoiceOf(arg) {
    const c = S.captures.find(x => x.id === arg);
    if (c && c.voiceNote) playBlob(c.voiceNote.blob);
  },

  async save() {
    const dr = S.draft;
    if (!dr.category || !dr.product.length) return;
    const sessionCo = dr.card || sessionCompany() ? sessionCompany() : null;
    const companyKey = sessionCo ? S.session.key : (dr.supplierKey || '');
    const now = new Date().toISOString();
    const cardPhoto = dr.card || (sessionCo && sessionCo.cardPhoto ? { id: uid('ph'), blob: sessionCo.cardPhoto, thumb: sessionCo.cardThumb || null } : null);
    const rec = {
      id: uid('cap'), createdAt: now, updatedAt: now,
      createdBy: S.user.name, role: S.user.role,
      venue: S.venue, category: dr.category, rooms: dr.rooms.slice(), rating: dr.rating,
      currency: dr.currency, price: dr.price.trim(), note: '',
      voiceNote: dr.voice ? { blob: dr.voice.blob, duration: dr.voice.duration } : null,
      photos: { product: dr.product.slice(), label: dr.label, card: cardPhoto },
      companyKey, name: '', code: '', size: '',
      status: 'Captured', needsReview: true,
      missing: ['name'].concat(companyKey ? [] : ['company']).concat(dr.label ? ['code'] : ['label photo']),
      capturedInSec: elapsedSec(), syncStatus: 'local',
    };
    await dbPut('captures', rec);
    S.captures.unshift(rec);
    S.flowSeq += 1;
    S.lastSaved = {
      venue: S.venue, sec: rec.capturedInSec, sessWord: sessWord(),
      sessionOn: !!sessionCompany(),
      slots: [
        { blob: photoThumb(dr.product[0]), count: dr.product.length },
        { blob: photoThumb(dr.label), count: 0 },
        { blob: photoThumb(rec.photos.card), count: 0 },
      ],
      chips: savedChips(rec),
    };
    Rec.reset();
    S.draft = freshDraft();
    S.view = 'saved'; S.startedAt = null; S.camera = null;
    renderAll();
  },

  openDetail(arg) { S.detailId = arg; renderAll(); },
  closeDetail() { S.detailId = null; renderAll(); },

  async setStatus(arg) {
    const c = S.captures.find(x => x.id === S.detailId);
    if (!c) return;
    c.status = arg;
    c.updatedAt = new Date().toISOString();
    await dbPut('captures', c);
    renderAll();
    Fx.toast(arg === 'Rejected' ? 'Marked rejected' : 'Added to the shortlist');
  },

  async toggleCompare(arg) {
    const ids = S.compareIds;
    if (ids.includes(arg)) S.compareIds = ids.filter(x => x !== arg);
    else if (ids.length >= 3) { Fx.toast('Compare holds three at a time — remove one first.'); return; }
    else { S.compareIds = ids.concat(arg); Fx.toast('Added to compare'); }
    await settingSet('compareIds', S.compareIds);
    renderAll();
  },

  async deleteCapture(arg) {
    const c = S.captures.find(x => x.id === arg);
    if (!c) return;
    if (!confirm('Delete this capture and its photos?')) return;
    c.photos.product.forEach(p => { revokeUrlFor(p.blob); revokeUrlFor(p.thumb); });
    if (c.photos.label) { revokeUrlFor(c.photos.label.blob); revokeUrlFor(c.photos.label.thumb); }
    if (c.photos.card) { revokeUrlFor(c.photos.card.blob); revokeUrlFor(c.photos.card.thumb); }
    if (c.voiceNote) revokeUrlFor(c.voiceNote.blob);
    await dbRemove('captures', arg);
    S.captures = S.captures.filter(x => x.id !== arg);
    S.compareIds = S.compareIds.filter(x => x !== arg);
    await settingSet('compareIds', S.compareIds);
    S.detailId = null;
    // if that was the company's last product, offer to drop the company record too
    const co = companyOf(c.companyKey);
    if (co && !S.captures.some(x => x.companyKey === co.key)) {
      if (confirm('That was the last product from “' + (co.name || co.key) + '”. Delete the company record too?')) {
        revokeUrlFor(co.cardPhoto); revokeUrlFor(co.cardThumb);
        await dbRemove('companies', co.key);
        S.companies = S.companies.filter(x => x.key !== co.key);
        if (S.session.key === co.key) {
          S.session = { key: '', venue: '' };
          await settingSet('session', S.session);
        }
      }
    }
    renderAll();
    Fx.toast('Capture deleted');
  },

  openCompany(arg) { S.companyKey = arg; S.detailId = null; renderAll(); },
  closeCompany() { S.companyKey = null; renderAll(); },

  openCompanyProducts(arg) {
    const co = companyOf(arg);
    S.companyKey = null; S.detailId = null;
    S.view = 'products';
    S.q = co ? coName(co) : ''; S.catFilter = 'All'; S.venueFilter = 'All places';
    renderAll();
  },

  /* Level 1 lookup: open a pre-filled search in a new tab (Bing, not Google —
     Google is blocked in mainland China). */
  openSearch(arg) {
    if (!arg) return;
    window.open(arg, '_blank', 'noopener');
  },

  /* Level 2 lookup: fetch a short company bio via the Claude API.
     arg is 'rv' (Complete Record screen) or a company key. Offline or failed
     calls set a "lookup pending" flag so the retry button appears. */
  async fetchBio(arg) {
    if (S.bioBusy) return;
    if (!S.aiKey) { Fx.toast('Add your AI lookup API key in Settings first.'); return; }
    const isRv = arg === 'rv';
    const cap = isRv ? S.captures.find(x => x.id === S.reviewId) : null;
    const co = isRv ? (cap ? companyOf(cap.companyKey) : null) : companyOf(arg);
    const info = isRv
      ? { name: S.rv.company.trim(), nameZh: S.rvZh.company, contact: S.rv.contact.trim(), wechat: S.rv.wechat.trim(), venue: (cap && cap.venue) || S.venue }
      : (co ? { name: coName(co), nameZh: co.nameZh, contact: co.contact, wechat: co.wechat, venue: co.venue } : null);
    if (!info || !info.name) { Fx.toast('Confirm the company name first.'); return; }
    const markPending = async (pending) => {
      if (isRv) S.rvLookupPending = pending;
      if (co) { co.lookupPending = pending; await dbPut('companies', co); }
    };
    if (!navigator.onLine) {
      await markPending(true);
      renderAll();
      Fx.toast('No signal — the lookup is queued. Retry when online.');
      return;
    }
    S.bioBusy = true;
    renderAll();
    try {
      const text = await Lookup.fetchBio(S.aiKey, info);
      const at = new Date().toISOString();
      if (isRv) { S.rv.bio = text; S.rvBioAt = at; S.rvLookupPending = false; }
      if (co) { co.bio = text; co.bioAt = at; co.lookupPending = false; await dbPut('companies', co); }
      Fx.toast('Bio fetched — AI lookup, verify it yourself.');
    } catch (err) {
      await markPending(true);
      Fx.toast((err && err.message) ? String(err.message).slice(0, 140) : 'The lookup failed — try again.');
    } finally {
      S.bioBusy = false;
      renderAll();
    }
  },

  catFilter(arg) { S.catFilter = S.catFilter === arg ? 'All' : arg; renderAll(); },
  venueFilter(arg) { S.venueFilter = S.venueFilter === arg ? 'All places' : arg; renderAll(); },

  openReview(arg) {
    const c = S.captures.find(x => x.id === arg);
    if (!c) return;
    const co = companyOf(c.companyKey);
    S.reviewId = arg; S.view = 'reviewItem'; S.detailId = null;
    S.rv = {
      company: (co && co.name) || '', contact: (co && co.contact) || '', wechat: (co && co.wechat) || '',
      pname: c.name || '', code: c.code || '', size: c.size || '',
      website: (co && co.website) || '', notes: (co && co.notes) || '', bio: (co && co.bio) || '',
    };
    S.rvZh = {
      company: (co && co.nameZh) || '', contact: (co && co.contactZh) || '', pname: c.nameZh || '',
    };
    S.rvBusy = { card: false, label: false };
    S.rvBioAt = (co && co.bioAt) || '';
    S.rvLookupPending = !!(co && co.lookupPending);
    renderAll();
    runOcrPrefill(c);
  },

  async confirmReview() {
    const c = S.captures.find(x => x.id === S.reviewId);
    if (!c) return;
    let co = companyOf(c.companyKey);
    const coName = S.rv.company.trim();
    if (!co && coName) {
      co = { key: uid('co'), name: '', contact: '', wechat: '', cardPhoto: null, venue: c.venue, word: sessWord(), createdAt: new Date().toISOString() };
      S.companies.push(co);
      c.companyKey = co.key;
    }
    if (co) {
      co.name = coName || co.name;
      co.nameZh = S.rvZh.company || co.nameZh || '';
      co.contact = S.rv.contact.trim();
      co.contactZh = S.rvZh.contact || co.contactZh || '';
      co.wechat = S.rv.wechat.trim();
      co.website = (S.rv.website || '').trim();
      co.notes = (S.rv.notes || '').trim();
      co.bio = (S.rv.bio || '').trim();
      co.bioAt = S.rvBioAt || co.bioAt || '';
      co.lookupPending = S.rvLookupPending;
      await dbPut('companies', co);
    }
    c.name = S.rv.pname.trim() || c.name;
    c.nameZh = S.rvZh.pname || c.nameZh || '';
    c.code = S.rv.code.trim();
    c.size = S.rv.size.trim();
    if (c.status === 'Needs review') c.status = 'Captured';
    c.needsReview = false;
    c.missing = [];
    c.updatedAt = new Date().toISOString();
    await dbPut('captures', c);
    S.view = 'review'; S.reviewId = null;
    renderAll();
    Fx.toast('Record completed — company saved for every product from that ' + ((co && co.word) || 'company'));
  },

  async exportPack(arg, el) {
    const today = S.captures.filter(c => dayKey(c.createdAt) === dayKey());
    const list = today.length ? today : S.captures;
    if (!list.length) { Fx.toast('Nothing captured yet — the day pack needs at least one record.'); return; }
    const orig = el ? el.textContent : '';
    if (el) { el.textContent = 'Building…'; el.disabled = true; }
    try {
      list.forEach(c => { c._company = companyOf(c.companyKey); });
      const blob = await DayPack.build(list, supName);
      const name = 'milana-day-pack-' + new Date().toISOString().slice(0, 10) + '.pdf';
      const result = await DayPack.share(blob, name);
      if (result === 'shared') Fx.toast('Day pack handed to the share sheet');
      else if (result === 'downloaded') Fx.toast('Day pack PDF saved');
    } catch (err) {
      Fx.toast('The day pack could not be built — try again.');
    } finally {
      list.forEach(c => { delete c._company; });
      if (el) { el.textContent = orig; el.disabled = false; }
    }
  },

  async toggleLeftHanded() {
    S.leftHanded = !S.leftHanded;
    await settingSet('leftHanded', S.leftHanded);
    renderAll();
  },

  pickRole(arg) { S.loginRole = arg; renderAll(); },

  async exportJSON() {
    Fx.toast('Preparing the full backup…');
    const captures = [];
    for (const c of S.captures) {
      const copy = { ...c, photos: { product: [], label: null, card: null }, voiceNote: null };
      delete copy._company;
      for (const p of c.photos.product) copy.photos.product.push({ id: p.id, dataUrl: await blobToDataURL(p.blob) });
      if (c.photos.label) copy.photos.label = { id: c.photos.label.id, dataUrl: await blobToDataURL(c.photos.label.blob) };
      if (c.photos.card) copy.photos.card = { id: c.photos.card.id, dataUrl: await blobToDataURL(c.photos.card.blob) };
      if (c.voiceNote) copy.voiceNote = { duration: c.voiceNote.duration, dataUrl: await blobToDataURL(c.voiceNote.blob) };
      captures.push(copy);
    }
    const companies = [];
    for (const co of S.companies) {
      companies.push({ ...co, cardThumb: undefined, cardPhoto: co.cardPhoto ? await blobToDataURL(co.cardPhoto) : null });
    }
    const data = {
      app: 'milana-source', version: 2, exportedAt: new Date().toISOString(),
      user: S.user,
      settings: { venue: S.venue, cardN: S.cardN, session: S.session, places: S.places, leftHanded: S.leftHanded, nativeCamera: S.nativeCamera, projectName: S.projectName, firstUse: S.firstUse },
      captures, companies,
    };
    downloadFile('milana-source-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data), 'application/json');
  },

  exportCSV() {
    const cols = ['createdAt', 'createdBy', 'project', 'venue', 'category', 'rooms', 'name', 'name_zh', 'code', 'size',
      'company', 'company_zh', 'contact', 'contact_zh', 'wechat', 'website', 'company_notes', 'company_bio',
      'rating', 'currency', 'price', 'status',
      'needsReview', 'productPhotos', 'voiceSec', 'note'];
    const rows = [cols].concat(S.captures.map(c => {
      const co = companyOf(c.companyKey);
      return [c.createdAt, c.createdBy, projName(), c.venue, c.category, (c.rooms || []).join('|'),
        c.name, c.nameZh || '', c.code, c.size,
        co ? coName(co) : '', co ? (co.nameZh || '') : '', co ? co.contact : '', co ? (co.contactZh || '') : '',
        co ? co.wechat : '', co ? (co.website || '') : '', co ? (co.notes || '') : '', co ? (co.bio || '') : '',
        c.rating, c.currency, c.price, displaySt(c), c.needsReview ? 'yes' : 'no',
        c.photos.product.length, c.voiceNote ? c.voiceNote.duration : '', c.note];
    }));
    const csv = rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    downloadFile('milana-source-' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv');
  },

  async eraseData() {
    if (!confirm('Clear ALL data — every capture, photo, voice note and company stored on this phone?')) return;
    if (S.user && S.user.pin) {
      const pin = prompt('Enter your PIN to confirm:');
      if (pin === null) return;
      if (pin.trim() !== String(S.user.pin)) { Fx.toast('Wrong PIN — nothing was deleted.'); return; }
    }
    await dbClear('captures');
    await dbClear('companies');
    revokeAllUrls();
    S.captures = []; S.companies = [];
    S.compareIds = []; S.session = { key: '', venue: '' }; S.cardN = 0;
    await settingSet('compareIds', []);
    await settingSet('session', S.session);
    await settingSet('cardN', 0);
    S.settingsOn = false; S.view = 'home';
    renderAll();
    Fx.toast('Local project data erased');
  },

  async signOut() {
    await dbRemove('settings', 'user');
    S.user = null; S.locked = false; S.settingsOn = false;
    S.loginTmp = { name: '', pin: '' };
    renderAll();
  },
};

/* ── OCR pre-fill at review time ─────────────────────────────── */
function renderIfReview(id) { if (S.view === 'reviewItem' && S.reviewId === id) renderAll(); }

function runOcrPrefill(c) {
  const id = c.id;
  const cardBlob = c.photos.card && c.photos.card.blob;
  const labelBlob = c.photos.label && c.photos.label.blob;
  const needCard = cardBlob && !(S.rv.company && S.rv.contact && S.rv.wechat);
  const needLabel = labelBlob && !(S.rv.pname && S.rv.code && S.rv.size);
  if (typeof Tesseract === 'undefined') return;
  if (needCard) {
    S.rvBusy.card = true; renderIfReview(id);
    OCR.readCard(cardBlob).then(res => {
      if (S.reviewId !== id) return;
      if (!S.rv.company && res.company.value) S.rv.company = res.company.value;
      if (!S.rv.contact && res.contact.value) S.rv.contact = res.contact.value;
      if (!S.rv.wechat && res.wechat.value) S.rv.wechat = res.wechat.value;
      if (!S.rvZh.company && res.company.zh) S.rvZh.company = res.company.zh;
      if (!S.rvZh.contact && res.contact.zh) S.rvZh.contact = res.contact.zh;
    }).catch(() => {
      if (S.reviewId === id) Fx.toast('Could not read the card — check the photo and type it in.');
    }).finally(() => { if (S.reviewId === id) { S.rvBusy.card = false; renderIfReview(id); } });
  }
  if (needLabel) {
    S.rvBusy.label = true; renderIfReview(id);
    OCR.readLabel(labelBlob).then(res => {
      if (S.reviewId !== id) return;
      if (!S.rv.pname && res.pname.value) S.rv.pname = res.pname.value;
      if (!S.rv.code && res.code.value) S.rv.code = res.code.value;
      if (!S.rv.size && res.size.value) S.rv.size = res.size.value;
      if (!S.rvZh.pname && res.pname.zh) S.rvZh.pname = res.pname.zh;
    }).catch(() => {}).finally(() => { if (S.reviewId === id) { S.rvBusy.label = false; renderIfReview(id); } });
  }
}

/* ── input handling (delegated) ──────────────────────────────── */
let _qTimer = null;
function onInputChange(name, value) {
  if (name === 'q') {
    S.q = value;
    clearTimeout(_qTimer);
    _qTimer = setTimeout(renderAll, 140);
  } else if (name === 'price') {
    S.draft.price = value;
  } else if (name === 'newPlace') {
    S.newPlace = value;
  } else if (name === 'login.name') {
    S.loginTmp.name = value;
  } else if (name === 'login.pin') {
    S.loginTmp.pin = value;
  } else if (name === 'login.project') {
    S.loginTmp.project = value;
  } else if (name === 'projectName') {
    S.projectName = value.trim();
    clearTimeout(window.__projTimer);
    window.__projTimer = setTimeout(() => settingSet('projectName', S.projectName), 400);
  } else if (name === 'aiKey') {
    S.aiKey = value.trim();
    clearTimeout(window.__aiKeyTimer);
    window.__aiKeyTimer = setTimeout(() => settingSet('aiKey', S.aiKey), 400);
  } else if (name.indexOf('co.') === 0) {
    // website / notes / bio typed straight onto an open company record
    const co = companyOf(S.companyKey);
    if (co) {
      co[name.slice(3)] = value;
      clearTimeout(window.__coTimer);
      window.__coTimer = setTimeout(() => {
        co.updatedAt = new Date().toISOString();
        dbPut('companies', co);
      }, 400);
    }
  } else if (name.indexOf('rv.') === 0) {
    S.rv[name.slice(3)] = value;
    if (name === 'rv.company') {
      // the "Look up company" section appears once a name is present
      clearTimeout(window.__rvCoTimer);
      window.__rvCoTimer = setTimeout(() => { if (S.view === 'reviewItem') render(); }, 350);
    }
  }
}

/* ── render ──────────────────────────────────────────────────── */
function render() {
  const app = document.querySelector('#app');
  const act = document.activeElement;
  let focusName = null, selStart = 0, selEnd = 0;
  if (act && act.dataset && act.dataset.input) {
    focusName = act.dataset.input;
    try { selStart = act.selectionStart; selEnd = act.selectionEnd; } catch (e) { /* not a text input */ }
  }

  let html = '';
  if (S.ready) {
    if (!S.user) html = loginView();
    else if (S.locked) html = unlockView();
    else {
      const tabViews = { home: homeView, products: productsView, suppliers: suppliersView, compare: compareView };
      const flowViews = { shoot: shootView, tag: tagView, saved: savedView, review: reviewView, reviewItem: reviewItemView };
      const fn = tabViews[S.view] || flowViews[S.view] || homeView;
      html = fn();
      if (tabViews[S.view]) html += tabbar();
      if (S.detailId) html += detailOverlay();
      if (S.companyKey) html += companyOverlay();
      if (S.venueSheetOn) html += venueSheet();
      if (S.settingsOn) html += settingsSheet();
    }
  }
  app.innerHTML = html;
  bindForms();

  if (focusName) {
    const el = app.querySelector('[data-input="' + focusName.replace(/"/g, '') + '"]');
    if (el) {
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(selStart, selEnd); } catch (e) { /* not a text input */ }
    }
  }
}

function renderCam() {
  const root = document.querySelector('#cam-root');
  if (!S.camera || !S.user || S.locked) {
    root.innerHTML = '';
    Cam.stop();
    return;
  }
  root.innerHTML = cameraHTML();
  Cam.open();
}

function renderAll() {
  render();
  renderCam();
}

/* ── one-off form bindings after each render ─────────────────── */
function bindForms() {
  const lf = document.querySelector('#login-form');
  if (lf && !lf._bound) {
    lf._bound = true;
    lf.addEventListener('submit', async ev => {
      ev.preventDefault();
      const form = ev.currentTarget;
      const name = ((form.elements.name && form.elements.name.value) || S.loginTmp.name).trim();
      if (!name) return;
      const pin = ((form.elements.pin && form.elements.pin.value) || S.loginTmp.pin).trim();
      const project = ((form.elements.project && form.elements.project.value) || S.loginTmp.project).trim();
      S.user = { name, role: S.loginRole, pin };
      await settingSet('user', S.user);
      if (project) {
        S.projectName = project;
        await settingSet('projectName', project);
      }
      if (!S.firstUse) {
        S.firstUse = new Date().toISOString();
        await settingSet('firstUse', S.firstUse);
      }
      S.locked = false;
      S.loginTmp = { name: '', pin: '' };
      renderAll();
    });
  }
  const uf = document.querySelector('#unlock-form');
  if (uf && !uf._bound) {
    uf._bound = true;
    uf.addEventListener('submit', ev => {
      ev.preventDefault();
      const form = ev.currentTarget;
      const pin = ((form.elements.pin && form.elements.pin.value) || S.loginTmp.pin).trim();
      if (pin === String(S.user.pin || '')) {
        S.locked = false;
        S.loginTmp = { name: '', pin: '' };
        renderAll();
      } else {
        Fx.toast('Incorrect PIN');
      }
    });
  }
  const imp = document.querySelector('#import-json');
  if (imp && !imp._bound) {
    imp._bound = true;
    imp.addEventListener('change', importJSON);
  }
}

async function importJSON(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'milana-source') throw new Error('not a Milana backup');
    const revive = async (p) => {
      const blob = await dataURLToBlob(p.dataUrl);
      const thumb = await downscaleImage(blob, 480, 0.72);
      return { id: p.id || uid('ph'), blob, thumb: thumb === blob ? null : thumb };
    };
    for (const co of data.companies || []) {
      const cardPhoto = co.cardPhoto ? await dataURLToBlob(co.cardPhoto) : null;
      const cardThumb = cardPhoto ? await downscaleImage(cardPhoto, 480, 0.72) : null;
      const rec = { ...co, cardPhoto, cardThumb: cardThumb === cardPhoto ? null : cardThumb };
      await dbPut('companies', rec);
    }
    for (const c of data.captures || []) {
      const rec = { ...c, photos: { product: [], label: null, card: null }, voiceNote: null };
      for (const p of (c.photos && c.photos.product) || []) rec.photos.product.push(await revive(p));
      if (c.photos && c.photos.label) rec.photos.label = await revive(c.photos.label);
      if (c.photos && c.photos.card) rec.photos.card = await revive(c.photos.card);
      if (c.voiceNote && c.voiceNote.dataUrl) rec.voiceNote = { duration: c.voiceNote.duration, blob: await dataURLToBlob(c.voiceNote.dataUrl) };
      await dbPut('captures', rec);
    }
    if (data.settings && data.settings.projectName && !S.projectName) {
      S.projectName = data.settings.projectName;
      await settingSet('projectName', S.projectName);
    }
    S.captures = (await dbAll('captures')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    S.companies = await dbAll('companies');
    // restore the card counter so future "Card #N · {place}" keys never collide
    // with imported companies (backup value, or the highest N seen in the data)
    let maxN = (data.settings && data.settings.cardN) || 0;
    S.companies.forEach(co => {
      const m = /^Card #(\d+) · /.exec(co.label || co.key || '');
      if (m) maxN = Math.max(maxN, Number(m[1]));
    });
    // merge any places the backup knows about that this device doesn't
    for (const p of (data.settings && data.settings.places) || []) {
      if (p && p.name && !placeByName(p.name)) S.places.push({ id: uid('pl'), name: p.name, type: p.type || 'other' });
    }
    await settingSet('places', S.places);
    if (maxN > S.cardN) {
      S.cardN = maxN;
      await settingSet('cardN', S.cardN);
    }
    renderAll();
    Fx.toast('Backup imported');
  } catch (err) {
    Fx.toast('That backup could not be imported');
  }
}

/* ── boot ────────────────────────────────────────────────────── */
async function init() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (Actions[act]) Actions[act](el.dataset.arg, el, e);
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el && el.dataset && el.dataset.input) onInputChange(el.dataset.input, el.value);
  });
  const fb = document.querySelector('#fallback-file');
  fb.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !S.camera) return;
    // native-camera shots are stored exactly as the camera app produced them
    handleShot(S.camera, file);
  });

  await openDB();
  S.user = await settingGet('user', null);
  S.locked = !!(S.user && S.user.pin);
  S.venue = await settingGet('venue', 'Canton Fair Phase 1');
  S.session = await settingGet('session', { key: '' });
  S.cardN = await settingGet('cardN', 0);
  // places: seed the defaults once, then they are entirely the user's list
  S.places = await settingGet('places', null);
  if (!Array.isArray(S.places) || !S.places.length) {
    const legacy = await settingGet('customVenues', []);
    S.places = DEFAULT_PLACES.map(p => ({ id: uid('pl'), name: p.name, type: p.type }))
      .concat(legacy.map(name => ({ id: uid('pl'), name, type: 'other' })));
    await settingSet('places', S.places);
  }
  if (!placeByName(S.venue) && S.places.length) S.venue = S.places[0].name;
  S.leftHanded = await settingGet('leftHanded', false);
  S.nativeCamera = await settingGet('nativeCamera', false);
  S.aiKey = await settingGet('aiKey', '');
  S.projectName = await settingGet('projectName', '');
  S.firstUse = await settingGet('firstUse', null);

  // a session must never outlive its venue — clear any stale carry-over
  if (S.session.key && S.session.venue !== S.venue) {
    S.session = { key: '', venue: '' };
    await settingSet('session', S.session);
  }
  S.captures = (await dbAll('captures')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  S.companies = await dbAll('companies');
  S.compareIds = (await settingGet('compareIds', [])).filter(id => S.captures.some(c => c.id === id));

  // sweep unnamed companies left by abandoned capture flows (no records, not the live session)
  const usedKeys = new Set(S.captures.map(c => c.companyKey));
  const orphans = S.companies.filter(co => !co.name && !usedKeys.has(co.key) && co.key !== S.session.key);
  for (const co of orphans) await dbRemove('companies', co.key);
  if (orphans.length) S.companies = S.companies.filter(co => orphans.indexOf(co) === -1);

  S.ready = true;
  renderAll();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(() => healOfflineAssets())
      .catch(() => {});
  }
}

/* The heavy OCR assets are cached best-effort at SW install; if any download
   failed there, re-fetch them on a later online launch so OCR stays available
   fully offline. */
async function healOfflineAssets() {
  if (!('caches' in window) || !navigator.onLine) return;
  try {
    const cache = await caches.open('milana-v6');
    const heavy = [
      './vendor/core/tesseract-core-lstm.wasm.js',
      './vendor/core/tesseract-core-simd-lstm.wasm.js',
      './vendor/lang/chi_sim.traineddata.gz',
      './vendor/lang/eng.traineddata.gz',
    ];
    for (const url of heavy) {
      const hit = await cache.match(url);
      if (!hit) await cache.add(url);
    }
  } catch (err) { /* retried on the next launch */ }
}

init();
