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
  rv: { company: '', contact: '', wechat: '', pname: '', code: '', size: '', website: '', notes: '', bio: '', note: '' },
  rvZh: { company: '', contact: '', pname: '' },   // characters as read, kept for checking
  rvEn: {},                            // English put aside by "use 中文", for swapping back
  rvRead: { card: '', label: '' },     // '' | 'ok' | 'none' | 'fail' | 'unavailable'
  rvBusy: { card: false, label: false },
  rvLines: { card: [], label: [] },   // every line read, offered as tap-to-use
  rvTarget: '',                        // review field last touched — where a tapped line lands
  rvBioAt: '', rvLookupPending: false, bioBusy: false,
  aiKey: '',
  leftHanded: false, nativeCamera: false,
  projectName: '',
  firstUse: null, tripStart: null,
  saving: false, draftResume: false,
  persisted: false, storageInfo: null, ocrReady: null, ocrMissing: [],
  updateReady: false, skippedRecords: 0, installHintHiddenAt: 0,
  sessionUndo: null, composing: false, lowSpaceWarned: false,
  viewPhoto: null,
  pack: null, packDay: null, packShortOnly: false, packBusy: null,
  backupBusy: null, backupReady: null, lastBackupAt: null,
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

function freshLoginTmp() { return { name: '', pin: '', project: '' }; }

/* How many photos an in-progress capture holds — the number that would be
   lost if it were discarded. */
function draftPhotoCount(dr = S.draft) {
  return (dr.product ? dr.product.length : 0) + (dr.label ? 1 : 0) + (dr.card ? 1 : 0);
}

/* The in-progress capture is written to storage after every change so a
   reload (iOS suspends Home Screen apps freely, and the native camera app
   hands control away) never loses the photos already taken. Blobs go straight
   into IndexedDB like everything else. */
/* Two rows: the photos ('draft', tens of MB, written only when a photo is
   added or removed) and the tags ('draftMeta', a few hundred bytes, written
   the moment a chip is tapped — a debounce there was exactly the window in
   which a suspended app lost its last tap). Typed text is the one thing that
   still coalesces, and it is flushed on hide. */
let _draftTimer = null;
let _draftDirty = false;
function draftMeta(dr = S.draft) {
  return {
    category: dr.category, rooms: dr.rooms, rating: dr.rating,
    priceOpen: dr.priceOpen, currency: dr.currency, price: dr.price,
    supplierKey: dr.supplierKey,
  };
}
function writeDraftPhotosNow() {
  const dr = S.draft;
  if (!draftPhotoCount(dr) && !dr.voice) {
    settingRemove('draft').catch(() => {});
    return;
  }
  const snap = { venue: S.venue, savedAt: new Date().toISOString(), product: dr.product, label: dr.label, card: dr.card, voice: dr.voice };
  settingSet('draft', snap).catch(err => reportError(err, 'The unfinished capture'));
}
function writeDraftNow() {
  clearTimeout(_draftTimer);
  _draftTimer = null;
  _draftDirty = false;
  settingSet('draftMeta', draftMeta()).catch(() => { /* the photos are the part that matters; tags are one tap away */ });
}
/* Tags and choices: written at once. */
function persistDraft() { writeDraftNow(); }
/* Typed text: coalesced, then flushed on hide. */
function persistDraftTyped() {
  _draftDirty = true;
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(writeDraftNow, 150);
}
/* A photo or voice note was added or removed. */
function persistDraftPhotos() { writeDraftPhotosNow(); }
/* Called when the page is about to be hidden or reloaded: a change that is
   still waiting on the debounce must not be the one that gets lost. */
function flushDraft() { if (_draftDirty) writeDraftNow(); }
function clearDraftStore() {
  clearTimeout(_draftTimer); _draftTimer = null; _draftDirty = false;
  return dbBatch([{ store: 'settings', type: 'delete', key: 'draft' }, { store: 'settings', type: 'delete', key: 'draftMeta' }]).catch(() => {});
}

/* Any failure the user needs to know about lands here — never silent. */
function storageFailMessage(err, what) {
  if (isQuotaError(err)) return 'Not saved — this phone is out of storage. Free some space (or back up and clear old days in Settings), then try again.';
  const why = err && err.message ? String(err.message).slice(0, 90) : 'try again';
  const storage = err && (err instanceof DOMException || /storage|indexeddb|transaction|database/i.test(why));
  return (what || 'That') + (storage ? ' could not be saved — ' : ' did not go through — ') + why;
}
function reportError(err, what) {
  try { console.error(what || 'error', err); } catch (e) { /* no console */ }
  Fx.toast(storageFailMessage(err, what), { sticky: isQuotaError(err) });
}

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

/* The company-card photo for a capture. A card shot during the capture is
   stored on it; every later product from the same booth points at the
   company's copy instead of carrying its own 3–5 MB duplicate. */
function cardPhotoOf(c) {
  if (c.photos && c.photos.card) return c.photos.card;
  const co = companyOf(c.companyKey);
  return co && co.cardPhoto ? { id: 'co-' + co.key, blob: co.cardPhoto, thumb: co.cardThumb || null } : null;
}

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

/* Every photo of a capture in one list — the same indexing everywhere a photo
   is shared or viewed. */
function photoList(c) {
  const card = cardPhotoOf(c);
  return c.photos.product
    .map((p, i) => ({ p, name: 'face-' + (i + 1), cap: 'product · face ' + (i + 1) }))
    .concat(c.photos.label ? [{ p: c.photos.label, name: 'label', cap: 'label / spec' }] : [])
    .concat(card ? [{ p: card, name: 'company-card', cap: 'company card' }] : []);
}

/* Which review field a tapped OCR line goes to: the field the user last
   touched in this section, else the first empty one; none when everything is
   filled and nothing was chosen (never a silent overwrite). */
function lineTarget(grp) {
  const fields = grp === 'card' ? ['company', 'contact', 'wechat'] : ['pname', 'code', 'size'];
  if (S.rvTarget && fields.includes(S.rvTarget)) return S.rvTarget;
  return fields.find(f => !String(S.rv[f] || '').trim()) || null;
}

/* Day-pack scope: the days that have captures (newest first), the selected
   one, and the captures it covers. */
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function tripDayFor(date) {
  if (!S.tripStart) return '';
  const a = new Date(S.tripStart + 'T00:00:00'); const b = new Date(date); b.setHours(0, 0, 0, 0);
  const n = Math.round((b - a) / 86400000) + 1;
  return n >= 1 ? 'Day ' + n : '';
}
function packDays() {
  const days = Backup.dayGroups(S.captures).map(g => {
    const lbl = tripDayFor(g.date);
    return { key: g.key, date: g.date, count: g.items.length, label: (lbl ? lbl + ' · ' : '') + g.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) };
  });
  if (days.length > 1) days.push({ key: 'all', date: null, count: S.captures.length, label: 'All days' });
  return days;
}
function packSelectedDay() {
  const days = packDays();
  if (!days.length) return null;
  return days.some(d => d.key === S.packDay) ? S.packDay : days[0].key;
}
function packList() {
  const k = packSelectedDay();
  return S.captures.filter(c => (k === 'all' || dayKey(c.createdAt) === k)
    && (!S.packShortOnly || c.status === 'Shortlisted' || c.status === 'Preferred'));
}
function packKey() {
  return packSelectedDay() + '|' + (S.packShortOnly ? 'short' : 'all') + '|' + packList().map(c => c.id + ':' + (c.updatedAt || '')).join(',');
}

/* ── fx: toast + shutter flash ───────────────────────────────── */
const Fx = {
  toastT: null,
  /* opts.sticky keeps the message until it is tapped — a storage problem must
     not vanish after 2.4 s while the user is looking at the camera. */
  toast(msg, opts = {}) {
    const root = document.querySelector('#fx-root');
    if (!root) return;
    const old = root.querySelector('.toast'); if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'toast' + (opts.sticky ? ' toast-sticky' : '');
    t.textContent = msg;
    if (opts.sticky) { t.setAttribute('role', 'alert'); t.addEventListener('click', () => t.remove()); }
    root.appendChild(t);
    clearTimeout(this.toastT);
    if (!opts.sticky) this.toastT = setTimeout(() => t.remove(), opts.ms || 2400);
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
  stream: null, video: null, canvas: null, fallback: false, opening: false, denied: false, lastShotAt: 0, lastShotK: '',

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
      this.denied = false;
      // iOS ends or mutes the track when the phone locks or another app takes
      // the camera; without this the preview freezes and the shutter would
      // keep storing the same stale frame
      const track = stream.getVideoTracks()[0];
      if (track) {
        const restart = () => {
          if (this.stream !== stream) return;
          this.stop();
          if (S.camera && !document.hidden) setTimeout(() => { if (S.camera && !this.stream) this.open(); }, 250);
        };
        track.addEventListener('ended', restart);
        track.addEventListener('mute', restart);
      }
    } catch (err) {
      this.fallback = true;
      this.denied = !!(err && (err.name === 'NotAllowedError' || err.name === 'SecurityError'));
    }
    this.opening = false;
    this.attach();
  },

  attach() {
    const wrap = document.querySelector('#cam-video-wrap');
    if (!wrap) return;
    const starting = document.querySelector('#cam-starting');
    if (this.fallback || !this.stream) {
      if (starting) starting.style.display = 'none';
      const note = document.querySelector('#cam-fallback-note');
      if (note) {
        note.classList.remove('hidden'); note.style.display = 'block';
        if (this.denied) note.innerHTML = 'camera access is off for Milana —<br>allow it in Settings › Milana (or Safari) › Camera.<br>Meanwhile the shutter opens the system camera';
      }
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
    if (starting) starting.style.display = 'none';
  },

  live() {
    const t = this.stream && this.stream.getVideoTracks()[0];
    return !!(t && t.readyState === 'live' && !t.muted && this.video && this.video.videoWidth);
  },

  // The whole native video frame at full stream resolution — the on-screen
  // corner marks are a framing hint, never a crop. Thumbnails are derived later.
  // One scratch canvas is reused: iOS caps total canvas memory and a fresh
  // 12 MP canvas per shot would exhaust it within a few taps.
  async capture(quality = 0.92) {
    if (!this.live()) return null;
    try {
      const c = this.canvas || (this.canvas = document.createElement('canvas'));
      const w = this.video.videoWidth, h = this.video.videoHeight;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const x = c.getContext('2d');
      if (!x) return null;
      x.drawImage(this.video, 0, 0, w, h);
      return await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
    } catch (err) {
      return null;
    }
  },

  stop() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    if (this.canvas) { this.canvas.width = this.canvas.height = 0; }
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
        persistDraftPhotos();
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
  /* Finish a recording that is still running and wait for its audio to land
     in the draft — Save must never quietly drop a half-recorded note. */
  stopAndWait() {
    return new Promise(res => {
      if (!this.mr || this.mr.state !== 'recording') return res();
      const prev = this.mr.onstop;
      const t = setTimeout(res, 3000);
      this.mr.onstop = (e) => { try { if (prev) prev(e); } finally { clearTimeout(t); res(); } };
      this.mr.stop();
    });
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
  // Only an abandoned capture drops the shot. Tapping Next straight after the
  // shutter moves the camera on while the thumbnail is still being made — the
  // photo still belongs to this capture and must land.
  if (S.flowSeq !== flow) return;
  const stillHere = S.camera === k;
  if (k === 'product') {
    if (S.draft.product.length >= 6) { Fx.toast('Six product photos is plenty — tap Next.'); return; }
    S.draft.product.push(photo);
    persistDraftPhotos();
    renderAll();
    return;
  }
  if (k === 'label') {
    S.draft.label = photo;
    persistDraftPhotos();
    renderAll();
    if (stillHere) scheduleAdvance('label');
    return;
  }
  // company card — starts (or replaces) the session for this place
  const prev = { cardN: S.cardN, session: S.session, card: S.draft.card, supplierKey: S.draft.supplierKey };
  S.cardN += 1;
  const key = uid('co');
  const co = {
    key, label: 'Card #' + S.cardN + ' · ' + S.venue,
    name: '', nameZh: '', contact: '', contactZh: '', wechat: '',
    cardPhoto: blob, cardThumb: photo.thumb,
    venue: S.venue, word: sessWord(), createdAt: new Date().toISOString(),
  };
  S.companies.push(co);
  S.session = { key, venue: S.venue, at: co.createdAt };
  S.sessionUndo = null;
  S.draft.card = photo;
  S.draft.supplierKey = '';
  renderAll();
  try {
    await dbBatch([
      { store: 'companies', type: 'put', value: co },
      { store: 'settings', type: 'put', value: { key: 'cardN', value: S.cardN } },
      { store: 'settings', type: 'put', value: { key: 'session', value: S.session } },
    ]);
  } catch (err) {
    // roll back so memory never claims a company that storage does not hold
    S.companies = S.companies.filter(x => x.key !== key);
    S.cardN = prev.cardN; S.session = prev.session;
    S.draft.card = prev.card; S.draft.supplierKey = prev.supplierKey;
    renderAll();
    reportError(err, 'The company card');
    return;
  }
  persistDraftPhotos();
  persistDraft();
  if (stillHere) scheduleAdvance('card');
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
    // a new version that took over mid-session applies once we are back on
    // Today with nothing in progress
    if (S.updateReady && arg === 'home' && !draftPhotoCount()) { flushDraft(); location.reload(); return; }
    S.view = arg; S.detailId = null; S.companyKey = null; S.viewPhoto = null;
    if (arg !== 'reviewItem') S.reviewId = null;
    // leaving the review section entirely — hand the OCR models' memory back;
    // entering it — start loading them so the first record does not wait
    if (arg !== 'review' && arg !== 'reviewItem') OCR.release();
    else if (arg === 'review') OCR.warm();
    renderAll();
  },

  /* "use the characters instead" — swap the original Chinese into the field,
     remembering the English so it can be swapped back */
  useZh(arg) {
    if (S.rvZh[arg] && S.rv[arg] !== S.rvZh[arg]) { S.rvEn[arg] = S.rv[arg]; S.rv[arg] = S.rvZh[arg]; renderAll(); }
  },
  useEn(arg) {
    if (S.rvEn[arg] !== undefined) { S.rv[arg] = S.rvEn[arg]; delete S.rvEn[arg]; renderAll(); }
  },

  /* Tap a raw OCR line to use it: it fills the field the user last touched
     in that section, else the first empty one — never silently over a field
     that was already right. Chinese is translated on the way in, characters
     kept beside the field; a contact line loses its job title. */
  useLine(arg) {
    const at = arg.lastIndexOf('@');
    const grp = arg.slice(0, at);
    const text = (S.rvLines[grp] || [])[+arg.slice(at + 1)];
    if (!text) return;
    const target = lineTarget(grp);
    if (!target) { Fx.toast('Tap the field you want to fill, then tap the line.'); return; }
    const src = target === 'contact' ? (OCR.personName(text) || text) : text;
    const pair = ZH.pair(src, { person: target === 'contact' });
    S.rv[target] = pair.value;
    if (pair.zh && (target === 'company' || target === 'contact' || target === 'pname')) S.rvZh[target] = pair.zh;
    renderAll();
  },

  /* Full-screen photo: arg is 'rv@card' / 'rv@label' (the record being
     reviewed), 'co@<key>' (a company card) or '<captureId>@<index>'. */
  viewPhoto(arg) {
    const s = String(arg);
    const at = s.indexOf('@');
    const kind = s.slice(0, at), ref = s.slice(at + 1);
    let blob = null, cap = '', share = '';
    if (kind === 'rv') {
      const c = S.captures.find(x => x.id === S.reviewId);
      const p = c && (ref === 'card' ? cardPhotoOf(c) : c.photos.label);
      if (c && p) {
        blob = p.blob; cap = ref === 'card' ? 'company card' : 'label / spec';
        const i = photoList(c).findIndex(e => e.p === p || e.p.blob === p.blob);
        if (i >= 0) share = c.id + '@' + i;
      }
    } else if (kind === 'co') {
      const co = companyOf(ref);
      blob = co && co.cardPhoto; cap = 'company card';
    } else {
      const c = S.captures.find(x => x.id === kind);
      const e = c ? photoList(c)[Number(ref)] : null;
      if (e) { blob = e.p.blob; cap = e.cap; share = kind + '@' + ref; }
    }
    if (!blob) return;
    S.viewPhoto = { blob, cap, share, zoom: 1 };
    render();
  },
  closePhoto() { S.viewPhoto = null; render(); },
  zoomPhoto() { if (S.viewPhoto) { S.viewPhoto.zoom = S.viewPhoto.zoom > 1 ? 1 : 2.5; render(); } },

  hideInstallHint() {
    S.installHintHiddenAt = Date.now();
    settingSet('installHintHiddenAt', S.installHintHiddenAt).catch(() => {});
    render();
  },

  openSettings() {
    S.settingsOn = true; renderAll();
    refreshStorageInfo().then(() => { if (S.settingsOn) render(); });
    healOfflineAssets();
  },
  closeSettings() { S.settingsOn = false; renderAll(); },
  openVenueSheet() { S.venueSheetOn = true; S.addPlaceOpen = false; S.placeEdit = false; renderAll(); },
  closeVenueSheet() { S.venueSheetOn = false; S.addPlaceOpen = false; S.placeEdit = false; renderAll(); },
  togglePlaceEdit() { S.placeEdit = !S.placeEdit; S.addPlaceOpen = false; renderAll(); },

  async pickVenue(arg) {
    const place = S.places.find(p => p.id === arg) || placeByName(arg);
    const name = place ? place.name : arg;
    if (name === S.venue) { S.venueSheetOn = false; S.addPlaceOpen = false; renderAll(); return; }
    const hadSession = !!S.session.key;
    // a card shot in the capture that is open right now belongs to the place
    // being corrected — it moves with the correction instead of being dropped
    const liveCo = (S.view === 'shoot' || S.view === 'tag') && S.draft.card && S.session.key ? companyOf(S.session.key) : null;
    S.flowSeq += 1;
    S.venue = name; S.venueSheetOn = false; S.addPlaceOpen = false; S.placeEdit = false;
    if (liveCo) {
      liveCo.venue = name;
      liveCo.word = sessWord();
      liveCo.label = String(liveCo.label || '').replace(/ · .*$/, '') + ' · ' + name;
      S.session = { key: liveCo.key, venue: name, at: S.session.at };
      await dbPut('companies', liveCo);
    } else {
      S.session = { key: '', venue: '' };
      S.draft.card = null;
    }
    await settingSet('venue', name);
    await settingSet('session', S.session);
    renderAll();
    if (liveCo) Fx.toast('Place corrected — the company card stays with this capture.');
    else if (hadSession) Fx.toast('New place — the company card was reset.');
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
    // an unfinished capture with photos is never thrown away by accident
    if (S.view !== 'shoot' && S.view !== 'tag' && draftPhotoCount()) {
      const n = draftPhotoCount();
      if (!confirm('You have an unfinished capture with ' + n + (n === 1 ? ' photo' : ' photos') + '. Start a new one and discard it?')) {
        Actions.resumeDraft();
        return;
      }
      clearDraftStore();
    }
    Rec.reset();
    S.flowSeq += 1;
    S.draft = freshDraft();
    S.draftResume = false;
    S.view = 'shoot';
    S.detailId = null; S.reviewId = null;
    S.startedAt = Date.now();
    S.camera = 'product';
    renderAll();
  },
  closeFlow() {
    const n = draftPhotoCount();
    if (n && !confirm('Discard this capture and its ' + n + (n === 1 ? ' photo' : ' photos') + '?')) return;
    Rec.reset();
    S.flowSeq += 1;
    S.view = 'home'; S.camera = null; S.startedAt = null;
    S.draft = freshDraft();
    S.draftResume = false;
    clearDraftStore();
    renderAll();
  },

  /* The banner on Today after a reload found an unfinished capture. */
  resumeDraft() {
    S.draftResume = false;
    S.flowSeq += 1;
    S.view = 'shoot'; S.camera = null;
    S.detailId = null; S.reviewId = null; S.companyKey = null;
    S.startedAt = Date.now();
    renderAll();
  },
  discardDraft() {
    const n = draftPhotoCount();
    if (n && !confirm('Discard the unfinished capture and its ' + n + (n === 1 ? ' photo' : ' photos') + '?')) return;
    S.draft = freshDraft();
    S.draftResume = false;
    clearDraftStore();
    renderAll();
  },

  openCam(arg) { S.camera = arg; renderAll(); },
  cancelCam() {
    S.flowSeq += 1;
    // backing out of "New booth" before a card was shot puts the booth back
    if (S.camera === 'card' && S.sessionUndo && !S.draft.card) {
      S.session = S.sessionUndo;
      settingSet('session', S.session).catch(() => {});
    }
    S.sessionUndo = null;
    S.camera = null;
    renderAll();
  },

  // "↻ New booth / new card": break the company session and shoot the new
  // card in one tap (Cancel in the camera undoes the break)
  async newBooth() {
    S.flowSeq += 1;
    S.sessionUndo = S.session.key ? { ...S.session } : null;
    S.session = { key: '', venue: '' };
    S.draft.card = null;
    S.draft.supplierKey = '';
    await settingSet('session', S.session);
    S.camera = 'card';
    renderAll();
  },

  /* A blurry face can go without restarting the capture. */
  removeProductPhoto(arg) {
    const i = Number(arg);
    const p = S.draft.product[i];
    if (!p) return;
    S.draft.product.splice(i, 1);
    revokeUrlFor(p.blob); revokeUrlFor(p.thumb);
    persistDraftPhotos();
    renderAll();
  },

  async sharePhoto(arg) {
    const [capId, idxStr] = String(arg).split('@');
    const c = S.captures.find(x => x.id === capId);
    if (!c) return;
    const entry = photoList(c)[Number(idxStr)];
    if (!entry) return;
    const base = (dispName(c) || 'photo').replace(/[^\w一-鿿-]+/g, '-').slice(0, 40);
    const type = entry.p.blob.type || 'image/jpeg';
    const ext = type.includes('png') ? '.png' : type.includes('heic') || type.includes('heif') ? '.heic' : '.jpg';
    const r = await shareOrDownload(base + '-' + entry.name + ext, entry.p.blob, type);
    if (r === 'downloaded') Fx.toast('Photo saved to your Downloads folder');
    else if (r === 'failed') Fx.toast('Could not open the share sheet — try again.');
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
    // a double-tap on the shutter is one shot, not two photos (or two company
    // records); moving on to the next slot is never held up
    if (Cam.lastShotK === k && Date.now() - Cam.lastShotAt < 350) return;
    Cam.lastShotAt = Date.now(); Cam.lastShotK = k;
    if (k === 'product' && S.draft.product.length >= 6) { Fx.toast('Six product photos is plenty — tap Next.'); return; }
    if (Cam.fallback || !Cam.stream) {
      const input = document.querySelector('#fallback-file');
      if (input) input.click();
      return;
    }
    Fx.flash();
    const flow = S.flowSeq;
    const blob = await Cam.capture();
    if (S.flowSeq !== flow) return; // capture abandoned while the frame was grabbed
    if (!blob) { Fx.toast('The camera is still starting — try again.'); return; }
    handleShot(k, blob).catch(err => reportError(err, 'That photo'));
  },

  toDetails() {
    if (!S.draft.product.length) return;
    S.view = 'tag'; S.camera = null;
    renderAll();
  },
  backToShoot() { S.view = 'shoot'; S.camera = null; renderAll(); },

  pickCat(arg) { S.draft.category = S.draft.category === arg ? '' : arg; persistDraft(); renderAll(); },
  toggleRoom(arg) {
    const r = S.draft.rooms;
    S.draft.rooms = r.includes(arg) ? r.filter(x => x !== arg) : r.concat(arg);
    persistDraft();
    renderAll();
  },
  toggleRoomsMore() { S.draft.roomsMore = !S.draft.roomsMore; renderAll(); },
  setRating(arg) { const n = Number(arg); S.draft.rating = S.draft.rating === n ? 0 : n; persistDraft(); renderAll(); },
  togglePrice() { S.draft.priceOpen = !S.draft.priceOpen; renderAll(); },
  setCurrency(arg) { S.draft.currency = arg; persistDraft(); renderAll(); },
  pickSupplier(arg) { S.draft.supplierKey = S.draft.supplierKey === arg ? '' : arg; persistDraft(); renderAll(); },

  rec() { Rec.toggle(); },
  delVoice() { S.draft.voice = null; S.draft.rec = 'idle'; S.draft.recSec = 0; persistDraftPhotos(); renderAll(); },
  playVoice() { if (S.draft.voice) playBlob(S.draft.voice.blob); },
  playVoiceOf(arg) {
    const c = S.captures.find(x => x.id === arg);
    if (c && c.voiceNote) playBlob(c.voiceNote.blob);
  },

  async save() {
    const dr = S.draft;
    if (S.saving) return;
    if (!dr.product.length) {
      Fx.toast('Shoot at least one product photo first');
      S.view = 'shoot'; S.camera = 'product';
      renderAll();
      return;
    }
    if (!dr.category) { Fx.toast('Pick a category first'); return; }
    // a voice note still recording is finished and kept, never dropped
    if (dr.rec === 'rec') await Rec.stopAndWait();
    const sessionCo = dr.card || sessionCompany() ? sessionCompany() : null;
    const companyKey = sessionCo ? S.session.key : (dr.supplierKey || '');
    const now = new Date().toISOString();
    // the card shot in THIS capture is stored on it; later products from the
    // same booth point at the company's copy (see cardPhotoOf)
    const rec = {
      id: uid('cap'), createdAt: now, updatedAt: now,
      createdBy: S.user.name, role: S.user.role,
      venue: S.venue, category: dr.category, rooms: dr.rooms.slice(), rating: dr.rating,
      currency: dr.currency, price: dr.price.trim(), note: '',
      voiceNote: dr.voice ? { blob: dr.voice.blob, duration: dr.voice.duration } : null,
      photos: { product: dr.product.slice(), label: dr.label, card: dr.card || null },
      companyKey, name: '', code: '', size: '',
      status: 'Captured', needsReview: true,
      missing: ['name'].concat(companyKey ? [] : ['company']).concat(dr.label ? ['code'] : ['label photo']),
      capturedInSec: elapsedSec(),
    };
    S.saving = true;
    renderAll();
    try {
      // the capture lands and the in-progress draft is cleared in ONE
      // transaction: never both, never neither
      clearTimeout(_draftTimer); _draftTimer = null; _draftDirty = false;
      await dbBatch([
        { store: 'captures', type: 'put', value: rec },
        { store: 'settings', type: 'delete', key: 'draft' },
        { store: 'settings', type: 'delete', key: 'draftMeta' },
      ]);
    } catch (err) {
      // the draft — and every photo in it — stays exactly where it is
      S.saving = false;
      renderAll();
      reportError(err, 'The capture');
      return;
    }
    S.saving = false;
    S.captures.unshift(rec);
    S.flowSeq += 1;
    S.lastSaved = {
      venue: S.venue, sec: rec.capturedInSec, sessWord: sessWord(),
      sessionOn: !!sessionCompany(),
      slots: [
        { blob: photoThumb(dr.product[0]), count: dr.product.length },
        { blob: photoThumb(dr.label), count: 0 },
        { blob: photoThumb(cardPhotoOf(rec)), count: 0 },
      ],
      chips: savedChips(rec),
    };
    Rec.reset();
    S.draft = freshDraft();
    S.draftResume = false;
    S.view = 'saved'; S.startedAt = null; S.camera = null;
    renderAll();
    if (!S.persisted) requestPersistence();
    refreshStorageInfo().then(() => {
      const st = S.storageInfo;
      if (st && st.quota && st.quota - st.usage < 300 * 1024 * 1024 && !S.lowSpaceWarned) {
        S.lowSpaceWarned = true;
        Fx.toast('This phone is getting low on space — back up and clear old days soon.', { sticky: true });
      }
    });
  },

  openDetail(arg) { S.detailId = arg; renderAll(); },
  closeDetail() { S.detailId = null; renderAll(); },

  async setStatus(arg) {
    const c = S.captures.find(x => x.id === S.detailId);
    if (!c) return;
    const before = { status: c.status, updatedAt: c.updatedAt };
    c.status = arg;
    c.updatedAt = new Date().toISOString();
    try { await dbPut('captures', c); } catch (err) { Object.assign(c, before); reportError(err, 'The status'); return; }
    renderAll();
    Fx.toast(arg === 'Rejected' ? 'Marked rejected' : arg === 'Preferred' ? 'Marked preferred' : arg === 'Captured' ? 'Rejection removed' : 'Added to the shortlist');
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
    await dbRemove('captures', arg);
    c.photos.product.forEach(p => { revokeUrlFor(p.blob); revokeUrlFor(p.thumb); });
    if (c.photos.label) { revokeUrlFor(c.photos.label.blob); revokeUrlFor(c.photos.label.thumb); }
    if (c.photos.card) { revokeUrlFor(c.photos.card.blob); revokeUrlFor(c.photos.card.thumb); }
    if (c.voiceNote) revokeUrlFor(c.voiceNote.blob);
    S.captures = S.captures.filter(x => x.id !== arg);
    S.compareIds = S.compareIds.filter(x => x !== arg);
    S.pack = null;
    await settingSet('compareIds', S.compareIds);
    S.detailId = null;
    // if that was the company's last product, offer to drop the company record too
    const co = companyOf(c.companyKey);
    if (co && !S.captures.some(x => x.companyKey === co.key)) {
      if (confirm('That was the last product from “' + coName(co) + '”. Delete the company record too?')) {
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

  /* Level 2 lookup: fetch a short company bio via the Claude API.
     arg is 'rv' (Complete Record screen) or a company key. Offline or failed
     calls set a "lookup pending" flag so the retry button appears. */
  cancelBio() { Lookup.cancel(); },
  async fetchBio(arg) {
    if (S.bioBusy) return;
    if (!S.aiKey) { Fx.toast('Add your AI lookup API key in Settings first.'); return; }
    const isRv = arg === 'rv';
    const startId = S.reviewId; // a slow answer must land on the record it was asked for
    const cap = isRv ? S.captures.find(x => x.id === S.reviewId) : null;
    const co = isRv ? (cap ? companyOf(cap.companyKey) : null) : companyOf(arg);
    const info = isRv
      ? { name: S.rv.company.trim(), nameZh: S.rvZh.company, contact: S.rv.contact.trim(), wechat: S.rv.wechat.trim(), venue: (cap && cap.venue) || S.venue }
      : (co ? { name: coName(co), nameZh: co.nameZh, contact: co.contact, wechat: co.wechat, venue: co.venue } : null);
    if (!info || !info.name) { Fx.toast('Confirm the company name first.'); return; }
    const onRecord = () => !isRv || S.reviewId === startId;
    const markPending = async (pending) => {
      if (isRv && onRecord()) S.rvLookupPending = pending;
      if (co) { co.lookupPending = pending; await dbPut('companies', co); }
    };
    if (!navigator.onLine) {
      await markPending(true);
      renderAll();
      Fx.toast('No signal — tap Retry on the record when you are back online.');
      return;
    }
    S.bioBusy = true;
    renderAll();
    try {
      const text = await Lookup.fetchBio(S.aiKey, info);
      const at = new Date().toISOString();
      if (isRv && onRecord()) { S.rv.bio = text; S.rvBioAt = at; S.rvLookupPending = false; }
      if (co) { co.bio = text; co.bioAt = at; co.lookupPending = false; await dbPut('companies', co); }
      Fx.toast('Bio fetched — AI lookup, verify it yourself.');
    } catch (err) {
      await markPending(true);
      Fx.toast((err && err.message) ? String(err.message).slice(0, 160) : 'The lookup failed — try again.', { ms: 5000 });
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
      note: c.note || '',
    };
    S.rvTarget = '';
    S.rvZh = {
      company: (co && co.nameZh) || '', contact: (co && co.contactZh) || '', pname: c.nameZh || '',
    };
    S.rvEn = {};
    S.rvRead = { card: '', label: '' };
    S.rvBusy = { card: false, label: false };
    S.rvLines = { card: [], label: [] };
    S.rvBioAt = (co && co.bioAt) || '';
    S.rvLookupPending = !!(co && co.lookupPending);
    renderAll();
    runOcrPrefill(c);
  },

  async confirmReview() {
    const c = S.captures.find(x => x.id === S.reviewId);
    if (!c) return;
    if (S.rvBusy.card || S.rvBusy.label) { Fx.toast('Still reading the photos — a moment.'); return; }
    const wasComplete = !c.needsReview;
    let co = companyOf(c.companyKey);
    const coName = S.rv.company.trim();
    const newCo = !co && coName;
    if (newCo) {
      const cardP = c.photos.card || null;
      co = { key: uid('co'), name: '', contact: '', wechat: '', cardPhoto: cardP ? cardP.blob : null, cardThumb: cardP ? cardP.thumb : null,
        venue: c.venue, word: sessWord(), createdAt: new Date().toISOString() };
    }
    const coBefore = co ? { ...co } : null;
    const cBefore = { ...c };
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
    }
    c.name = S.rv.pname.trim() || c.name;
    c.nameZh = S.rvZh.pname || c.nameZh || '';
    c.code = S.rv.code.trim();
    c.size = S.rv.size.trim();
    c.note = (S.rv.note || '').trim();
    if (newCo) c.companyKey = co.key;
    if (c.status === 'Needs review') c.status = 'Captured';
    c.needsReview = false;
    c.missing = [];
    c.updatedAt = new Date().toISOString();
    try {
      const ops = [{ store: 'captures', type: 'put', value: c }];
      if (co) ops.push({ store: 'companies', type: 'put', value: co });
      await dbBatch(ops);
    } catch (err) {
      Object.assign(c, cBefore);
      if (co && coBefore) Object.assign(co, coBefore);
      reportError(err, 'The record');
      return;
    }
    if (newCo) S.companies.push(co);
    S.view = 'review'; S.reviewId = null;
    renderAll();
    Fx.toast(wasComplete ? 'Record updated' : 'Record completed — company saved for every product from that ' + ((co && co.word) || 'company'));
  },

  /* Day pack: choose a day (and shortlist-only), build once with progress,
     then share from a fresh tap — the share sheet only opens inside a user
     gesture, and a long build would have spent it. */
  setPackDay(arg) { S.packDay = arg; S.pack = null; renderAll(); },
  togglePackShort() { S.packShortOnly = !S.packShortOnly; S.pack = null; renderAll(); },

  async buildPack() {
    if (S.packBusy) return;
    const list = packList();
    if (!list.length) { Fx.toast('Nothing to put in the pack — pick another day.'); return; }
    const key = packKey();
    const sel = packSelectedDay();
    const day = packDays().find(d => d.key === sel);
    const title = sel === 'all' ? 'All days' : (day ? day.label : '');
    const dateStr = sel === 'all' || !day || !day.date ? '' : day.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    S.packBusy = { done: 0, total: list.length }; S.pack = null;
    renderAll();
    try {
      list.forEach(c => { c._company = companyOf(c.companyKey); });
      const { blob, pages } = await DayPack.build(list, supName, {
        title, dateStr,
        companyOf: c => companyOf(c.companyKey),
        onProgress: (done, total) => { S.packBusy = { done, total }; render(); },
      });
      const stamp = sel === 'all' ? 'all-days' : (day && day.date ? ymd(day.date) : 'day');
      S.pack = { key, blob, pages, name: 'milana-day-pack-' + stamp + (S.packShortOnly ? '-shortlist' : '') + '.pdf' };
      Fx.toast('Day pack ready — tap Share PDF.');
    } catch (err) {
      reportError(err, 'The day pack');
    } finally {
      list.forEach(c => { delete c._company; });
      S.packBusy = null;
      renderAll();
    }
  },

  async sharePack() {
    if (!S.pack) return;
    const r = await shareOrDownload(S.pack.name, S.pack.blob, 'application/pdf');
    if (r === 'shared') Fx.toast('Day pack handed to the share sheet');
    else if (r === 'downloaded') Fx.toast('Day pack saved to your Downloads folder');
    else if (r === 'failed') Fx.toast('Could not open the share sheet — tap Share PDF again.');
  },

  async toggleLeftHanded() {
    S.leftHanded = !S.leftHanded;
    await settingSet('leftHanded', S.leftHanded);
    renderAll();
  },

  pickRole(arg) { S.loginRole = arg; renderAll(); },

  /* Backups: pack today's (or every) capture into .milana files (see
     js/backup.js), then hand them over from a fresh tap. */
  async exportBackup(arg) {
    if (S.backupBusy) return;
    const list = arg === 'today' ? S.captures.filter(c => dayKey(c.createdAt) === dayKey()) : S.captures;
    if (!list.length) { Fx.toast('Nothing to back up yet.'); return; }
    S.backupBusy = { label: 'Packing', done: 0, total: list.length }; S.backupReady = null;
    render();
    try {
      const res = await Backup.build(list, S.companies,
        { projectName: S.projectName, places: S.places, cardN: S.cardN, venue: S.venue, tripStart: S.tripStart },
        p => { S.backupBusy = p; render(); });
      S.backupReady = res;
      Fx.toast('Backup ready — tap Save it and choose Files or AirDrop.');
    } catch (err) {
      reportError(err, 'The backup');
    } finally {
      S.backupBusy = null;
      render();
    }
  },

  async shareBackup() {
    const r = S.backupReady;
    if (!r || !r.files.length) return;
    const file = r.files[0];
    const res = await shareOrDownload(file.name, file, file.type);
    if (res === 'shared' || res === 'downloaded') {
      r.files = r.files.slice(1);
      r.bytes = r.files.reduce((n, f) => n + f.size, 0);
      if (!r.files.length) {
        S.backupReady = null;
        S.lastBackupAt = new Date().toISOString();
        settingSet('lastBackupAt', S.lastBackupAt).catch(() => {});
        Fx.toast(res === 'shared' ? 'Backup handed to the share sheet' : 'Backup saved to your Downloads folder');
      } else {
        Fx.toast((res === 'shared' ? 'One file saved — ' : 'One file downloaded — ') + r.files.length + ' more to save.');
      }
    } else if (res === 'failed') {
      Fx.toast('Could not open the share sheet — tap Save it again.');
    }
    render();
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
    // the BOM makes Excel open the Chinese columns correctly
    const csv = '﻿' + rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
    shareOrDownload('milana-source-' + ymd(new Date()) + '.csv', new Blob([csv], { type: 'text/csv' }), 'text/csv')
      .then(r => { if (r === 'downloaded') Fx.toast('CSV saved to your Downloads folder'); else if (r === 'failed') Fx.toast('Could not open the share sheet — try again.'); });
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
    S.pack = null; S.backupReady = null; S.draft = freshDraft(); S.draftResume = false;
    S.firstUse = new Date().toISOString();
    await clearDraftStore();
    await settingSet('compareIds', []);
    await settingSet('session', S.session);
    await settingSet('cardN', 0);
    await settingSet('firstUse', S.firstUse);
    S.settingsOn = false; S.view = 'home';
    renderAll();
    Fx.toast('Local project data erased');
  },

  /* The PIN is a convenience lock, not a vault: a forgotten one must not
     strand the owner outside every capture. The way back in is explicit and
     destructive, so it asks twice. */
  async forgotPin() {
    if (!confirm('Forgot the PIN? The only way back in is to erase everything Milana has stored on this phone — every capture, photo and company. Continue?')) return;
    const typed = prompt('Type ERASE to confirm:');
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== 'ERASE') { Fx.toast('Nothing was erased.'); return; }
    await dbClear('captures');
    await dbClear('companies');
    await dbClear('settings');
    revokeAllUrls();
    location.reload();
  },

  async signOut() {
    await dbRemove('settings', 'user');
    S.user = null; S.locked = false; S.settingsOn = false;
    S.loginTmp = freshLoginTmp();
    renderAll();
  },
};

/* ── OCR pre-fill at review time ─────────────────────────────── */
function renderIfReview(id) { if (S.view === 'reviewItem' && S.reviewId === id) renderAll(); }

/* Card first, then label — one photo through the pipeline at a time, because
   two full-size preprocess runs side by side exceed what iOS grants a page. */
async function runOcrPrefill(c) {
  const id = c.id;
  const cardP = cardPhotoOf(c);
  const cardBlob = cardP && cardP.blob;
  const labelBlob = c.photos.label && c.photos.label.blob;
  const needCard = cardBlob && !(S.rv.company && S.rv.contact && S.rv.wechat);
  const needLabel = labelBlob && !(S.rv.pname && S.rv.code && S.rv.size);
  if (typeof Tesseract === 'undefined') { S.rvRead = { card: cardBlob ? 'unavailable' : '', label: labelBlob ? 'unavailable' : '' }; renderIfReview(id); return; }
  const gone = () => S.reviewId !== id;
  if (needCard) S.rvBusy.card = true;
  if (needLabel) S.rvBusy.label = true;
  renderIfReview(id);
  if (needCard) {
    try {
      const lines = await OCR.readLines(cardBlob, { isCancelled: gone });
      if (gone()) return;
      S.rvLines.card = lines.map(l => l.text);
      S.rvRead.card = lines.length ? 'ok' : 'none';
      const res = OCR.parseCard(lines);
      if (!S.rv.company && res.company.value) S.rv.company = res.company.value;
      if (!S.rv.contact && res.contact.value) S.rv.contact = res.contact.value;
      if (!S.rv.wechat && res.wechat.value) S.rv.wechat = res.wechat.value;
      if (!S.rvZh.company && res.company.zh) S.rvZh.company = res.company.zh;
      if (!S.rvZh.contact && res.contact.zh) S.rvZh.contact = res.contact.zh;
    } catch (err) {
      if (!gone()) { S.rvRead.card = OCR.modelsMissing(err) ? 'unavailable' : 'fail'; }
    } finally {
      if (!gone()) { S.rvBusy.card = false; renderIfReview(id); }
    }
  }
  if (needLabel && !gone()) {
    try {
      const lines = await OCR.readLines(labelBlob, { isCancelled: gone });
      if (gone()) return;
      S.rvLines.label = lines.map(l => l.text);
      S.rvRead.label = lines.length ? 'ok' : 'none';
      const res = OCR.parseLabel(lines);
      if (!S.rv.pname && res.pname.value) S.rv.pname = res.pname.value;
      if (!S.rv.code && res.code.value) S.rv.code = res.code.value;
      if (!S.rv.size && res.size.value) S.rv.size = res.size.value;
      if (!S.rvZh.pname && res.pname.zh) S.rvZh.pname = res.pname.zh;
    } catch (err) {
      if (!gone()) { S.rvRead.label = OCR.modelsMissing(err) ? 'unavailable' : 'fail'; }
    } finally {
      if (!gone()) { S.rvBusy.label = false; renderIfReview(id); }
    }
  }
}

/* ── input handling (delegated) ──────────────────────────────── */
let _qTimer = null;
function onInputChange(name, value) {
  if (name === 'q') {
    S.q = value;
    clearTimeout(_qTimer);
    _qTimer = setTimeout(() => { if (!S.composing) renderAll(); }, 140);
  } else if (name === 'price') {
    S.draft.price = value;
    persistDraftTyped();
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
  } else if (name === 'tripStart') {
    S.tripStart = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    S.pack = null;
    clearTimeout(window.__tripTimer);
    window.__tripTimer = setTimeout(() => settingSet('tripStart', S.tripStart), 400);
  } else if (name.indexOf('co.') === 0) {
    // name / contact / website / notes / bio typed straight onto an open company record
    const co = companyOf(S.companyKey);
    if (co) {
      co[name.slice(3)] = value;
      clearTimeout(window.__coTimer);
      window.__coTimer = setTimeout(() => {
        co.updatedAt = new Date().toISOString();
        dbPut('companies', co).catch(err => reportError(err, 'The company'));
      }, 400);
    }
  } else if (name.indexOf('rv.') === 0) {
    S.rv[name.slice(3)] = value;
    if (name === 'rv.company') {
      // the "Look up company" section appears once a name is present
      clearTimeout(window.__rvCoTimer);
      window.__rvCoTimer = setTimeout(() => { if (S.view === 'reviewItem' && !S.composing) render(); }, 350);
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
      if (S.viewPhoto) html += photoViewer();
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
      const name = String((form.elements.name && form.elements.name.value) || S.loginTmp.name || '').trim();
      if (!name) return;
      const pin = String((form.elements.pin && form.elements.pin.value) || S.loginTmp.pin || '').trim();
      const project = String((form.elements.project && form.elements.project.value) || S.loginTmp.project || '').trim();
      S.user = { name, role: S.loginRole, pin };
      try {
        await settingSet('user', S.user);
        if (project) {
          S.projectName = project;
          await settingSet('projectName', project);
        }
        if (!S.firstUse) {
          S.firstUse = new Date().toISOString();
          await settingSet('firstUse', S.firstUse);
        }
      } catch (err) {
        reportError(err, 'Your sign-in');
      }
      S.locked = false;
      S.loginTmp = freshLoginTmp();
      renderAll();
      requestPersistence();
    });
  }
  const uf = document.querySelector('#unlock-form');
  if (uf && !uf._bound) {
    uf._bound = true;
    uf.addEventListener('submit', ev => {
      ev.preventDefault();
      const form = ev.currentTarget;
      const pin = String((form.elements.pin && form.elements.pin.value) || S.loginTmp.pin || '').trim();
      if (pin === String(S.user.pin || '')) {
        S.locked = false;
        S.loginTmp = freshLoginTmp();
        renderAll();
      } else {
        Fx.toast('Incorrect PIN');
      }
    });
  }
  const imp = document.querySelector('#import-json');
  if (imp && !imp._bound) {
    imp._bound = true;
    imp.addEventListener('change', importBackup);
  }
}

/* Import one or more backup files (the .milana container, or a legacy .json)
   with a progress line, then reload state from storage. Never half-silent:
   the closing message says exactly what landed and what was skipped. */
async function importBackup(e) {
  const files = e.target.files ? [...e.target.files] : [];
  e.target.value = '';
  if (!files.length) return;
  S.backupBusy = { label: 'Importing', done: 0, total: 0 };
  render();
  try {
    const sum = await Backup.importFiles(files, p => { S.backupBusy = p; render(); });
    S.captures = (await dbAll('captures')).filter(c => c && typeof c.id === 'string' && c.photos && Array.isArray(c.photos.product))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    S.companies = (await dbAll('companies')).filter(co => co && typeof co.key === 'string');
    // restore the card counter so future "Card #N · {place}" labels never collide
    let maxN = S.cardN;
    S.companies.forEach(co => { const m = /^Card #(\d+) · /.exec(co.label || ''); if (m) maxN = Math.max(maxN, Number(m[1])); });
    if (maxN > S.cardN) { S.cardN = maxN; await settingSet('cardN', S.cardN); }
    S.pack = null;
    const msg = sum.captures + (sum.captures === 1 ? ' capture' : ' captures') + ', ' + sum.companies + (sum.companies === 1 ? ' company' : ' companies') + ' imported'
      + (sum.skipped ? ' · ' + sum.skipped + ' skipped' : '') + (sum.notes.length ? ' · ' + sum.notes[0] : '');
    Fx.toast(msg, { sticky: !!(sum.skipped || sum.notes.length) });
  } catch (err) {
    reportError(err, 'The import');
  } finally {
    S.backupBusy = null;
    renderAll();
  }
}

/* ── boot ────────────────────────────────────────────────────── */
let _listenersBound = false;
function bindGlobalListeners() {
  if (_listenersBound) return;
  _listenersBound = true;
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (!Actions[act]) return;
    // every action's failure surfaces — an async action that rejects is not
    // allowed to die quietly in the console
    try {
      const r = Actions[act](el.dataset.arg, el, e);
      if (r && typeof r.catch === 'function') r.catch(err => reportError(err, 'That'));
    } catch (err) { reportError(err, 'That'); }
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el && el.dataset && el.dataset.input) onInputChange(el.dataset.input, el.value);
  });
  // a re-render mid-composition would break pinyin / Chinese keyboard input
  document.addEventListener('compositionstart', () => { S.composing = true; });
  document.addEventListener('compositionend', e => { S.composing = false; const el = e.target; if (el && el.dataset && el.dataset.input) onInputChange(el.dataset.input, el.value); });
  // remember which review field was last touched, so a tapped OCR line goes
  // where the user is looking rather than over a field that was already right
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (el && el.dataset && el.dataset.input && el.dataset.input.indexOf('rv.') === 0) S.rvTarget = el.dataset.input.slice(3);
  });
  const fb = document.querySelector('#fallback-file');
  fb.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !S.camera) return;
    // native-camera shots are stored exactly as the camera app produced them
    handleShot(S.camera, file).catch(err => reportError(err, 'That photo'));
  });
  // the camera must not run in the background, and must come back on return;
  // a draft change still waiting on its debounce is written before we go
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { flushDraft(); Cam.stop(); }
    else if (S.camera && S.ready) renderCam();
  });
  window.addEventListener('pagehide', flushDraft);
  window.addEventListener('error', e => { if (e && e.error) reportError(e.error, 'Something'); });
  window.addEventListener('unhandledrejection', e => { reportError(e.reason, 'Something'); });
}

/* Ask the browser never to evict this origin's storage (iOS deletes data from
   sites it decides are unused; an installed app with persistence is safe). */
async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      S.persisted = (navigator.storage.persisted && await navigator.storage.persisted()) || await navigator.storage.persist();
    }
  } catch (e) { /* not supported */ }
}
async function refreshStorageInfo() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      S.storageInfo = { usage: e.usage || 0, quota: e.quota || 0 };
    }
  } catch (e) { /* not supported */ }
}

/* The screen shown when storage itself cannot be opened: no blank page, a
   plain explanation, and a way back. */
function bootError(err) {
  const app = document.querySelector('#app');
  const msg = err && err.message ? String(err.message) : String(err || 'unknown error');
  app.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;background:#201a17">
    <div style="width:min(400px,100%);background:#fffdf9;border-radius:24px;padding:26px;box-shadow:0 30px 80px rgba(0,0,0,.3)">
      <div style="color:#8b2d2d;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase">Storage problem</div>
      <h1 class="serif" style="margin:5px 0 8px;font-size:26px">Milana could not open its records</h1>
      <p style="font-size:13.5px;color:#625852;line-height:1.5;margin:0 0 14px">Your captures are still on this phone — nothing has been deleted. This usually clears on a retry. If it keeps happening, close any other Milana window, or restart the phone and open the app again.</p>
      <div class="mono" style="font-size:11px;color:#625852;background:#f4f0e9;border-radius:10px;padding:8px 10px;margin-bottom:14px;word-break:break-word">${esc(msg)}</div>
      <button data-act="retryBoot" class="pf p98" style="width:100%;min-height:54px;border:0;border-radius:16px;background:#6f273a;color:#fff;font-size:16px;font-weight:800">Try again</button>
      <button data-act="reloadApp" style="width:100%;margin-top:8px;min-height:48px;border:1px solid #d7cbbd;border-radius:14px;background:#fffdf9;color:#201a17;font-size:14px;font-weight:700">Reload the app</button>
    </div>
  </div>`;
}
Actions.retryBoot = function () { _dbPromise = null; bootData(); };
Actions.reloadApp = function () { location.reload(); };

async function openDBWithRetry() {
  try { return await openDB(); } catch (err) {
    _dbPromise = null;
    await new Promise(r => setTimeout(r, 700));
    return openDB();
  }
}

async function bootData() {
  try {
    await openDBWithRetry();
    S.user = await settingGet('user', null);
    S.locked = !!(S.user && S.user.pin);
    S.venue = await settingGet('venue', 'Canton Fair Phase 1');
    S.session = await settingGet('session', { key: '' });
    if (!S.session || typeof S.session !== 'object') S.session = { key: '', venue: '' };
    S.cardN = Number(await settingGet('cardN', 0)) || 0;
    // places: seed the defaults once, then they are entirely the user's list
    S.places = await settingGet('places', null);
    if (!Array.isArray(S.places) || !S.places.length) {
      const legacy = await settingGet('customVenues', []);
      S.places = DEFAULT_PLACES.map(p => ({ id: uid('pl'), name: p.name, type: p.type }))
        .concat((Array.isArray(legacy) ? legacy : []).map(name => ({ id: uid('pl'), name, type: 'other' })));
      await settingSet('places', S.places);
    }
    S.places = S.places.filter(p => p && typeof p.name === 'string');
    if (!placeByName(S.venue) && S.places.length) S.venue = S.places[0].name;
    S.leftHanded = !!(await settingGet('leftHanded', false));
    S.nativeCamera = !!(await settingGet('nativeCamera', false));
    S.aiKey = String(await settingGet('aiKey', '') || '');
    S.projectName = String(await settingGet('projectName', '') || '');
    S.firstUse = await settingGet('firstUse', null);
    S.tripStart = await settingGet('tripStart', null);
    S.installHintHiddenAt = await settingGet('installHintHiddenAt', 0);

    // a session must never outlive its venue — clear any stale carry-over
    if (S.session.key && S.session.venue !== S.venue) {
      S.session = { key: '', venue: '' };
      await settingSet('session', S.session);
    }

    // records: a malformed row (a hand-edited backup, a truncated transfer)
    // is skipped and counted, never allowed to take the whole app down
    const rawCaps = await dbAll('captures');
    const caps = [];
    rawCaps.forEach(c => {
      if (!c || typeof c.id !== 'string' || !c.photos || !Array.isArray(c.photos.product)) return;
      if (typeof c.createdAt !== 'string') c.createdAt = typeof c.updatedAt === 'string' ? c.updatedAt : new Date(0).toISOString();
      if (!Array.isArray(c.rooms)) c.rooms = [];
      if (typeof c.category !== 'string') c.category = 'Other';
      if (typeof c.status !== 'string') c.status = 'Captured';
      caps.push(c);
    });
    S.skippedRecords = rawCaps.length - caps.length;
    S.captures = caps.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    S.companies = (await dbAll('companies')).filter(co => co && typeof co.key === 'string');
    S.compareIds = (await settingGet('compareIds', []) || []).filter(id => S.captures.some(c => c.id === id));
    S.lastBackupAt = await settingGet('lastBackupAt', null);

    // a booth session never outlives its day — the first capture next
    // morning must not file under last night's final booth
    if (S.session.key) {
      const sco = companyOf(S.session.key);
      const startedAt = S.session.at || (sco && sco.createdAt);
      if (!sco || (startedAt && dayKey(startedAt) !== dayKey())) {
        S.session = { key: '', venue: '' };
        await settingSet('session', S.session);
      }
    }

    // sweep unnamed companies left by abandoned capture flows (no records, not the live session)
    const usedKeys = new Set(S.captures.map(c => c.companyKey));
    const orphans = S.companies.filter(co => !co.name && !usedKeys.has(co.key) && co.key !== S.session.key);
    for (const co of orphans) await dbRemove('companies', co.key);
    if (orphans.length) S.companies = S.companies.filter(co => orphans.indexOf(co) === -1);

    // an unfinished capture survives a reload: offer to resume it
    const savedDraft = await settingGet('draft', null);
    if (savedDraft && draftPhotoCount(savedDraft)) {
      const { venue, savedAt, ...rest } = savedDraft;
      const meta = (await settingGet('draftMeta', null)) || {};
      const merged = { ...freshDraft(), ...rest, ...meta };
      if (!Array.isArray(merged.product)) merged.product = [];
      if (!Array.isArray(merged.rooms)) merged.rooms = [];
      S.draft = { ...merged, rec: merged.voice ? 'done' : 'idle', recSec: merged.voice ? merged.voice.duration : 0 };
      S.draftResume = true;
    } else if (savedDraft) {
      clearDraftStore();
    }
  } catch (err) {
    S.ready = false;
    bootError(err);
    return;
  }

  S.ready = true;
  renderAll();
  if (S.skippedRecords) Fx.toast(S.skippedRecords + (S.skippedRecords === 1 ? ' stored record' : ' stored records') + ' could not be read and ' + (S.skippedRecords === 1 ? 'was' : 'were') + ' skipped.', { sticky: true });
  registerSW();
  requestPersistence();
  refreshStorageInfo();
}

async function init() {
  bindGlobalListeners();
  await bootData();
}

/* Service worker: install, then keep the heavy offline OCR assets warm and
   tell the user when a new version has taken over. */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type === 'heavy-status') {
      const was = S.ocrReady;
      S.ocrReady = !!d.ready;
      S.ocrMissing = d.missing || [];
      if (S.settingsOn) render();
      if (!was && S.ocrReady && d.justFinished) Fx.toast('Offline card and label reading is ready on this phone.');
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install, not an update
    S.updateReady = true;
    if (S.view === 'home' && !S.camera && !draftPhotoCount()) {
      Fx.toast('Milana was updated — refreshing…', { ms: 1500 });
      setTimeout(() => location.reload(), 900);
    } else {
      Fx.toast('Milana was updated — it will refresh when you return to Today.', { ms: 4000 });
    }
  });
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  navigator.serviceWorker.ready.then(reg => healOfflineAssets(reg)).catch(() => {});
}

/* The heavy OCR assets are cached by the worker itself, after install, so a
   flaky first load never blocks the app. The page just asks the worker to
   fill anything missing and to report where things stand. */
function healOfflineAssets(reg) {
  const sw = (reg && reg.active) || navigator.serviceWorker.controller;
  if (!sw) return;
  try { sw.postMessage({ type: 'warm-heavy', online: navigator.onLine }); } catch (e) { /* worker gone */ }
}

init();
