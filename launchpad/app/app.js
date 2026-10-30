/* Launchpad 300·30·3 — app (vanilla JS, no framework) */
(function () {
  'use strict';
  const P = window.PACE;
  const CONTENT = () => window.LAUNCHPAD_CONTENT || { weeks: [], scripts: [], templates: [], rolePlays: [] };
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const num = v => Number(v) || 0;
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const todayStr = () => P.fmtDate(P.today());
  const APP_URL_DEFAULT = 'https://claude.ai/artifact/P2Z9UCWbcymej8pVr1FFZi';
  const GROUP_LABEL = { cold: 'Cold', warm: 'Warm', hot: 'Hot' };
  const groupLabel = g => GROUP_LABEL[g] || '';
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const niceDate = s => { const d = P.parseDate(s); return d ? DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] : ''; };
  const longDate = s => { const d = P.parseDate(s); return d ? DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() : ''; };
  const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'there';
  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || '?';
  const tone = band => (P.BAND_COPY[band] || {}).tone || 'muted';
  const bandLabel = band => (P.BAND_COPY[band] || {}).label || band;
  const daysAgo = s => { if (!s) return null; return Math.round((P.today() - P.parseDate(s)) / 86400000); };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };

  function md(text) {
    const lines = String(text || '').split('\n'); let html = ''; let inList = false; let para = [];
    const flush = () => { if (para.length) { html += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (const raw of lines) {
      const l = raw.replace(/\s+$/, '');
      if (!l.trim()) { flush(); closeList(); continue; }
      if (l.startsWith('## ')) { flush(); closeList(); html += '<h4>' + inline(l.slice(3)) + '</h4>'; continue; }
      if (l.startsWith('- ')) { flush(); if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(l.slice(2)) + '</li>'; continue; }
      if (l.startsWith('> ')) { flush(); closeList(); html += '<blockquote>' + inline(l.slice(2)) + '</blockquote>'; continue; }
      if (inList) closeList();
      para.push(l);
    }
    flush(); closeList(); return html;
  }

  const ICONS = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4M8 14h4"/></svg>',
    progress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16M8 15l4-5 3 3 5-7"/></svg>',
    learn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2zM11 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/></svg>',
    practice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>',
    scripts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6"/></svg>',
    team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3"/></svg>',
    me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
    flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-5 6-5 12 0 4 3 7 8 7z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  };

  // ---------- State ----------
  const S = {
    caps: { db: null, user: null, sample: null, downloads: null, ready: false, signedOut: false },
    me: { id: null, name: '', email: '', isOwner: false, canEdit: false, canWrite: null },
    config: { officeName: 'Ray White Mildura', programName: 'Launchpad', targets: { geo: 300, appraisals: 30, listings: 3 }, weeks: 12, workDays: [1, 2, 3, 4, 5], managerEmails: [], nudgeHour: 18, timezone: 'Australia/Melbourne' },
    configLoaded: false, person: null, personLoaded: false, days: [], pipeline: [], learning: null,
    roster: [], rosterLoaded: false, board: [], boardSub: false, boardUnsub: null, weeksDocs: {}, weeksLoaded: false, weeksError: false, focusRev: 0, focusDirty: false, teamCache: {}, teamLoading: {}, saveFailed: false, busy: 0, daysLoaded: false, daysError: false, learnDirty: false, learnRev: 0, logPinned: false,
    view: 'today', logDate: todayStr(), draft: null, dirty: false, saving: null, saveTimer: null, learnTimer: null,
    ui: { learnWeek: null, quiz: null, practice: null, teamPerson: null, scriptsTab: 'scripts', scriptsQuery: '', scriptsCat: 'all', openScript: null, teamFilter: 'active', confetti: null, handling: {} },
    unsubs: [],
  };
  const VIEWS = ['today', 'progress', 'learn', 'practice', 'scripts', 'team', 'me'];
  const NAV = [
    { id: 'today', label: 'Today', icon: 'today' }, { id: 'progress', label: 'Progress', icon: 'progress' },
    { id: 'learn', label: 'Learn', icon: 'learn' }, { id: 'practice', label: 'Practice', icon: 'practice' },
    { id: 'scripts', label: 'Scripts', icon: 'scripts' }, { id: 'team', label: 'Team', icon: 'team', managers: true }, { id: 'me', label: 'Profile', icon: 'me' },
  ];
  const managerIds = () => (Array.isArray(S.config.managerIds) ? S.config.managerIds : []);
  const lc = e => String(e || '').trim().toLowerCase();
  // managerEmailById records the address put on the Monday report list for each manager, so it can be taken off again
  // even if their profile email changed in between.
  const emailMap = () => (isObj(S.config.managerEmailById) ? Object.assign({}, S.config.managerEmailById) : {});
  // Addresses still used by someone who stays on the manager list: their profile email and the one recorded for them.
  function keptManagerEmails(ids, by) {
    const out = new Set();
    for (const id of ids) { const p = id === S.me.id ? S.person : S.roster.find(x => x.id === id); if (p && p.role === 'manager') out.add(lc(p.email)); out.add(lc(by[id])); }
    out.delete(''); return out;
  }
  const isManager = () => !!(S.me.canEdit && S.person && S.person.role === 'manager' && (S.me.isOwner || managerIds().includes(S.me.id)));
  const isPending = () => !!(S.person && (S.person.role === 'manager-pending' || (S.person.role === 'manager' && !isManager())));
  const boardOn = () => S.config.teamBoard !== false;
  // Status 'left': out of the program. Today and Progress show a short read-only card instead of the daily sheet.
  const isLeft = () => !!(S.person && S.person.status === 'left' && !isManager() && !isPending());
  // Only associates in the program (active, or graduated and still logging) get the live Team pulse.
  const boardEligible = () => !!(S.person && !isManager() && !isPending() && ['active', 'graduated'].includes(S.person.status || 'active'));
  const emptyDay = date => ({ date, geo: 0, appraisals: 0, listings: 0, calls: 0, connections: 0, appointments: 0, sessions: 0, note: '', closed: false, updatedAt: null });
  const snapFor = (person, days, on) => P.snapshot(person, S.config, days, on || todayStr());
  const mySnap = () => (S.person && !isManager() ? snapFor(S.person, daysWithDraft()) : null);
  function daysWithDraft() { if (!S.draft || (!S.dirty && !S.draft.updatedAt)) return S.days; const rest = S.days.filter(d => d.date !== S.draft.date); return rest.concat([S.draft]); }
  function defaultLearning() { return { lessonsRead: {}, drillsDone: {}, quiz: {}, practice: { count: 0, scores: [] }, updatedAt: null }; }
  function normLearning(data) { const L = Object.assign(defaultLearning(), isObj(data) ? clone(data) : {}); for (const k of ['lessonsRead', 'drillsDone', 'quiz']) if (!isObj(L[k])) L[k] = {}; if (!isObj(L.practice)) L.practice = { count: 0, scores: [] }; if (!Array.isArray(L.practice.scores)) L.practice.scores = []; return L; }
  function announce(msg) { const l = $('#live'); if (!l) return; l.textContent = ''; setTimeout(() => { l.textContent = msg; }, 50); }

  // ---------- Toast / sheet / confetti ----------
  let toastTimer = null;
  function toast(msg, ms) {
    let t = $('#toast-el'); if (!t) { t = document.createElement('div'); t.id = 'toast-el'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }
  function sheet(html, opts) {
    const root = $('#sheet-root');
    S.ui.sheetOpener = document.activeElement;
    root.innerHTML = '<div class="backdrop" data-close="1"><div class="sheet fade" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="handle"></div>' + html + '</div></div>';
    const bd = $('.backdrop', root); const sh = $('.sheet', root);
    const h = $('h1,h2,h3', sh); if (h) h.id = 'sheet-title'; else sh.removeAttribute('aria-labelledby');
    bd.addEventListener('click', e => { if (e.target === bd && !(opts && opts.sticky)) closeSheet(); });
    sh.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const f = $$('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])', sh).filter(x => !x.disabled && !x.hidden);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      // The sheet itself counts as the start of the cycle (noFocus sheets open with the container focused).
      if (e.shiftKey && (document.activeElement === first || document.activeElement === sh)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.body.style.overflow = 'hidden';
    if (opts && opts.onOpen) opts.onOpen(root);
    // noFocus: move focus to the dialog itself (screen readers land inside) without opening the phone keyboard over the actions.
    if (opts && opts.noFocus) { sh.setAttribute('tabindex', '-1'); setTimeout(() => { try { sh.focus({ preventScroll: true }); } catch (e) { } }, 50); }
    else { const f = $('input,textarea,button', sh); if (f) setTimeout(() => f.focus(), 50); }
  }
  function closeSheet() {
    const root = $('#sheet-root'); if (!root.innerHTML) return;
    root.innerHTML = ''; document.body.style.overflow = '';
    const o = S.ui.sheetOpener; S.ui.sheetOpener = null;
    if (o && o.focus && document.contains(o)) { try { o.focus({ preventScroll: true }); } catch (e) { } }
  }
  function confetti() {
    const c = $('#confetti'); if (!c || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = c.getContext('2d'); c.hidden = false; c.width = innerWidth; c.height = innerHeight;
    const colors = ['#ffd500', '#17181c', '#1f7a45', '#24579c', '#ffffff'];
    const parts = Array.from({ length: 140 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * .5, vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 4, r: 4 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - .5) * .3, col: colors[Math.floor(Math.random() * colors.length)] }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of parts) { p.x += p.vx; p.y += p.vy; p.rot += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); ctx.restore(); }
      if (t - t0 < 2600) requestAnimationFrame(frame); else { ctx.clearRect(0, 0, c.width, c.height); c.hidden = true; }
    })(t0);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Select and copy the text'); } ta.remove(); }
  }

  // ---------- DB helpers ----------
  const db = () => S.caps.db;
  const myRef = () => db().doc('people/' + S.me.id);
  const dayRef = (pid, date) => db().doc('people/' + pid + '/days/' + date);
  const learnRef = pid => db().doc('people/' + pid + '/learning/progress');
  const weekRef = (pid, key) => db().doc('people/' + pid + '/weeks/' + key);
  const boardRef = pid => db().doc('board/' + pid);
  const coachRef = pid => db().doc('coaching/' + pid);
  const VIEW_ONLY_ASK = 'Ask Damian to share it with you as Contributor if you are on the office Claude plan, or as Editor if you use your own Claude account.';
  const VIEW_ONLY_MSG = 'This page is view-only for you. ' + VIEW_ONLY_ASK;
  function writeFail(e) {
    console.error(e);
    const code = e && e.code;
    if (code === 'invalid_argument') toast(VIEW_ONLY_MSG, 7000);
    else if (code === 'quota_exceeded') toast('Storage is full. Tell your manager.', 5000);
    else toast('Could not save right now. Try again in a moment.', 4000);
  }
  function chain(fn) {
    const run = async () => { S.busy++; try { return await fn(); } finally { S.busy--; } };
    S.saving = (S.busy ? S.saving.then(run, run) : run()).catch(writeFail); return S.saving;
  }

  // ---------- Boot ----------
  async function boot() {
    bindGlobal();
    window.addEventListener('hashchange', route);
    const hash = (location.hash || '').replace('#', ''); if (VIEWS.includes(hash)) S.view = hash;
    const [dbc, userc, samplec, dlc] = await Promise.all([window.claude.use('db'), window.claude.use('user'), window.claude.use('sample'), window.claude.use('downloads')]);
    S.caps.db = dbc; S.caps.user = userc; S.caps.sample = samplec; S.caps.downloads = dlc;
    if (!dbc || !userc) { S.caps.signedOut = true; S.caps.ready = true; render(); return; }
    const me = await userc.me(); S.me = { id: me.id, name: me.name || '', email: me.email || '', isOwner: !!me.isOwner, canEdit: !!me.canEdit, canWrite: null };
    try { S.me.canWrite = await userc.can('data.write'); } catch (e) { S.me.canWrite = null; }
    if (!me.id) { S.caps.signedOut = true; S.caps.ready = true; render(); return; }
    try { const c = await db().doc('config/program').get(); if (c.exists) Object.assign(S.config, c.data()); } catch (e) { console.warn('config', e); }
    S.configLoaded = true;
    S.unsubs.push(db().doc('config/program').onSnapshot(snap => { if (snap.exists) { Object.assign(S.config, snap.data()); if (isManager()) subscribeRoster(); syncBoardSub(); render(); } }, e => console.warn(e)));
    S.unsubs.push(myRef().onSnapshot(snap => {
      S.person = snap.exists ? snap.data() : null; S.personLoaded = true; S.caps.ready = true;
      if (S.person && !S.unsubs.personal) subscribePersonal();
      if (isManager()) subscribeRoster();
      syncBoardSub();
      noteDecline();
      render();
      maybeWelcome();
    }, e => { console.error(e); S.personLoaded = true; S.caps.ready = true; render(); }));
  }
  function subscribePersonal() {
    S.unsubs.personal = true;
    S.unsubs.push(db().collection('people/' + S.me.id + '/days').onSnapshot(qs => {
      S.days = qs.docs.map(d => d.data()).filter(d => d && d.date);
      S.daysLoaded = true; S.daysError = false;
      if (!S.dirty) S.draft = Object.assign(emptyDay(S.logDate), S.days.find(d => d.date === S.logDate) || {});
      render();
    }, e => { console.error(e); S.daysError = true; render(); }));
    S.unsubs.push(db().collection('people/' + S.me.id + '/pipeline').onSnapshot(qs => { S.pipeline = qs.docs.map(d => Object.assign({}, d.data(), { id: d.id })); render(); }, e => console.error(e)));
    S.unsubs.push(db().collection('people/' + S.me.id + '/weeks').onSnapshot(qs => { S.weeksLoaded = true; S.weeksError = false; if (S.focusDirty) return; const m = {}; for (const d of qs.docs) m[d.id] = d.data(); S.weeksDocs = m; render(); }, e => { console.error(e); S.weeksError = true; render(); }));
    S.unsubs.push(learnRef(S.me.id).onSnapshot(snap => { if (S.learnDirty) return; S.learning = snap.exists ? normLearning(snap.data()) : defaultLearning(); render(); }, e => console.error(e)));
    if (isManager()) subscribeRoster();
  }
  function subscribeBoard() {
    if (S.boardSub || !boardOn()) return; S.boardSub = true;
    S.boardUnsub = db().collection('board').onSnapshot(qs => { if (!S.boardSub) return; S.board = qs.docs.map(d => Object.assign({}, isObj(d.data()) ? d.data() : {}, { id: d.id })); render(); }, e => { console.warn('board', e); });
  }
  function unsubscribeBoard() {
    if (!S.boardSub) return; S.boardSub = false; S.board = [];
    const u = S.boardUnsub; S.boardUnsub = null; if (typeof u === 'function') { try { u(); } catch (e) { } }
  }
  // Called from the config and person snapshots: subscribe when the pulse is on and this person qualifies, otherwise stop listening.
  function syncBoardSub() { if (boardOn() && boardEligible()) subscribeBoard(); else unsubscribeBoard(); }
  // A declined manager request is mentioned once (per browser) on the 'not in the program' card.
  function noteDecline() {
    const at = S.person && S.person.declinedAt; if (!at || !isLeft() || S.ui.declineChecked === at) return;
    S.ui.declineChecked = at; const k = 'lp.declineSeen.' + S.me.id;
    if (ls.get(k) !== at) { S.ui.declineNotice = at; ls.set(k, at); }
  }
  // Owner only, from the roster snapshot: make sure the owner is in managerIds (first run also adopts existing role:'manager' rows),
  // and drop any managerIds entry, and its emails, whose roster role is no longer 'manager' (never the owner).
  // It also catches up the report list for a manager whose profile email no longer matches the address recorded for them
  // (changed while they could not write config, for example still shared as Contributor after being made a manager).
  // Whether to adopt is decided when the job is queued (or by the owner's own onboarding, which creates managerIds);
  // the patch itself is built inside the chained function, so it starts from the S.config left by any earlier queued write.
  function staleManagers() { const ids = managerIds(); return S.roster.filter(p => p.id !== S.me.id && p.role !== 'manager' && ids.includes(p.id)); }
  const managerRow = id => (id === S.me.id ? S.person : S.roster.find(x => x.id === id));
  function driftedManagers(ids, by) { return ids.filter(id => { const p = managerRow(id); return p && p.role === 'manager' && lc(p.email) && lc(p.email) !== lc(by[id]); }); }
  function syncManagerConfig(fromCache) {
    if (!S.me.isOwner || !S.rosterLoaded) return;
    if (!Array.isArray(S.config.managerIds)) S.ui.adoptManagers = true;
    const needAdopt = !!S.ui.adoptManagers && S.roster.some(p => p.role === 'manager' && p.id !== S.me.id && !managerIds().includes(p.id));
    const needSeed = !S.ui.managerIdsSeeded && !managerIds().includes(S.me.id);
    const needPrune = !fromCache && staleManagers().length > 0; // a cached roster can be stale, so it never prunes
    const needEmails = !fromCache && driftedManagers(managerIds(), emailMap()).length > 0;
    if ((!needSeed && !needPrune && !needAdopt && !needEmails) || S.ui.managerSyncQueued) return;
    if (needSeed) S.ui.managerIdsSeeded = true;
    S.ui.managerSyncQueued = true;
    chain(async () => {
      S.ui.managerSyncQueued = false;
      const ids = new Set(managerIds()); let changed = false;
      if (!ids.has(S.me.id)) { ids.add(S.me.id); changed = true; }
      if (S.ui.adoptManagers) { S.ui.adoptManagers = false; S.roster.filter(p => p.role === 'manager' && !ids.has(p.id)).forEach(p => { ids.add(p.id); changed = true; }); }
      const gone = fromCache ? [] : S.roster.filter(p => p.id !== S.me.id && p.role !== 'manager' && ids.has(p.id));
      gone.forEach(p => ids.delete(p.id));
      const by = emailMap(); const drop = new Set(); const add = [];
      // Worked out again here, against the config left by any queued write (a profile save queues its own config write).
      const moved = fromCache ? [] : driftedManagers(Array.from(ids), by);
      if (!changed && !gone.length && !moved.length) return;
      for (const p of gone) { [p.email, by[p.id]].forEach(e => { if (lc(e)) drop.add(lc(e)); }); delete by[p.id]; }
      for (const id of moved) { if (lc(by[id])) drop.add(lc(by[id])); by[id] = managerRow(id).email; add.push(by[id]); }
      for (const e of keptManagerEmails(ids, by)) drop.delete(e);
      const emails = (S.config.managerEmails || []).filter(x => !drop.has(lc(x)));
      for (const e of add) if (!emails.some(x => lc(x) === lc(e))) emails.push(e);
      const cfg = Object.assign({}, S.config, { managerIds: Array.from(ids), managerEmails: emails, managerEmailById: by, updatedAt: new Date().toISOString() });
      await db().doc('config/program').set(cfg); S.config = cfg;
    });
  }
  function subscribeRoster() {
    if (S.unsubs.roster) return; S.unsubs.roster = true;
    S.unsubs.push(db().collection('people').onSnapshot(qs => { S.roster = qs.docs.map(d => Object.assign({}, isObj(d.data()) ? d.data() : {}, { id: d.id })); S.rosterLoaded = true; syncManagerConfig(!!(qs.metadata && qs.metadata.fromCache)); render(); }, e => console.error(e)));
  }
  function route() {
    const h = (location.hash || '').replace('#', '');
    const v = VIEWS.includes(h) ? h : 'today';
    if (v === 'team' && !isManager()) { S.view = 'today'; } else S.view = v;
    if (S.view !== 'practice' && S.ui.practice && S.ui.practice.ctl) { try { S.ui.practice.ctl.abort(); } catch (e) { } }
    render(); window.scrollTo(0, 0);
    const hd = $('#view h1, #view h2'); if (hd) announce(hd.textContent);
  }
  function go(v) { if (location.hash !== '#' + v) location.hash = '#' + v; else route(); }

  // ---------- Render ----------
  function focusKey(a) {
    if (!a || a === document.body || !a.closest('#view,#railnav,#tabbar')) return null;
    if (a.id) return '#' + CSS.escape(a.id);
    const attrs = Array.from(a.attributes).filter(x => x.name.startsWith('data-')).map(x => '[' + x.name + '="' + CSS.escape(x.value) + '"]').join('');
    return attrs ? a.tagName.toLowerCase() + attrs : null;
  }
  function render() {
    if (isManager() && (S.view === 'today' || S.view === 'progress')) S.view = 'team';
    renderNav();
    const el = $('#view'); if (!el) return;
    // Keep unsaved field edits, focus and caret across the innerHTML swap (listeners can re-render at any time).
    const act = document.activeElement; const key = focusKey(act);
    const sel = key && act && typeof act.selectionStart === 'number' ? [act.selectionStart, act.selectionEnd] : null;
    const keep = {};
    for (const f of $$('input[id],textarea[id],select[id]', el)) {
      const dirty = f.tagName === 'SELECT' ? !Array.from(f.options).some(o => o.selected && o.defaultSelected) : (f.type === 'checkbox' ? f.checked !== f.defaultChecked : f.value !== f.defaultValue);
      if (dirty) keep[f.id] = f.type === 'checkbox' ? f.checked : f.value;
    }
    let html;
    if (!S.caps.ready) html = loadingHtml();
    else if (S.caps.signedOut) html = signedOutHtml();
    else if (!S.person) html = (S.me.canWrite === false || S.ui.viewOnly) ? viewOnlyHtml() : onboardingHtml();
    else {
      const home = () => isPending() ? pendingHtml() : isLeft() ? leftHtml() : todayHtml();
      switch (S.view) {
        case 'today': html = isManager() ? managerHomeHtml() : home(); break;
        case 'progress': html = isManager() ? managerHomeHtml() : isPending() ? pendingHtml() : isLeft() ? leftHtml() : progressHtml(); break;
        case 'learn': html = learnHtml(); break;
        case 'practice': html = practiceHtml(); break;
        case 'scripts': html = scriptsHtml(); break;
        case 'team': html = isManager() ? teamHtml() : home(); break;
        case 'me': html = meHtml(); break;
        default: html = isManager() ? managerHomeHtml() : home();
      }
    }
    el.innerHTML = html;
    for (const id of Object.keys(keep)) { const f = document.getElementById(id); if (f) { if (f.type === 'checkbox') f.checked = keep[id]; else f.value = keep[id]; } }
    if (key) { const f = $(key); if (f && f !== document.activeElement) { try { f.focus({ preventScroll: true }); if (sel && typeof f.setSelectionRange === 'function' && (f.tagName === 'TEXTAREA' || /^(text|search|url|tel|password)$/.test(f.type))) f.setSelectionRange(sel[0], sel[1]); } catch (e) { } } }
    // One-shot focus target for a view that replaced (or disabled) the control just pressed, such as the quiz; used only when
    // focus was lost, and scrolled into view so the next step is on screen.
    const want = S.ui.focusAfter; S.ui.focusAfter = null;
    if (want && (!document.activeElement || document.activeElement === document.body)) { const f = $(want); if (f) { try { f.focus({ preventScroll: true }); f.scrollIntoView({ block: 'nearest' }); } catch (e) { } } }
    afterRender();
  }
  function renderNav() {
    const items = NAV.filter(n => !n.managers || isManager());
    const mobile = isManager()
      ? [NAV[5], NAV[2], NAV[3], NAV[4], { id: 'more', label: 'More', icon: 'more' }]
      : [NAV[0], NAV[1], NAV[2], NAV[3], { id: 'more', label: 'More', icon: 'more' }];
    const tb = $('#tabbar'); if (tb) tb.innerHTML = mobile.map(n => '<button data-nav="' + n.id + '" ' + (S.view === n.id ? 'aria-current="page"' : '') + '>' + ICONS[n.icon] + '<span>' + n.label + '</span></button>').join('');
    const rail = $('#railnav'); if (rail) rail.innerHTML = items.filter(n => !(isManager() && (n.id === 'today' || n.id === 'progress'))).map(n => '<button data-nav="' + n.id + '" ' + (S.view === n.id ? 'aria-current="page"' : '') + '>' + ICONS[n.icon] + '<span>' + n.label + '</span></button>').join('');
    const foot = $('#railfoot'); if (foot) foot.textContent = S.person ? (S.person.name + ' · ' + (isManager() ? 'Manager' : 'Associate')) : S.config.officeName;
  }
  function pendingHtml() {
    const learn = '<p class="small muted">In the meantime, Learn, Practice and Scripts are open to you.</p>';
    // Approved (in managerIds) but shared as Contributor: approval is done, only the sharing is missing. No cancel here:
    // a Contributor cannot write config, so cancelling would leave them on the Monday report list.
    if (S.person.role === 'manager' && managerIds().includes(S.me.id) && !S.me.canEdit) {
      return '<div class="card"><p class="eyebrow">Manager access</p><h1>One more step</h1><p>Damian has made you a manager, but this page is shared with you as Contributor. Ask him to change your sharing to Editor, then reload.</p>' + learn + '<div class="row"><button class="btn" data-nav="learn">Open Learn</button></div></div>';
    }
    return '<div class="card"><p class="eyebrow">Manager access</p><h1>Waiting for approval</h1><p>You asked for manager access. Damian approves manager requests from the Team page. Once he does, this page turns into the team view.</p>' +
      (S.me.canEdit ? '' : '<p class="small">Manager access also needs this page shared with you as Editor. Ask Damian to change your sharing.</p>') + learn +
      '<div class="row"><button class="btn" data-nav="learn">Open Learn</button>' + (S.person.role === 'manager-pending' ? '<button class="btn ghost" data-act="cancel-request">I\'m actually doing the program</button>' : '') + '</div></div>';
  }
  function leftHtml() {
    const declined = S.ui.declineNotice && S.person.declinedAt === S.ui.declineNotice;
    return '<div class="card"><p class="eyebrow">' + esc(S.config.officeName) + '</p><h1>' + (declined ? 'Your manager request was declined' : 'Not in the program right now') + '</h1><p>You\'re not in the Launchpad program right now. Learn and Scripts stay open. If you should be in it, ask Damian to set you active.</p><div class="row"><button class="btn" data-nav="learn">Open Learn</button><button class="btn ghost" data-nav="scripts">Open Scripts</button></div></div>';
  }
  function viewOnlyHtml() {
    return '<div class="card"><div class="brand"><div class="mark">3</div><div><div class="name">Launchpad</div><div class="sub">' + esc(S.config.officeName) + '</div></div></div><h1>This page is view-only for you</h1><p>' + VIEW_ONLY_ASK + '</p><p class="small muted">Once your sharing is changed, reload this page to set up your 90 days.</p></div>';
  }
  function loadingHtml() { return '<div class="card"><h1>Signing you in</h1><p class="muted">One moment.</p></div>'; }
  function signedOutHtml() {
    return '<div class="card"><div class="brand"><div class="mark">3</div><div><div class="name">Launchpad</div><div class="sub">300 geo data · 30 appraisals · 3 listings</div></div></div>' +
      '<h1>Sign in to open your Launchpad</h1><p>This page keeps your daily numbers and your progress, so it needs to know who you are. Open the link while signed in to claude.ai with the account Damian invited. If you have not been invited yet, ask Damian or Luke to share the Launchpad link with you.</p>' +
      '<p class="muted small">Already signed in and still seeing this? Refresh the page once. If it persists, the link may have been shared as view-only.</p></div>';
  }

  // ---------- Onboarding ----------
  function onboardingHtml() {
    const canManage = S.me.canEdit; const owner = S.me.isOwner;
    return '<div class="card"><div class="brand"><div class="mark">3</div><div><div class="name">Launchpad</div><div class="sub">' + esc(S.config.officeName) + '</div></div></div>' +
      '<h1>Welcome. Let\'s set up your 90 days.</h1>' +
      '<p>Three numbers, twelve weeks: <strong>300 geo data</strong>, <strong>30 appraisals</strong>, <strong>3 listings</strong>. You log your day in under a minute, the app shows you the pace from here, and your managers see the same picture.</p>' +
      '<form id="onb" class="stack">' +
      (canManage ? '<div class="chips" role="radiogroup" aria-label="Your role"><button type="button" class="chip" data-role="manager" aria-pressed="' + owner + '">' + (owner ? 'I\'m a manager' : 'I\'m a manager (Damian approves)') + '</button><button type="button" class="chip" data-role="associate" aria-pressed="' + !owner + '">I\'m doing the program</button></div>' : '') +
      '<label class="f">Your name<input id="onb-name" required value="' + esc(S.me.name) + '" placeholder="First and last name"></label>' +
      '<label class="f">Email for reminders and reports<input id="onb-email" type="email" value="' + esc(S.me.email) + '" placeholder="you@raywhite.com"></label>' +
      '<div id="onb-assoc" class="stack"' + (canManage && owner ? ' hidden' : '') + '>' +
      '<label class="f">Program start date<input id="onb-start" type="date" value="' + todayStr() + '" required></label>' +
      '<label class="f">Your farm area (suburb or streets)<input id="onb-farm" placeholder="e.g. Mildura South, Deakin Ave to Fifteenth St"></label>' +
      '<p class="small muted">Your 60 working days run Monday to Friday from the start date. Weekend work still counts; log it on the day.</p></div>' +
      '<button class="btn primary big block" type="submit">Start</button></form></div>';
  }
  async function submitOnboarding(form) {
    const picked = (S.me.canEdit && ($('.chip[aria-pressed="true"]', form) || {}).dataset || {}).role || 'associate';
    const role = picked === 'manager' ? (S.me.isOwner ? 'manager' : 'manager-pending') : 'associate';
    const name = $('#onb-name').value.trim(); if (!name) { toast('Enter your name'); return; }
    const email = $('#onb-email').value.trim();
    const startDate = role === 'associate' ? $('#onb-start').value : todayStr();
    if (role === 'associate' && !P.parseDate(startDate)) { toast('Pick a start date'); return; }
    const doc = { id: S.me.id, name, email, role, startDate, farm: role === 'associate' ? $('#onb-farm').value.trim() : '', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastLogDate: null, summary: null };
    const btn = $('button[type=submit]', form); btn.disabled = true;
    // One chain() for every onboarding write, so the owner's config seed queues behind the create.
    // The welcome waits for the confirmed create: the runtime echoes the pending doc at once, and a refused create rolls it back.
    // The owner's first run (no managerIds yet) also adopts existing role:'manager' rows once the roster is in.
    if (role === 'manager' && !Array.isArray(S.config.managerIds)) S.ui.adoptManagers = true;
    let err = null; S.ui.onboarding = true;
    const ok = await chain(async () => {
      try { await myRef().set(doc); await learnRef(S.me.id).set(defaultLearning()); if (role === 'manager') await addManager(S.me.id, email); return true; }
      catch (e) { err = e; throw e; }
    });
    S.ui.onboarding = false;
    if (ok) { if (role !== 'associate') toast(role === 'manager-pending' ? 'Request sent to Damian' : 'Welcome aboard'); maybeWelcome(); return; }
    btn.disabled = false;
    if (err && err.code === 'invalid_argument' && S.me.canWrite == null) { S.ui.viewOnly = true; render(); }
  }

  // ---------- Today ----------
  function todayHtml() {
    const snap = mySnap(); const d = S.draft || emptyDay(S.logDate); const first = firstName(S.person.name);
    const parts = [];
    if (snap.status === 'upcoming') {
      const daysTo = Math.round((P.parseDate(snap.cal.start) - P.today()) / 86400000);
      parts.push('<div class="hero"><p class="eyebrow">' + esc(S.config.officeName) + '</p><h1>G\'day ' + esc(first) + '. ' + daysTo + ' day' + (daysTo === 1 ? '' : 's') + ' until kick-off.</h1><p class="sub">Your program starts ' + longDate(snap.cal.start) + '. Use the time to read Week 1 and run the first role-play.</p></div>');
      parts.push(learnTeaser(1)); parts.push(practiceTeaser(1));
      return parts.join('');
    }
    const headline = snap.status === 'finished' ? 'Program complete.' : 'Week ' + snap.week + ' · Day ' + snap.idx + ' of ' + snap.total;
    parts.push('<div class="hero"><p class="eyebrow">' + esc(S.config.officeName) + ' · ' + esc(longDate(todayStr())) + '</p><h1>G\'day ' + esc(first) + '.</h1><div class="row"><span class="pill accent">' + headline + '</span>' + (snap.streak ? '<span class="pill">' + ICONS.flame + ' ' + snap.streak + ' day streak</span>' : '') + ' ' + bandPill(snap.overall) + '</div></div>');
    if (snap.status === 'finished') parts.push(graduationCard(snap));
    // yesterday not logged
    const prevDate = prevWorkDate(snap);
    if (prevDate && !S.days.find(x => x.date === prevDate) && S.logDate === todayStr() && snap.status === 'active') parts.push('<div class="card warn"><div class="row between"><div><strong>' + niceDate(prevDate) + ' was not logged.</strong><div class="small">Twenty seconds now keeps the picture honest.</div></div><button class="btn sm" data-logdate="' + prevDate + '">Log it</button></div></div>');
    // Log card
    const logging = S.logDate === todayStr() ? 'Today' : niceDate(S.logDate);
    const inProgram = S.logDate >= snap.cal.start && S.logDate <= snap.cal.end;
    if (!S.daysLoaded) parts.push('<div class="card"><p class="eyebrow">Daily sheet</p><h2>' + (S.daysError ? 'Could not load your sheet' : 'Loading your sheet') + '</h2><p class="small muted">' + (S.daysError ? 'Refresh the page to try again.' : 'Your numbers are on their way.') + '</p></div>');
    else parts.push('<div class="card"><div class="row between"><div><p class="eyebrow">Daily sheet</p><h2>' + esc(logging) + (S.logDate !== todayStr() ? ' <span class="muted small">(' + S.logDate + ')</span>' : '') + '</h2></div><button class="btn sm ghost" data-act="pick-date">Change day</button></div>' +
      (!inProgram ? '<div class="card warn" style="padding:10px 12px"><p class="small">Outside your ' + S.config.weeks + ' weeks: still counts toward the totals shown to you and your managers.</p></div>' : '') +
      '<div class="steppers">' + stepper('geo', 'Geo data', d.geo, 'new contact records', true) + stepper('appraisals', 'Appraisals', d.appraisals, 'curbside or walk-through') + stepper('listings', 'Listings', d.listings, 'signed and live') + '</div>' +
      '<details class="calls" ' + ((S.ui.callsOpen || d.calls || d.connections || d.appointments || d.sessions) ? 'open' : '') + '><summary class="row between no-wrap"><div><strong>Call sessions</strong><div class="small muted">Tap to add calls, connections and appointments</div></div><span class="muted" aria-hidden="true">›</span></summary><div class="mini-steppers" style="margin-top:10px">' +
      mini('sessions', '45-min sessions', d.sessions, 1) + mini('calls', 'Calls', d.calls, 5) + mini('connections', 'Connections', d.connections, 1) + mini('appointments', 'Appointments', d.appointments, 1) + '</div>' +
      '<p class="tiny muted" style="margin-top:8px">The benchmark per 45-minute session: 18 to 24 calls, 8 to 12 connections, 1 to 3 appointments.</p></details>' +
      '<label class="f">One line about today<textarea id="day-note" rows="2" placeholder="A win, a lesson, or what got in the way">' + esc(d.note || '') + '</textarea></label>' +
      '<button class="btn primary big block" data-act="done">' + (d.closed ? 'Update today' : 'Done for today') + '</button>' +
      '<p class="tiny muted" id="save-state">' + (S.saveFailed ? 'Not saved. Tap a number again to retry.' : S.dirty ? 'Saving…' : (d.updatedAt ? 'Saved ' + esc(new Date(d.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : 'Numbers save as you go.')) + '</p></div>');
    // pace strip
    const g = snap.metrics.geo, a = snap.metrics.appraisals, l = snap.metrics.listings;
    parts.push('<div class="card soft"><p class="eyebrow">Your pace from here</p><div class="bars">' + barRow('Geo data', g) + barRow('Appraisals', a) + barRow('Listings', l) + '</div>' +
      '<p class="small">' + esc(paceSentence(snap)) + '</p><button class="btn sm" data-nav="progress">See the full picture</button></div>');
    if (snap.status === 'active') parts.push(focusCard(snap));
    parts.push(pipelineDue());
    parts.push(learnTeaser(Math.min(Math.max(snap.week, 1), S.config.weeks)));
    parts.push(practiceTeaser(Math.min(Math.max(snap.week, 1), S.config.weeks)));
    if (boardOn() && boardEligible()) parts.push(pulseCard());
    return parts.join('');
  }
  // ---------- This week's three ----------
  // This week's three runs Monday to Sunday (the Monday meeting) and is stored under the date of its Monday, so changing a
  // start date never moves commitments to another week. Weeks count from the Monday of the first working day (a weekend start
  // rolls into its first Monday) to the Monday of the last working day, so every Monday of the program starts a new week; before
  // and after that the first or last week applies. Learn, the drill chips, unread lessons and checkpoints keep the program week.
  const mondayOf = d => P.addDays(d, -((d.getDay() + 6) % 7));
  function focusOf(cal) {
    const w = cal.workDates; const first = mondayOf(P.parseDate(w[0] || cal.start)); const last = mondayOf(P.parseDate(w[w.length - 1] || cal.end));
    const t = mondayOf(P.today()); const m = t < first ? first : (t > last ? last : t);
    return { week: Math.round((m - first) / 604800000) + 1, key: P.fmtDate(m) };
  }
  function focusDoc(f) { const d = S.weeksDocs[f.key]; return d && Array.isArray(d.items) ? d : { week: f.week, monday: f.key, items: [] }; }
  function focusCard(snap) {
    if (!S.weeksLoaded) return '<div class="card"><p class="eyebrow">This week\'s three</p><h3>' + (S.weeksError ? 'Could not load your week' : 'Loading your week') + '</h3><p class="small muted">' + (S.weeksError ? 'Refresh the page to try again.' : 'Your commitments are on their way.') + '</p></div>';
    const doc = focusDoc(focusOf(snap.cal)); const items = doc.items.slice(0, 3);
    const done = items.filter(x => x.done).length;
    const w = CONTENT().weeks.find(x => x.week === Math.max(1, Math.min(snap.week, snap.cal.weeks))); const taken = new Set(items.map(x => x.text));
    const ideas = (w ? w.drills.map(d => d.title) : []).filter(t => !taken.has(t)).slice(0, 5);
    const list = items.map((x, i) => '<div class="item static"><button class="row grow no-wrap focus-tick" data-focus-tick="' + i + '" aria-pressed="' + !!x.done + '"><span class="check ' + (x.done ? 'on' : '') + '">' + (x.done ? ICONS.check : '') + '</span><span class="t' + (x.done ? ' struck' : '') + '">' + esc(x.text) + '</span></button>' + (x.done ? '' : '<button class="btn sm ghost" aria-label="Remove: ' + esc(x.text) + '" data-focus-remove="' + i + '">✕</button>') + '</div>').join('');
    const adder = items.length < 3 ? ((ideas.length ? '<div class="chips">' + ideas.map(t => '<button class="chip" data-focus-add="' + esc(t) + '">+ ' + esc(t) + '</button>').join('') + '</div>' : '') + '<div class="composer" style="grid-template-columns:1fr auto"><label class="sr" for="focus-in">Add your own commitment</label><input id="focus-in" maxlength="120" placeholder="Or write your own"><button class="btn" data-act="focus-add-own">Add</button></div>') : '';
    return '<div class="card"><div class="row between"><div><p class="eyebrow">This week\'s three</p><h3>' + (items.length ? done + ' of ' + items.length + ' done' : 'Pick three things to get done this week') + '</h3></div>' + (items.length === 3 && done === 3 ? '<span class="pill good">All done</span>' : '') + '</div>' +
      (items.length ? '<div class="list">' + list + '</div>' : '<p class="small muted">Three commitments, in your words. Damian and Luke see them in the Monday meeting.</p>') + adder + '</div>';
  }
  function saveFocus(f, mutate) {
    // Never build a write from the empty fallback: set() replaces the week doc, so saving before the weeks snapshot lands would wipe it.
    if (!S.weeksLoaded) { toast(S.weeksError ? 'Could not load your week. Refresh the page to try again.' : 'One moment, loading your week'); return null; }
    if (!f) return null;
    const doc = clone(focusDoc(f)); doc.items = (doc.items || []).slice(0, 3); mutate(doc.items); doc.week = f.week; doc.monday = f.key; doc.updatedAt = new Date().toISOString();
    S.weeksDocs = Object.assign({}, S.weeksDocs, { [f.key]: doc }); render();
    const summary = { week: f.week, monday: f.key, total: doc.items.length, done: doc.items.filter(x => x.done).length, items: doc.items.map(x => (x.done ? '[done] ' : '') + x.text) };
    const rev = ++S.focusRev; S.focusDirty = true;
    chain(async () => { try { await weekRef(S.me.id, f.key).set(doc); await myRef().update({ focus: summary, updatedAt: new Date().toISOString() }); } finally { if (rev === S.focusRev) S.focusDirty = false; } });
    return doc;
  }
  function focusWeek() { const s = mySnap(); return s ? focusOf(s.cal) : null; }
  function focusAdd(text) {
    text = String(text || '').trim().slice(0, 120); if (!text) { toast('Write a commitment first'); return; }
    if (!saveFocus(focusWeek(), items => { if (items.length < 3 && !items.some(x => x.text === text)) items.push({ text, done: false }); })) return;
    const f = $('#focus-in'); if (f) f.value = '';
  }
  function focusTick(i) {
    const doc = saveFocus(focusWeek(), items => { if (items[i]) { items[i].done = !items[i].done; items[i].doneAt = items[i].done ? new Date().toISOString() : null; } });
    if (doc && doc.items.length === 3 && doc.items.every(x => x.done)) { confetti(); toast('All three done this week. That is how it\'s done.'); }
  }
  function focusRemove(i) { saveFocus(focusWeek(), items => { items.splice(i, 1); }); }
  // ---------- Team pulse ----------
  // The working day before today (board streaks are only rewritten on a save, so a stored streak is still live only if
  // the last log was today or on this day, which matches P.streak skipping an unlogged today).
  function prevWorkDay() {
    let d = P.addDays(P.today(), -1); const wd = S.config.workDays && S.config.workDays.length ? S.config.workDays : [1, 2, 3, 4, 5];
    for (let i = 0; i < 7 && !P.isWorkDay(d, wd); i++) d = P.addDays(d, -1);
    return P.fmtDate(d);
  }
  function pulseCard() {
    const ids = managerIds();
    const rows = S.board.filter(b => (b.status || 'active') === 'active' && b.name && !ids.includes(b.id)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (rows.length < 2) return '';
    const t = todayStr(); const prev = prevWorkDay(); const liveStreak = r => (r.lastLogDate && r.lastLogDate >= prev) ? num(r.streak) : 0;
    const sum = k => rows.reduce((s, r) => s + num((r.totals || {})[k]), 0); const tgt = k => rows.reduce((s, r) => s + num((r.targets || {})[k]), 0);
    const bar = (label, k) => { const a = sum(k), g = tgt(k) || 1; return '<div class="bar-row"><span><strong>' + label + '</strong></span><div class="bar-track"><div class="bar-fill info" style="width:' + Math.min(100, a / g * 100) + '%"></div></div><span class="num small"><strong>' + a + '</strong>/' + tgt(k) + '</span></div>'; };
    return '<div class="card"><p class="eyebrow">Team pulse</p><div class="bars">' + bar('Geo data', 'geo') + bar('Appraisals', 'appraisals') + bar('Listings', 'listings') + '</div><div class="list">' +
      rows.map(r => { const st = liveStreak(r); const pills = (st ? '<span class="pill">' + ICONS.flame + ' ' + st + '<span class="sr"> day streak</span></span>' : '') + (r.lastLogDate === t ? '<span class="pill good">Logged today</span>' : ''); return '<div class="item static pulse-row"><div class="row no-wrap"><div class="avatar">' + esc(initials(r.name)) + '</div><div class="grow"><div class="t">' + esc(r.name) + (r.id === S.me.id ? ' <span class="muted small">(you)</span>' : '') + '</div><div class="s num">' + num((r.totals || {}).geo) + ' geo · ' + num((r.totals || {}).appraisals) + ' appr · ' + num((r.totals || {}).listings) + ' listings</div></div></div>' + (pills ? '<div class="row pulse-pills">' + pills + '</div>' : '') + '</div>'; }).join('') +
      '</div><p class="tiny muted">Everyone in the program sees this card. Your notes, pipeline and quiz scores are not on it; managers and anyone shared as Editor can see those.</p></div>';
  }
  // ---------- Welcome ----------
  function maybeWelcome() {
    if (S.ui.onboarding || !S.person || S.person.welcomed || S.person.role !== 'associate' || (S.person.status || 'active') !== 'active' || isManager() || S.ui.welcomeShown || $('#sheet-root').innerHTML) return;
    S.ui.welcomeShown = true;
    chain(async () => { await myRef().update({ welcomed: true, updatedAt: new Date().toISOString() }); });
    sheet('<h2>Welcome to Launchpad</h2><div class="list">' +
      '<div class="item static"><div><div class="t">1. Log your day</div><div class="s">Tap + for every new contact, appraisal and listing. It saves as you go and takes under a minute.</div></div></div>' +
      '<div class="item static"><div><div class="t">2. Watch your pace</div><div class="s">The app works out what you need each day from here. If you fall behind, it shows you the way back.</div></div></div>' +
      '<div class="item static"><div><div class="t">3. Learn and practise</div><div class="s">A short lesson most days, a script for every call, and an AI partner to rehearse with before the real thing.</div></div></div>' +
      '<div class="item static"><div><div class="t">4. Pick this week\'s three</div><div class="s">Three commitments each week, ticked off as you go. Your managers see them on Monday.</div></div></div>' +
      '</div><p class="small muted">Tip: on your phone, add this page to your home screen so it opens like an app. In Safari tap Share, then Add to Home Screen.</p><button class="btn primary big block" data-close="1">Let\'s go</button>');
  }
  function prevWorkDate(snap) {
    const t = todayStr(); const todayIsWork = snap.cal.workDates[snap.idx - 1] === t;
    const i = todayIsWork ? snap.idx - 2 : snap.idx - 1;
    return i >= 0 ? snap.cal.workDates[i] : null;
  }
  function stepper(key, label, val, hint, primary) {
    return '<div class="stepper' + (primary ? ' primary' : '') + '"><div class="lab">' + label + '</div><div class="val num" data-val="' + key + '">' + (val || 0) + '</div><div class="ctr"><button type="button" aria-label="Remove one ' + label + '" data-step="' + key + '" data-n="-1">−</button><button type="button" class="plus" aria-label="Add one ' + label + '" data-step="' + key + '" data-n="1">+</button></div><div class="hint">' + hint + '</div></div>';
  }
  function mini(key, label, val, big) {
    return '<div class="mini"><div class="lab">' + label + '</div><div class="ctr"><button type="button" aria-label="Minus ' + label + '" data-step="' + key + '" data-n="-1">−</button><span class="val num" data-val="' + key + '">' + (val || 0) + '</span><button type="button" aria-label="Add ' + label + '" data-step="' + key + '" data-n="1">+</button>' + (big > 1 ? '<button type="button" aria-label="Add ' + big + ' ' + label + '" data-step="' + key + '" data-n="' + big + '">+' + big + '</button>' : '') + '</div></div>';
  }
  function barRow(label, a) {
    const pct = Math.min(100, a.target ? a.actual / a.target * 100 : 0); const gp = Math.min(100, a.target ? a.guide / a.target * 100 : 0);
    const need = a.band === 'done' ? 'done' : (a.needPerDay == null ? '' : (a.needPerDay < 1 ? (a.needPerWeek + '/wk') : (a.needPerDay + '/day')));
    return '<div class="bar-row"><span><strong>' + label + '</strong></span><div class="bar-track"><div class="bar-fill ' + tone(a.band) + '" style="width:' + pct + '%"></div>' + (gp > 0 && gp < 100 ? '<div class="bar-mark" style="left:' + gp + '%" title="Guide"></div>' : '') + '</div><span class="num small"><strong>' + a.actual + '</strong>/' + a.target + (need ? ' <span class="muted">· ' + need + '</span>' : '') + '</span></div>';
  }
  function paceSentence(snap) {
    const g = snap.metrics.geo;
    if (snap.overall === 'early') return 'The first few days are about rhythm: one 45-minute session, 30 names prepared, numbers logged before you leave the car.';
    if (snap.overall === 'done') return 'All three targets hit. Keep logging; everything from here is proof for your next 90 days.';
    const bits = [P.metricLine(g)];
    if (snap.metrics.appraisals.inPlay) bits.push(P.metricLine(snap.metrics.appraisals));
    if (snap.metrics.listings.inPlay) bits.push(P.metricLine(snap.metrics.listings));
    return bits.join(' ');
  }
  function bandPill(band) { return '<span class="pill ' + tone(band) + '"><span class="dot"></span>' + esc(bandLabel(band)) + '</span>'; }
  function learnTeaser(week) {
    const w = CONTENT().weeks.find(x => x.week === week); if (!w) return '';
    const L = S.learning || defaultLearning();
    const read = w.lessons.filter(l => L.lessonsRead[l.id]).length;
    return '<button class="card" style="text-align:left;cursor:pointer" data-learn-week="' + week + '"><p class="eyebrow">This week in Learn · Week ' + week + '</p><h3>' + esc(w.theme) + '</h3><p class="small muted">' + esc(w.tagline) + '</p><div class="row between"><span class="small">' + read + ' of ' + w.lessons.length + ' lessons read</span><span class="pill">' + (read === w.lessons.length ? 'Week complete' : 'Open week ' + week) + '</span></div></button>';
  }
  function practiceTeaser(week) {
    const w = CONTENT().weeks.find(x => x.week === week); const rps = CONTENT().rolePlays;
    const id = w && w.rolePlays && w.rolePlays[0]; const rp = rps.find(r => r.id === id) || rps[0]; if (!rp) return '';
    return '<button class="card ink" style="text-align:left;cursor:pointer" data-practice="' + esc(rp.id) + '"><p class="eyebrow" style="color:inherit;opacity:.7">Five-minute role-play</p><h3>' + esc(rp.title) + '</h3><p class="small" style="opacity:.8">' + esc(rp.goal) + '</p><span class="pill accent">Start practice</span></button>';
  }
  function pipelineDue() {
    const due = S.pipeline.filter(p => p.status === 'active' && p.nextTouch && p.nextTouch <= todayStr()).sort((a, b) => a.nextTouch < b.nextTouch ? -1 : 1);
    if (!due.length) return '';
    return '<div class="card"><p class="eyebrow">Pipeline touches due</p>' + due.slice(0, 5).map(p => '<div class="item static"><div><div class="t">' + esc(p.address || 'Appraisal') + '</div><div class="s">' + (p.category === '1-2' ? 'Listing in 1 to 2 months · weekly contact' : 'Listing in 2 to 12 months · monthly contact') + ' · due ' + niceDate(p.nextTouch) + '</div></div><button class="btn sm" data-touch="' + esc(p.id) + '">Touched</button></div>').join('') + '<button class="btn sm ghost" data-nav="progress">All pipeline</button></div>';
  }
  function graduationCard(snap) {
    const m = snap.metrics;
    return '<div class="card accent"><p class="eyebrow" style="color:inherit;opacity:.7">Twelve weeks done</p><h2>' + m.geo.actual + ' geo data · ' + m.appraisals.actual + ' appraisals · ' + m.listings.actual + ' listings</h2><p>Sit down with Damian and Luke for the graduation review in Week 12 of Learn. Your pipeline keeps running: every appraisal comes back around at 12 months.</p></div>';
  }

  function step(key, n, opts) {
    if (!S.daysLoaded) { toast(S.daysError ? 'Could not load your sheet. Refresh to try again.' : 'One moment, loading your sheet'); return; }
    if (!S.draft) S.draft = emptyDay(S.logDate);
    const before = S.draft[key] || 0; const after = Math.max(0, before + n);
    if (after === before) return;
    S.draft[key] = after; S.dirty = true; S.draftRev = (S.draftRev || 0) + 1;
    const el = $('[data-val="' + key + '"]'); if (el) el.textContent = after;
    announce((P.LABELS[key] || key) + ' ' + after);
    const st = $('#save-state'); if (st) st.textContent = 'Saving…';
    if (n > 0 && key === 'appraisals') openAppraisalSheet();
    else if (n > 0 && key === 'listings' && !(opts && opts.quiet)) openListingSheet();
    scheduleSave();
    if (['geo', 'appraisals', 'listings'].includes(key)) refreshPaceStrip();
  }
  function refreshPaceStrip() { /* cheap: re-render whole view after a tick when no sheet is open */ if (!$('#sheet-root').innerHTML) render(); }
  function scheduleSave() { clearTimeout(S.saveTimer); S.saveFailed = false; S.saveTimer = setTimeout(() => saveDay(false), 900); }
  function saveDay(close, retried) {
    clearTimeout(S.saveTimer);
    if (!S.daysLoaded || !S.draft || (!S.dirty && !close)) return Promise.resolve();
    const note = $('#day-note'); if (note) S.draft.note = note.value;
    const doc = Object.assign({}, S.draft, { closed: close ? true : !!S.draft.closed, updatedAt: new Date().toISOString() });
    const prevTotals = Object.assign({ geo: 0, appraisals: 0, listings: 0 }, (S.person && isObj(S.person.celebrated)) ? S.person.celebrated : (S.days.length ? { geo: P.total(S.days, 'geo'), appraisals: P.total(S.days, 'appraisals'), listings: P.total(S.days, 'listings') } : {}));
    const rev = S.draftRev || 0;
    return chain(async () => {
      try { await dayRef(S.me.id, doc.date).set(doc); }
      catch (e) {
        if (!retried && e && (e.code === 'unavailable' || e.code === 'resource_exhausted')) { setTimeout(() => saveDay(close, true), 1500 + Math.random() * 1500); return; }
        S.saveFailed = true; const st = $('#save-state'); if (st) st.textContent = 'Not saved. Tap a number again to retry.'; throw e;
      }
      S.saveFailed = false;
      if (S.draft && S.draft.date === doc.date) { S.draft.updatedAt = doc.updatedAt; S.draft.closed = doc.closed; }
      if ((S.draftRev || 0) === rev) S.dirty = false; else scheduleSave();
      const days = daysWithDraft(); const snap = snapFor(S.person, days);
      const summary = summarize(snap);
      const nextTotals = { geo: P.total(days, 'geo'), appraisals: P.total(days, 'appraisals'), listings: P.total(days, 'listings') };
      const patch = { lastLogDate: latestDate(days), summary, updatedAt: new Date().toISOString() };
      if (close) patch.celebrated = nextTotals;
      await myRef().update(patch);
      if (boardOn()) { try { await boardRef(S.me.id).set({ name: S.person.name || '', week: snap.week, totals: { geo: nextTotals.geo, appraisals: nextTotals.appraisals, listings: nextTotals.listings }, targets: snap.targets, streak: snap.streak, lastLogDate: patch.lastLogDate, status: S.person.status || 'active', updatedAt: patch.updatedAt }); } catch (e) { console.warn('board write', e); } }
      const st = $('#save-state'); if (st) st.textContent = 'Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); announce('Saved');
      if (close) showVerdict(snap, doc, P.milestones(prevTotals, nextTotals, snap.streak));
    });
  }
  function latestDate(days) { let m = null; for (const d of days) if (d.date && (!m || d.date > m)) m = d.date; return m; }
  function summarize(snap) {
    const t = {}; for (const m of P.METRICS) t[m] = snap.metrics[m].actual;
    const bands = {}; const need = {}; for (const m of P.METRICS) { bands[m] = snap.metrics[m].band; need[m] = snap.metrics[m].needPerDay; }
    return { asOf: snap.asOf, totals: Object.assign(t, snap.sessionTotals), bands, overall: snap.overall, needPerDay: need, streak: snap.streak, week: snap.week, focusWeek: focusOf(snap.cal).week, dayIndex: snap.idx, totalDays: snap.total, remainingDays: snap.remainingDays, loggedDays: snap.loggedDays, missedDays: snap.missedDays, targets: snap.targets, thisWeek: snap.thisWeek, ratios: snap.ratios, programStatus: snap.status };
  }
  function showVerdict(snap, doc, milestones) {
    const v = P.verdict(snap, doc);
    const celebrate = milestones.length || snap.overall === 'ahead' || (snap.overall === 'ontrack' && snap.idx % 5 === 0) || snap.overall === 'done';
    sheet('<div class="row between"><h2>' + esc(v.title) + '</h2>' + bandPill(snap.overall) + '</div>' +
      (milestones.length ? '<div class="card accent"><p class="eyebrow" style="color:inherit;opacity:.7">Milestone</p>' + milestones.map(m => '<p><strong>' + esc(m) + '</strong></p>').join('') + '</div>' : '') +
      '<div class="prose">' + v.lines.map(l => '<p>' + esc(l) + '</p>').join('') + '</div>' +
      '<div class="row"><button class="btn primary" data-close="1">Back to today</button><button class="btn" data-nav="progress" data-close="1">See progress</button></div>');
    if (celebrate) confetti();
  }
  function openDatePicker() {
    const snap = mySnap(); const prev = prevWorkDate(snap);
    sheet('<h3>Which day are you logging?</h3><div class="list">' +
      '<button class="item" data-logdate="' + todayStr() + '"><div><div class="t">Today</div><div class="s">' + longDate(todayStr()) + '</div></div></button>' +
      (prev ? '<button class="item" data-logdate="' + prev + '"><div><div class="t">Previous working day</div><div class="s">' + longDate(prev) + (S.days.find(x => x.date === prev) ? ' · logged' : ' · not logged') + '</div></div></button>' : '') +
      '</div><label class="f">Another day<input type="date" id="pick-date" max="' + todayStr() + '" value="' + S.logDate + '"></label><button class="btn block" data-act="pick-date-go">Open that day</button>');
  }
  function setLogDate(date) {
    if (!P.parseDate(date) || date > todayStr()) { toast('Pick a day up to today'); return; }
    const go = () => { S.logDate = date; S.logPinned = date !== todayStr(); S.dirty = false; S.draft = Object.assign(emptyDay(date), S.days.find(d => d.date === date) || {}); closeSheet(); render(); };
    if (!S.dirty) { go(); return; }
    saveDay(false).then(() => { if (S.dirty) { toast('Save your numbers first. Tap a number to retry.', 4000); return; } go(); });
  }
  function rollDate() {
    if (S.logPinned || S.logDate === todayStr() || !S.daysLoaded) return false;
    // The date always rolls; the toast only makes sense for someone who has the daily sheet (not left, pending or before their start).
    const sw = () => { S.logDate = todayStr(); S.dirty = false; S.draft = Object.assign(emptyDay(S.logDate), S.days.find(d => d.date === S.logDate) || {}); render(); const s = mySnap(); if (!isLeft() && !isPending() && s && s.status !== 'upcoming') toast('New day: now logging ' + niceDate(S.logDate)); };
    if (S.dirty) saveDay(false).then(sw, sw); else sw();
    return true;
  }
  function openAppraisalSheet() {
    sheet('<h3>Appraisal details <span class="muted small">(optional)</span></h3><p class="small muted">An appraisal only counts once it has an action plan and a pipeline category. Thirty seconds now saves the follow-up later.</p>' +
      '<label class="f">Address<input id="ap-address" placeholder="12 Example St, Irymple"></label>' +
      '<div class="chips" data-group="kind"><button type="button" class="chip" data-v="curbside" aria-pressed="true">Curbside</button><button type="button" class="chip" data-v="walkthrough" aria-pressed="false">Quick walk-through</button></div>' +
      '<p class="eyebrow">Likely to list</p><div class="chips" data-group="category"><button type="button" class="chip" data-v="1-2" aria-pressed="false">1 to 2 months (weekly contact)</button><button type="button" class="chip" data-v="2-12" aria-pressed="true">2 to 12 months (monthly contact)</button></div>' +
      '<p class="eyebrow">Lead type</p><div class="chips" data-group="group"><button type="button" class="chip" data-v="cold" aria-pressed="false">Cold</button><button type="button" class="chip" data-v="warm" aria-pressed="true">Warm</button><button type="button" class="chip" data-v="hot" aria-pressed="false">Hot</button></div>' +
      '<p class="eyebrow">Action plan</p><div class="chips" data-group="plan">' + ['12 month re-appraisal', '1 month plan', '3 month plan', '6 month plan', 'Anniversary', 'On the market', 'Unsuccessful'].map((p, i) => '<button type="button" class="chip" data-v="' + esc(p) + '" aria-pressed="' + (i === 0) + '">' + esc(p) + '</button>').join('') + '</div>' +
      '<div class="row sheet-actions"><button class="btn primary grow" data-act="save-appraisal">Save to pipeline</button><button class="btn ghost" data-close="1">Skip, just count it</button></div>', { noFocus: true });
  }
  function chipVal(group) { const b = $('[data-group="' + group + '"] .chip[aria-pressed="true"]'); return b ? b.dataset.v : null; }
  function saveAppraisal() {
    const cat = chipVal('category') || '2-12'; const date = S.logDate;
    const rec = { address: $('#ap-address').value.trim(), kind: chipVal('kind') || 'curbside', category: cat, group: chipVal('group') || 'warm', plan: chipVal('plan') || '12 month re-appraisal', date, status: 'active', lastTouch: date, nextTouch: P.fmtDate(P.addDays(P.parseDate(date), cat === '1-2' ? 7 : 30)), reappraisal: P.fmtDate(P.addDays(P.parseDate(date), 365)), notes: '', createdAt: new Date().toISOString() };
    closeSheet();
    chain(async () => { await db().collection('people/' + S.me.id + '/pipeline').add(rec); toast('Added to your pipeline'); });
  }
  function openListingSheet() {
    const cands = S.pipeline.filter(p => p.status === 'active');
    sheet('<h3>Listing details <span class="muted small">(optional)</span></h3>' +
      '<label class="f">Address<input id="li-address" placeholder="Property address"></label>' +
      (cands.length ? '<label class="f">From your pipeline<select id="li-from"><option value="">Not from the pipeline</option>' + cands.map(p => '<option value="' + esc(p.id) + '">' + esc(p.address || 'Appraisal on ' + p.date) + '</option>').join('') + '</select></label>' : '') +
      '<div class="row"><button class="btn primary grow" data-act="save-listing">Save</button><button class="btn ghost" data-close="1">Skip, just count it</button></div>');
  }
  function saveListing() {
    const addr = $('#li-address').value.trim(); const from = $('#li-from') ? $('#li-from').value : '';
    closeSheet();
    chain(async () => {
      if (from) { const p = S.pipeline.find(x => x.id === from); await db().doc('people/' + S.me.id + '/pipeline/' + from).update({ status: 'listed', listedDate: S.logDate, address: addr || (p && p.address) || '' }); }
      else if (addr) { await db().collection('people/' + S.me.id + '/pipeline').add({ address: addr, kind: 'listing', category: '1-2', group: 'hot', plan: 'On the market', date: S.logDate, status: 'listed', listedDate: S.logDate, lastTouch: S.logDate, nextTouch: null, notes: '', createdAt: new Date().toISOString() }); }
      toast('Listing recorded. Well done.');
    });
  }
  function touchPipeline(id) {
    const p = S.pipeline.find(x => x.id === id); if (!p) return;
    const next = P.fmtDate(P.addDays(P.today(), p.category === '1-2' ? 7 : 30));
    chain(async () => { await db().doc('people/' + S.me.id + '/pipeline/' + id).update({ lastTouch: todayStr(), nextTouch: next }); toast('Next touch ' + niceDate(next)); });
  }
  function setPipelineStatus(id, status) {
    chain(async () => {
      const patch = { status, updatedAt: new Date().toISOString() }; if (status === 'listed') patch.listedDate = S.logDate;
      await db().doc('people/' + S.me.id + '/pipeline/' + id).update(patch); closeSheet();
      if (status === 'listed') { step('listings', 1, { quiet: true }); toast('Marked listed and counted on ' + niceDate(S.logDate)); }
      else toast(status === 'active' ? 'Back in the pipeline' : 'Marked ' + status);
    });
  }
  function openPipelineItem(id) {
    const p = S.pipeline.find(x => x.id === id); if (!p) return;
    sheet('<h3>' + esc(p.address || 'Appraisal') + '</h3><p class="small muted">' + esc(p.kind || '') + ' · appraised ' + niceDate(p.date) + ' · ' + (p.category === '1-2' ? 'listing in 1 to 2 months' : 'listing in 2 to 12 months') + (groupLabel(p.group) ? ' · ' + groupLabel(p.group) + ' lead' : '') + ' · ' + esc(p.plan || '') + '</p>' +
      '<p class="small">Last touch ' + (p.lastTouch ? niceDate(p.lastTouch) : 'none') + ' · next due ' + (p.nextTouch ? niceDate(p.nextTouch) : 'n/a') + (p.reappraisal ? ' · 12-month re-appraisal ' + niceDate(p.reappraisal) : '') + '</p>' +
      '<label class="f">Notes<textarea id="pl-notes" rows="2">' + esc(p.notes || '') + '</textarea></label>' +
      '<div class="row">' + (p.status === 'active' ? '<button class="btn primary" data-touch="' + esc(id) + '" data-close="1">Touched today</button><button class="btn" data-pstatus="listed" data-pid="' + esc(id) + '">Listed</button><button class="btn" data-pstatus="lost" data-pid="' + esc(id) + '">Lost</button>' : '<button class="btn" data-pstatus="active" data-pid="' + esc(id) + '">Reactivate</button>') + '<button class="btn ghost" data-act="save-pl-notes" data-pid="' + esc(id) + '">Save notes</button></div>', { noFocus: true });
  }

  // ---------- Progress ----------
  function progressHtml() { const snap = mySnap(); return progressFor(snap, daysWithDraft(), S.pipeline, S.learning || defaultLearning(), S.person, false); }
  function progressFor(snap, days, pipeline, learning, person, readOnly) {
    if (!snap) return '<div class="card">No start date set.</div>';
    const parts = [];
    parts.push('<div class="hero"><p class="eyebrow">' + esc(person.name) + (person.farm ? ' · ' + esc(person.farm) : '') + '</p><h1>' + (snap.status === 'upcoming' ? 'Starts ' + niceDate(snap.cal.start) : 'Week ' + Math.min(snap.week, snap.cal.weeks) + ' · Day ' + snap.idx + ' of ' + snap.total) + '</h1><div class="row">' + bandPill(snap.overall) + '<span class="pill">' + snap.remainingDays + ' working days left</span>' + (snap.streak ? '<span class="pill">' + ICONS.flame + ' ' + snap.streak + ' day streak</span>' : '') + '</div></div>');
    parts.push('<div class="rings">' + ring('Geo data', snap.metrics.geo) + ring('Appraisals', snap.metrics.appraisals) + ring('Listings', snap.metrics.listings) + '</div>');
    parts.push('<div class="card"><p class="eyebrow">Where you stand</p><div class="prose">' + P.METRICS.map(m => '<p><strong>' + P.LABELS[m][0].toUpperCase() + P.LABELS[m].slice(1) + ':</strong> ' + esc(P.metricLine(snap.metrics[m])) + '</p>').join('') + '</div></div>');
    parts.push('<div class="card"><div class="row between"><p class="eyebrow">Cumulative vs guide</p><div class="chips" id="chart-metric">' + P.METRICS.map(m => '<button class="chip sm" data-chart="' + m + '" aria-pressed="' + ((S.ui.chartMetric || 'geo') === m) + '">' + P.LABELS[m] + '</button>').join('') + '</div></div>' + chart(snap, days, S.ui.chartMetric || 'geo') + '<p class="tiny muted">Solid line: your running total. Dashed: the soft guide (front-loaded geo data, appraisals from week 3, listings from week 8). The guide is a reference, not a quota: the pace line above is what matters.</p></div>');
    parts.push('<div class="card"><p class="eyebrow">Call session ratios</p><div class="kpis">' + kpi(snap.sessionTotals.calls, 'calls') + kpi(snap.sessionTotals.connections, 'connections') + kpi(snap.sessionTotals.appointments, 'appointments') + kpi(snap.ratios.connectionRate == null ? null : snap.ratios.connectionRate + '%', 'connection rate (benchmark: 45 to 50%)') + kpi(snap.ratios.appointmentRate == null ? null : snap.ratios.appointmentRate + '%', 'appointments per connection (benchmark: 1 to 3 per 8 to 12)') + kpi(snap.ratios.appraisalsPer100Geo, 'appraisals per 100 geo data (program: 10)') + kpi(snap.ratios.listingsPerAppraisal == null ? null : snap.ratios.listingsPerAppraisal + '%', 'listings per appraisal (program: 10%)') + '</div></div>');
    parts.push('<div class="card"><p class="eyebrow">Logging streak</p>' + heat(snap, days) + '<p class="tiny muted">' + snap.loggedDays + ' of ' + snap.idx + ' working days logged' + (snap.missedDays ? ' · ' + snap.missedDays + ' missed' : '') + '</p></div>');
    parts.push('<div class="card"><p class="eyebrow">Week by week</p>' + weekTable(snap, days) + '</div>');
    parts.push(pipelineCard(pipeline, readOnly));
    parts.push(learningCard(learning, snap));
    return parts.join('');
  }
  function kpi(v, l) { const none = v == null; return '<div class="kpi"><div class="v num' + (none ? ' none' : '') + '">' + (none ? 'Not yet' : esc(v)) + '</div><div class="l">' + esc(l) + '</div></div>'; }
  function ring(label, a) {
    const r = 50, c = 2 * Math.PI * r; const pct = a.target ? Math.min(1, a.actual / a.target) : 0; const gp = a.target ? Math.min(1, a.guide / a.target) : 0;
    const need = a.band === 'done' ? 'Done' : (a.needPerDay == null ? '' : (a.needPerDay < 1 ? a.needPerWeek + ' a week from here' : a.needPerDay + ' a day from here'));
    return '<div class="ring-card"><div class="ring"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="' + r + '" fill="none" stroke-width="10"/><circle class="guide" cx="60" cy="60" r="' + r + '" fill="none" stroke-width="10" stroke-dasharray="' + (c * gp) + ' ' + c + '" stroke-linecap="round"/><circle class="bar ' + tone(a.band) + '" cx="60" cy="60" r="' + r + '" fill="none" stroke-width="10" stroke-dasharray="' + (c * pct) + ' ' + c + '" stroke-linecap="round"/></svg><div class="center"><div class="big num">' + a.actual + '</div><div class="of">of ' + a.target + '</div></div></div><strong>' + label + '</strong>' + bandPill(a.band) + '<span class="small muted">' + esc(need) + '</span></div>';
  }
  function chart(snap, days, metric) {
    const W = 480, H = 210, pl = 38, pr = 14, pt = 14, pb = 30; const n = snap.total; const target = snap.targets[metric];
    const buckets = P.byIndex(days, snap.cal, metric, snap.asOf);
    const pts = []; let acc = buckets[0] || 0;
    for (let i = 1; i <= Math.min(snap.idx, n); i++) { acc += buckets[i] || 0; pts.push([i, acc]); }
    const maxY = Math.max(target, acc, 1) * 1.05;
    const x = i => pl + (i / n) * (W - pl - pr); const y = v => pt + (1 - v / maxY) * (H - pt - pb);
    const guide = []; for (let i = 0; i <= n; i++) guide.push([x(i), y(P.guideAt(metric, target, i, snap.cal))]);
    const path = a => a.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const actualPts = [[x(0), y(0)]].concat(pts.map(p => [x(p[0]), y(p[1])]));
    const area = path(actualPts) + ' L' + actualPts[actualPts.length - 1][0].toFixed(1) + ' ' + y(0).toFixed(1) + ' Z';
    const ticks = [0, .25, .5, .75, 1].map(f => Math.round(maxY * f));
    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + P.LABELS[metric] + ' running total against the guide">';
    for (const t of ticks) svg += '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text x="' + (pl - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + t + '</text>';
    for (let w = 1; w <= snap.cal.weeks; w += (snap.cal.weeks > 12 ? 2 : 1)) { const i = Math.round(w / snap.cal.weeks * n); svg += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">W' + w + '</text>'; }
    svg += '<path class="area" d="' + area + '"/><path class="guide" d="' + path(guide) + '"/><path class="actual" d="' + path(actualPts) + '"/>';
    if (pts.length) { const last = actualPts[actualPts.length - 1]; svg += '<circle class="dot" cx="' + last[0] + '" cy="' + last[1] + '" r="4"/>'; }
    svg += '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(target) + '" y2="' + y(target) + '" stroke-dasharray="2 3"/><text x="' + (W - pr) + '" y="' + (y(target) - 4) + '" text-anchor="end">target ' + target + '</text></svg>';
    return svg;
  }
  function heat(snap, days) {
    const logged = {}; for (const d of days) logged[d.date] = true; const t = todayStr();
    return '<div class="heat">' + snap.cal.workDates.map(dt => '<i class="' + (dt > t ? 'future' : (logged[dt] ? 'on' : (dt < t ? 'miss' : ''))) + (dt === t ? ' today' : '') + '" title="' + dt + (logged[dt] ? ' logged' : '') + '"></i>').join('') + '</div>';
  }
  function weekTable(snap, days) {
    const rows = []; const gGeo = P.weeklyGuide('geo', snap.targets.geo, snap.cal.weeks), gAp = P.weeklyGuide('appraisals', snap.targets.appraisals, snap.cal.weeks);
    for (let w = 1; w <= snap.cal.weeks; w++) {
      const sum = k => P.weekTotal(days, snap.cal, w, k);
      const future = P.weekBounds(snap.cal, w)[0] > todayStr();
      rows.push('<tr class="' + (w === snap.week ? 'now' : '') + '"><td>Week ' + w + (future ? ' <span class="muted">·</span>' : '') + '</td><td class="num">' + sum('geo') + ' <span class="muted">/' + Math.round(gGeo[w - 1]) + '</span></td><td class="num">' + sum('appraisals') + ' <span class="muted">/' + Math.round(gAp[w - 1]) + '</span></td><td class="num">' + sum('listings') + '</td><td class="num">' + sum('calls') + '</td><td class="num">' + sum('connections') + '</td><td class="num">' + sum('appointments') + '</td></tr>');
    }
    return '<div class="table-wrap"><table><thead><tr><th>Week</th><th>Geo / guide</th><th>Appraisals / guide</th><th>Listings</th><th>Calls</th><th>Conn.</th><th>Appts</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function pipelineCard(pipeline, readOnly) {
    const active = pipeline.filter(p => p.status === 'active').sort((a, b) => (a.nextTouch || '9') < (b.nextTouch || '9') ? -1 : 1);
    const listed = pipeline.filter(p => p.status === 'listed'); const lost = pipeline.filter(p => p.status === 'lost');
    const row = p => '<button class="item" ' + (readOnly ? 'disabled' : 'data-pipe="' + esc(p.id) + '"') + '><div><div class="t">' + esc(p.address || 'Appraisal on ' + niceDate(p.date)) + '</div><div class="s">' + (p.category === '1-2' ? '1 to 2 months · weekly' : '2 to 12 months · monthly') + (groupLabel(p.group) ? ' · ' + groupLabel(p.group) : '') + (p.nextTouch ? ' · next ' + niceDate(p.nextTouch) : '') + '</div></div>' + (p.nextTouch && p.nextTouch <= todayStr() ? '<span class="pill bad">Due</span>' : '<span class="pill muted">' + esc(p.plan || '') + '</span>') + '</button>';
    return '<div class="card"><div class="row between"><p class="eyebrow">Pipeline</p><span class="small muted">' + active.length + ' active · ' + listed.length + ' listed · ' + lost.length + ' lost</span></div>' +
      (active.length ? '<div class="list">' + active.map(row).join('') + '</div>' : '<div class="empty"><strong>No appraisals in the pipeline yet.</strong><span class="small">When you add an appraisal on your daily sheet, give it an address and a category and it lands here with its next touch date.</span></div>') +
      (listed.length ? '<p class="eyebrow">Listed</p><div class="list">' + listed.map(row).join('') + '</div>' : '') + '</div>';
  }
  function learningCard(L, snap) {
    const weeks = CONTENT().weeks; if (!weeks.length) return '';
    const due = weeks.filter(w => w.week <= Math.max(1, Math.min(snap.week, snap.cal.weeks)));
    const lessonsDue = due.reduce((s, w) => s + w.lessons.length, 0); const read = due.reduce((s, w) => s + w.lessons.filter(l => L.lessonsRead[l.id]).length, 0);
    const quizzes = due.filter(w => L.quiz[w.week]).length; const practice = (L.practice && L.practice.count) || 0;
    const avg = L.practice && L.practice.scores && L.practice.scores.length ? Math.round(L.practice.scores.reduce((s, x) => s + (x.pct || 0), 0) / L.practice.scores.length) : null;
    return '<div class="card"><p class="eyebrow">Learning</p><div class="kpis">' + kpi(read + '/' + lessonsDue, 'lessons read (weeks due so far)') + kpi(quizzes + '/' + due.length, 'weekly quizzes done') + kpi(practice, 'role-plays completed') + kpi(avg == null ? null : avg + '%', 'average role-play score') + '</div></div>';
  }

  // ---------- Learn ----------
  function currentWeek() { const s = mySnap(); if (s) return Math.max(1, Math.min(s.week, S.config.weeks)); return 1; }
  function learnHtml() {
    const weeks = CONTENT().weeks.slice().sort((a, b) => a.week - b.week); if (!weeks.length) return '<div class="card">Course content is loading. Refresh in a moment.</div>';
    const cur = currentWeek(); if (!S.ui.learnWeek) S.ui.learnWeek = Number(ls.get('lp.learnWeek')) || cur;
    const w = weeks.find(x => x.week === S.ui.learnWeek) || weeks[0]; const L = S.learning || defaultLearning();
    const read = w.lessons.filter(l => L.lessonsRead[l.id]).length; const drills = w.drills.filter(d => L.drillsDone[d.id]).length; const quizDone = !!L.quiz[w.week];
    const totalSteps = w.lessons.length + w.drills.length + 1; const doneSteps = read + drills + (quizDone ? 1 : 0);
    const C = CONTENT();
    const scripts = (w.scripts || []).map(id => C.scripts.find(s => s.id === id)).filter(Boolean);
    const templates = (w.templates || []).map(id => C.templates.find(s => s.id === id)).filter(Boolean);
    const rps = (w.rolePlays || []).map(id => C.rolePlays.find(s => s.id === id)).filter(Boolean);
    const parts = [];
    parts.push('<div class="hero"><p class="eyebrow">Learn · 12 weeks, 6 modules</p><h1>Week ' + w.week + ': ' + esc(w.theme) + '</h1><p class="sub">' + esc(w.tagline) + '</p></div>');
    parts.push('<div class="week-nav" role="tablist" aria-label="Weeks">' + weeks.map(x => { const r = x.lessons.filter(l => L.lessonsRead[l.id]).length; const complete = r === x.lessons.length && L.quiz[x.week]; return '<button role="tab" data-week="' + x.week + '" aria-pressed="' + (x.week === w.week) + '" class="' + (x.week === cur ? 'now ' : '') + (complete ? 'done' : '') + '"><span class="w">WK</span>' + x.week + '</button>'; }).join('') + '</div>');
    parts.push('<div class="card"><div class="row between"><span class="small"><strong>' + doneSteps + ' of ' + totalSteps + '</strong> steps this week</span><span class="pill ' + (doneSteps === totalSteps ? 'good' : 'muted') + '">' + (doneSteps === totalSteps ? 'Week complete' : esc(w.module)) + '</span></div><div class="progress-line"><i style="width:' + Math.round(doneSteps / totalSteps * 100) + '%"></i></div><div class="prose">' + md(w.intro) + '</div><div class="card soft"><p class="eyebrow">This week\'s numbers</p><p class="small">' + esc(w.focus) + '</p></div></div>');
    parts.push('<div class="stack"><h2>Lessons</h2>' + w.lessons.map((l, i) => '<details class="lesson" ' + (S.ui.openLesson === l.id ? 'open' : '') + ' data-lesson="' + esc(l.id) + '"><summary><div><div class="row"><span class="check ' + (L.lessonsRead[l.id] ? 'on' : '') + '">' + (L.lessonsRead[l.id] ? ICONS.check : '') + '</span><strong>' + (i + 1) + '. ' + esc(l.title) + '</strong></div><div class="small muted" style="margin-left:34px">' + (l.minutes || 4) + ' min read</div></div><span class="muted">›</span></summary><div class="body">' + (l.keyLine ? '<div class="keyline">“' + esc(l.keyLine) + '”<span class="who">Key line</span></div>' : '') + '<div class="prose">' + md(l.body) + '</div>' + (l.keyTakeaways && l.keyTakeaways.length ? '<div class="card soft"><p class="eyebrow">Take away</p><ul style="margin:0;padding-left:18px">' + l.keyTakeaways.map(k => '<li>' + inline(k) + '</li>').join('') + '</ul></div>' : '') + '<button class="btn ' + (L.lessonsRead[l.id] ? '' : 'primary') + '" data-read="' + esc(l.id) + '">' + (L.lessonsRead[l.id] ? 'Mark as unread' : 'Mark as read') + '</button></div></details>').join('') + '</div>');
    parts.push('<div class="stack"><h2>Do this week</h2><div class="list">' + w.drills.map(d => '<button class="item ' + (L.drillsDone[d.id] ? 'done' : '') + '" data-drill="' + esc(d.id) + '"><div><div class="t">' + esc(d.title) + '</div><div class="s">' + esc(d.detail) + '</div></div><span class="check ' + (L.drillsDone[d.id] ? 'on' : '') + '">' + (L.drillsDone[d.id] ? ICONS.check : '') + '</span></button>').join('') + '</div></div>');
    if (scripts.length || templates.length || rps.length) parts.push('<div class="card"><p class="eyebrow">Master this week</p>' + (scripts.length ? '<div class="chips">' + scripts.map(s => '<button class="chip" data-open-script="' + esc(s.id) + '">' + esc(s.title) + '</button>').join('') + '</div>' : '') + (templates.length ? '<p class="eyebrow">Templates to send</p><div class="chips">' + templates.map(t => '<button class="chip dim" data-open-template="' + esc(t.id) + '">' + esc(t.title) + '</button>').join('') + '</div>' : '') + (rps.length ? '<p class="eyebrow">Practice</p><div class="chips">' + rps.map(r => '<button class="chip" data-practice="' + esc(r.id) + '">' + ICONS.practice + ' ' + esc(r.title) + '</button>').join('') + '</div>' : '') + '</div>');
    parts.push(quizHtml(w, L));
    if (isManager() && w.coachNote) parts.push('<div class="card info"><p class="eyebrow">Coach note (managers only)</p><div class="prose">' + md(w.coachNote) + '</div></div>');
    const next = weeks.find(x => x.week === w.week + 1);
    parts.push('<div class="row between">' + (w.week > 1 ? '<button class="btn" data-week="' + (w.week - 1) + '">' + ICONS.back + ' Week ' + (w.week - 1) + '</button>' : '<span></span>') + (next ? '<button class="btn" data-week="' + next.week + '">Week ' + next.week + ' ›</button>' : '') + '</div>');
    return parts.join('');
  }
  function quizHtml(w, L) {
    const q = S.ui.quiz && S.ui.quiz.week === w.week ? S.ui.quiz : null; const prev = L.quiz[w.week];
    if (!q) return '<div class="card"><div class="row between"><div><p class="eyebrow">Week ' + w.week + ' check</p><h3>' + w.quiz.length + ' quick questions</h3>' + (prev ? '<p class="small muted">Best so far: ' + prev.score + '/' + prev.total + ' · ' + prev.attempts + ' attempt' + (prev.attempts > 1 ? 's' : '') + '</p>' : '<p class="small muted">Takes two minutes. Your score is shared with your managers.</p>') + '</div><button class="btn primary" data-act="quiz-start" data-qweek="' + w.week + '">' + (prev ? 'Retake' : 'Start') + '</button></div></div>';
    if (q.i >= w.quiz.length) {
      const score = q.answers.filter(Boolean).length; const pct = Math.round(score / w.quiz.length * 100);
      return '<div class="card ' + (pct >= 80 ? 'good' : 'soft') + '"><p class="eyebrow">Week ' + w.week + ' check</p><h2 id="quiz-score">' + score + ' of ' + w.quiz.length + '</h2><p>' + (pct >= 80 ? 'Pass. You know this week\'s material.' : 'Under 80%. Re-read the lessons you missed and go again; the retake counts.') + '</p><div class="row"><button class="btn" data-act="quiz-start" data-qweek="' + w.week + '" aria-describedby="quiz-score">Try again</button><button class="btn ghost" data-act="quiz-close">Close</button></div></div>';
    }
    const item = w.quiz[q.i];
    return '<div class="card"><div class="row between"><p class="eyebrow">Question ' + (q.i + 1) + ' of ' + w.quiz.length + '</p><button class="btn sm ghost" data-act="quiz-close">Quit</button></div><h3 id="quiz-q">' + esc(item.q) + '</h3><div class="stack" role="group" aria-labelledby="quiz-q">' + item.options.map((o, i) => '<button class="quiz-opt ' + (q.picked == null ? '' : (i === item.answer ? 'right' : (i === q.picked ? 'wrong' : ''))) + '" data-qpick="' + i + '" ' + (q.picked == null ? '' : 'disabled') + '>' + esc(o) + '</button>').join('') + '</div>' + (q.picked == null ? '' : '<div class="card soft"><p class="small" id="quiz-feedback"><strong>' + (q.picked === item.answer ? 'Correct.' : 'Not quite.') + '</strong> ' + esc(item.explain || '') + '</p></div><button class="btn primary" data-act="quiz-next" aria-describedby="quiz-feedback">' + (q.i + 1 >= w.quiz.length ? 'See score' : 'Next') + '</button>') + '</div>';
  }
  function setLearning(mut) {
    if (!S.learning) { toast('One moment, your progress is still loading'); return; }
    mut(S.learning); S.learning.updatedAt = new Date().toISOString(); S.learnDirty = true; S.learnRev++; render();
    clearTimeout(S.learnTimer);
    S.learnTimer = setTimeout(() => { const rev = S.learnRev; const body = clone(S.learning); chain(async () => { await learnRef(S.me.id).set(body); if (S.learnRev === rev) S.learnDirty = false; }); }, 600);
  }
  function quizPick(i) {
    const q = S.ui.quiz; const w = CONTENT().weeks.find(x => x.week === q.week); if (!q || q.picked != null) return;
    q.picked = i; q.answers[q.i] = i === w.quiz[q.i].answer; S.ui.focusAfter = '[data-act="quiz-next"]'; render();
  }
  function quizNext() {
    const q = S.ui.quiz; const w = CONTENT().weeks.find(x => x.week === q.week); q.i++; q.picked = null;
    S.ui.focusAfter = q.i >= w.quiz.length ? '#view [data-act="quiz-start"]' : '[data-qpick="0"]';
    if (q.i >= w.quiz.length) {
      const score = q.answers.filter(Boolean).length;
      setLearning(L => { const prev = L.quiz[w.week] || { score: 0, total: w.quiz.length, attempts: 0 }; L.quiz[w.week] = { score: Math.max(prev.score, score), total: w.quiz.length, last: score, attempts: prev.attempts + 1, at: new Date().toISOString() }; });
      if (score / w.quiz.length >= .8) confetti();
    } else render();
  }

  // ---------- Scripts & templates ----------
  function scriptsHtml() {
    const C = CONTENT(); const tab = S.ui.scriptsTab; const q = S.ui.scriptsQuery.toLowerCase();
    const parts = ['<div class="hero"><p class="eyebrow">Scripts, letters and templates</p><h1>Say it word for word first. Make it yours second.</h1></div>'];
    parts.push('<div class="row"><div class="chips"><button class="chip" aria-pressed="' + (tab === 'scripts') + '" data-stab="scripts">Scripts</button><button class="chip" aria-pressed="' + (tab === 'templates') + '" data-stab="templates">Letters, SMS and forms</button></div></div><input id="scripts-q" placeholder="Search" value="' + esc(S.ui.scriptsQuery) + '" aria-label="Search scripts">');
    if (tab === 'scripts') {
      const cats = ['all'].concat(Array.from(new Set(C.scripts.map(s => s.category))));
      parts.push('<div class="chips scroll">' + cats.map(c => '<button class="chip" aria-pressed="' + (S.ui.scriptsCat === c) + '" data-scat="' + esc(c) + '">' + esc(c === 'all' ? 'All' : c) + '</button>').join('') + '</div>');
      const list = C.scripts.filter(s => (S.ui.scriptsCat === 'all' || s.category === S.ui.scriptsCat) && (!q || JSON.stringify(s).toLowerCase().includes(q)));
      parts.push('<div class="stack">' + list.map(s => scriptCard(s)).join('') + (list.length ? '' : '<div class="empty">Nothing matches.</div>') + '</div>');
    } else {
      const kinds = ['all', 'letter', 'email', 'sms', 'form', 'checklist', 'worksheet'];
      parts.push('<div class="chips scroll">' + kinds.map(c => '<button class="chip" aria-pressed="' + (S.ui.scriptsCat === c) + '" data-scat="' + c + '">' + (c === 'all' ? 'All' : c[0].toUpperCase() + c.slice(1)) + '</button>').join('') + '</div>');
      const list = C.templates.filter(t => (S.ui.scriptsCat === 'all' || t.kind === S.ui.scriptsCat) && (!q || JSON.stringify(t).toLowerCase().includes(q)));
      parts.push('<div class="stack">' + list.map(t => templateCard(t)).join('') + (list.length ? '' : '<div class="empty">Nothing matches.</div>') + '</div>');
    }
    return parts.join('');
  }
  function scriptText(s) { return s.title + '\n\n' + s.steps.map(b => (b.label ? b.label.toUpperCase() + '\n' : '') + b.line).join('\n\n'); }
  function scriptCard(s) {
    const rp = CONTENT().rolePlays.find(r => r.scriptId === s.id);
    return '<details class="lesson" ' + (S.ui.openScript === s.id ? 'open' : '') + ' id="script-' + esc(s.id) + '"><summary><div><strong>' + esc(s.title) + '</strong><div class="small muted">' + esc(s.category) + ' · ' + esc(s.when) + '</div></div><span class="muted">›</span></summary><div class="body"><div>' + s.steps.map(b => '<div class="beat"><div class="lab">' + esc(b.label || '') + '</div><div class="line">' + esc(b.line) + '</div></div>').join('') + '</div>' + (s.goal ? '<p class="small"><strong>A win:</strong> ' + esc(s.goal) + '</p>' : '') + (s.tips && s.tips.length ? '<div class="card soft"><p class="eyebrow">Coaching tips</p><ul style="margin:0;padding-left:18px">' + s.tips.map(t => '<li class="small">' + inline(t) + '</li>').join('') + '</ul></div>' : '') + '<div class="row">' + (rp ? '<button class="btn primary sm" data-practice="' + esc(rp.id) + '">' + ICONS.practice + ' Practise with the AI</button>' : '') + '<button class="btn sm" data-copy-script="' + esc(s.id) + '">' + ICONS.copy + ' Copy</button></div></div></details>';
  }
  // Letters, emails and SMS: the message is everything before the first '## ' heading; the rest is guidance for the associate
  // (how to use it, before you send), so it is not copied. Forms, checklists and worksheets copy whole.
  const SENDABLE = ['sms', 'email', 'letter'];
  function templateText(t) { return SENDABLE.includes(t.kind) ? t.body.split(/\n## /)[0].replace(/^> /gm, '').replace(/\*\*/g, '').trim() : t.title + '\n\n' + t.body.replace(/\*\*/g, ''); }
  const copyLabel = t => (SENDABLE.includes(t.kind) ? 'Copy message' : 'Copy text');
  function templateCard(t) {
    return '<details class="lesson" id="template-' + esc(t.id) + '" ' + (S.ui.openTemplate === t.id ? 'open' : '') + '><summary><div><strong>' + esc(t.title) + '</strong><div class="small muted">' + esc(t.kind) + ' · ' + esc(t.when) + '</div></div><span class="muted">›</span></summary><div class="body"><div class="prose">' + md(t.body) + '</div><div class="row"><button class="btn sm" data-copy-template="' + esc(t.id) + '">' + ICONS.copy + ' ' + copyLabel(t) + '</button></div></div></details>';
  }
  function openTemplateSheet(id) {
    const t = CONTENT().templates.find(x => x.id === id); if (!t) return;
    // noFocus: focusing Copy (after the body) would open a long letter scrolled to its end.
    sheet('<h3>' + esc(t.title) + '</h3><p class="small muted">' + esc(t.when) + '</p><div class="prose">' + md(t.body) + '</div><div class="row sheet-actions"><button class="btn primary" data-copy-template="' + esc(t.id) + '">' + ICONS.copy + ' ' + copyLabel(t) + '</button><button class="btn ghost" data-close="1">Close</button></div>', { noFocus: true });
  }

  // ---------- Practice (AI role-play) ----------
  function practiceHtml() {
    const C = CONTENT(); const pr = S.ui.practice;
    if (!S.caps.sample) return '<div class="hero"><h1>Practice</h1></div><div class="card"><p>The role-play partner needs Claude, which is not available in this view. You can still rehearse with a colleague: open any script and read the beats aloud.</p><button class="btn" data-nav="scripts">Open scripts</button></div>';
    if (!pr) {
      const cur = currentWeek(); const w = C.weeks.find(x => x.week === cur); const thisWeek = (w && w.rolePlays || []).map(id => C.rolePlays.find(r => r.id === id)).filter(Boolean);
      const L = S.learning || defaultLearning(); const scores = (L.practice && L.practice.scores) || [];
      const card = r => { const best = scores.filter(s => s.rp === r.id).sort((a, b) => b.pct - a.pct)[0]; return '<button class="item" data-practice="' + esc(r.id) + '"><div><div class="t">' + esc(r.title) + '</div><div class="s">' + esc(r.setting) + ' · ' + esc(r.difficulty) + (best ? ' · best ' + best.pct + '%' : '') + '</div></div><span class="pill ' + (r.difficulty === 'hard' ? 'bad' : r.difficulty === 'medium' ? 'warn' : 'good') + '">' + esc(r.difficulty) + '</span></button>'; };
      return '<div class="hero"><p class="eyebrow">Practice</p><h1>Rehearse the call before you make it.</h1><p class="sub">Claude plays a Mildura homeowner. You run the script. At the end you get a scorecard against the script\'s beats. It uses your own Claude usage, so the first call asks your permission.</p></div>' +
        (thisWeek.length ? '<div class="card"><p class="eyebrow">This week</p><div class="list">' + thisWeek.map(card).join('') + '</div></div>' : '') +
        '<div class="card"><p class="eyebrow">All scenarios</p><div class="list">' + C.rolePlays.map(card).join('') + '</div></div>';
    }
    const rp = pr.rp; const script = C.scripts.find(s => s.id === rp.scriptId);
    const head = '<div class="row between"><button class="btn sm ghost" data-act="practice-exit">' + ICONS.back + ' All scenarios</button>' + (script ? '<button class="btn sm ghost" data-act="practice-script">Peek at the script</button>' : '') + '</div><div class="hero"><p class="eyebrow">' + esc(rp.setting) + ' · ' + esc(rp.difficulty) + '</p><h2>' + esc(rp.title) + '</h2><p class="small muted">' + esc(rp.goal) + '</p></div>';
    if (pr.feedback) {
      const f = pr.feedback; const pct = f.max ? Math.round(f.total / f.max * 100) : 0;
      return head + '<div class="card ' + (pct >= 75 ? 'good' : pct >= 50 ? 'soft' : 'warn') + '"><p class="eyebrow">Scorecard</p><h1>' + pct + '%</h1><p class="small">' + f.total + ' of ' + f.max + ' across ' + (f.scores || []).length + ' criteria</p></div>' +
        '<div class="card">' + (f.scores || []).map(s => '<div class="score"><div><strong>' + esc(s.criterion) + '</strong><div class="small muted">' + esc(s.note || '') + '</div></div><span class="pill ' + (s.score >= 2 ? 'good' : s.score === 1 ? 'warn' : 'bad') + '">' + s.score + '/2</span></div>').join('') + '</div>' +
        '<div class="card"><p class="eyebrow">What worked</p><ul style="margin:0;padding-left:18px">' + (f.strengths || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul><p class="eyebrow">Work on</p><ul style="margin:0;padding-left:18px">' + (f.improve || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' + (f.oneThing ? '<div class="keyline">' + esc(f.oneThing) + '<span class="who">The one thing</span></div>' : '') + (f.wordForWord ? '<p class="small"><strong>Try this line next time:</strong> “' + esc(f.wordForWord) + '”</p>' : '') + '</div>' +
        '<div class="row"><button class="btn primary" data-practice="' + esc(rp.id) + '">Go again</button><button class="btn" data-act="practice-exit">Pick another</button></div>';
    }
    return head + '<div class="card"><div class="chat" id="chat">' + chatBubblesHtml(pr) + '</div>' +
      (pr.ended ? '' : '<div class="composer"><textarea id="chat-in" rows="2" placeholder="Say it out loud, then type what you said"></textarea><button class="btn primary" data-act="chat-send" ' + (pr.busy ? 'disabled' : '') + '>Send</button></div>') +
      '<div class="row between"><button class="btn ' + (pr.ended ? 'primary' : '') + '" data-act="practice-feedback" ' + (shownTurns(pr).length < 2 || pr.busy ? 'disabled' : '') + '>End call and get feedback</button><button class="btn ghost sm" data-act="chat-stop" ' + (pr.busy ? '' : 'hidden') + '>Stop</button></div>' + (pr.error ? '<p class="small" style="color:var(--bad)">' + esc(pr.error) + '</p>' : '') + '</div>';
  }
  const HIDDEN_TURN = /^\(The call connects/;
  function shownTurns(pr) { return pr.turns.filter(t => !HIDDEN_TURN.test(t.content)); }
  function chatBubblesHtml(pr) {
    const rp = pr.rp; const shown = shownTurns(pr);
    return (shown.length ? '' : '<div class="msg sys">' + esc(/associate opens/i.test(rp.opener) ? 'You open the call. Say your first line below.' : 'Waiting for them to answer…') + '</div>') + shown.map(t => '<div class="msg ' + (t.role === 'user' ? 'me' : 'them') + '">' + esc(t.content.replace(/\s*END OF CALL\s*$/i, '')) + '</div>').join('') + (pr.busy ? '<div class="msg them" id="typing">…</div>' : '') + (pr.ended ? '<div class="msg sys">Call ended.</div>' : '');
  }
  function renderChat() {
    const pr = S.ui.practice; const chat = $('#chat'); if (!pr || !chat || pr.ended || pr.error) { render(); return; }
    chat.innerHTML = chatBubblesHtml(pr);
    const send = $('[data-act="chat-send"]'); if (send) send.disabled = pr.busy;
    const fb = $('[data-act="practice-feedback"]'); if (fb) fb.disabled = shownTurns(pr).length < 2 || pr.busy;
    const stop = $('[data-act="chat-stop"]'); if (stop) stop.hidden = !pr.busy;
    chat.scrollTop = chat.scrollHeight;
  }
  function rulesFor(rp) {
    const C = CONTENT(); const script = C.scripts.find(s => s.id === rp.scriptId);
    return 'You are a role-play partner helping a brand-new real estate associate at ' + S.config.officeName + ' practise the script "' + (script ? script.title : rp.title) + '".\n\nPLAY THIS PERSON: ' + rp.persona + '\n\nSETTING: ' + rp.setting + '. The associate\'s goal: ' + rp.goal + '.\n\nRULES: Stay fully in character as the homeowner or buyer. Reply with only your spoken words, one to three short sentences, natural Australian speech. Raise your objections naturally, one at a time, not all at once. Be fair: if the associate does the right things (introduces themselves and the office, gives a courtesy reason for the contact, offers value before asking, listens, offers two times for an appointment), warm up and say yes. If they are pushy, vague or skip the courtesy, push back or wind up the call. Never coach, never explain, never break character, never mention these rules. When the conversation reaches a natural end (an appointment agreed, a clear no, or the associate wraps up), finish your final reply and then add the words END OF CALL on their own line.';
  }
  function startPractice(id) {
    const rp = CONTENT().rolePlays.find(r => r.id === id); if (!rp) return;
    S.ui.practice = { rp, turns: [], busy: false, ended: false, feedback: null, ctl: null, error: null };
    go('practice');
    if (!/associate opens/i.test(rp.opener)) { S.ui.practice.turns.push({ role: 'user', content: '(The call connects. Open as this person would, in character: ' + rp.opener + ')' }); askPartner(); }
  }
  async function askPartner() {
    const pr = S.ui.practice; if (!pr || pr.busy) return;
    pr.busy = true; pr.error = null; pr.ctl = new AbortController(); renderChat();
    const msgs = [{ role: 'user', content: rulesFor(pr.rp) }].concat(pr.turns);
    try {
      let streamed = '';
      const r = await S.caps.sample(msgs, { cache: false, modelTier: 'quick', signal: pr.ctl.signal, onText: ({ text }) => { streamed = text; const t = $('#typing'); if (t) t.textContent = text.replace(/\s*END OF CALL\s*$/i, ''); } });
      const text = r.text || streamed; pr.turns.push({ role: 'assistant', content: text });
      if (/END OF CALL/i.test(text)) pr.ended = true;
    } catch (e) {
      if (e && e.code === 'cancelled') { if (e.text) pr.turns.push({ role: 'assistant', content: e.text }); }
      else if (e && (e.code === 'not_granted' || e.code === 'sampling_disabled')) { pr.error = 'Claude is not allowed on this page for your account, so the AI partner is off. Rehearse with a colleague instead.'; }
      else if (e && e.code === 'rate_limited') pr.error = 'Claude is busy or you have hit a usage limit. Try again in a little while.';
      else pr.error = 'Something went wrong talking to Claude. Try again.';
      console.warn(e);
    }
    pr.busy = false; pr.ctl = null; renderChat();
    announce(pr.turns.length && pr.turns[pr.turns.length - 1].role === 'assistant' ? pr.turns[pr.turns.length - 1].content.replace(/\s*END OF CALL\s*$/i, '') : '');
  }
  function sendChat() {
    const pr = S.ui.practice; const ta = $('#chat-in'); if (!pr || !ta) return; const text = ta.value.trim(); if (!text) return;
    pr.turns.push({ role: 'user', content: text }); ta.value = ''; askPartner();
  }
  async function practiceFeedback() {
    const pr = S.ui.practice; if (!pr || pr.busy) return;
    pr.busy = true; pr.error = null; pr.ctl = new AbortController(); render();
    const transcript = shownTurns(pr).map(t => (t.role === 'user' ? 'ASSOCIATE: ' : 'THEM: ') + t.content.replace(/\s*END OF CALL\s*$/i, '')).join('\n');
    const prompt = 'You are a warm, direct real estate sales coach reviewing a role-play by a brand-new associate at ' + S.config.officeName + ' who is practising "' + pr.rp.title + '" (' + pr.rp.setting + '). The program\'s standard: courtesy first, a reason for the call, value before the ask, listen (why\'s that? tell me more), update details, the cash-buyer question where it fits, always offer two times, never burn a bridge.\n\nGOAL: ' + pr.rp.goal + '\n\nRUBRIC (score each 0, 1 or 2):\n' + pr.rp.rubric.map((r, i) => (i + 1) + '. ' + r).join('\n') + '\n\nTRANSCRIPT:\n' + transcript + '\n\nReply with ONLY a JSON object: {"scores":[{"criterion":"<rubric item, shortened>","score":0,"note":"<one short sentence>"}],"total":<sum>,"max":<2 x number of criteria>,"strengths":["<2-3 short items>"],"improve":["<2-3 short items>"],"oneThing":"<the single most useful change, one sentence>","wordForWord":"<one line the associate could say next time, in the same plain, courteous style>"}. Australian English, plain words, no em-dashes.';
    try {
      const f = await S.caps.sample.json(prompt, { modelTier: 'default', cache: false, signal: pr.ctl.signal });
      const scores = f && Array.isArray(f.scores) ? f.scores.filter(x => isObj(x)).map(x => ({ criterion: String(x.criterion || ''), note: String(x.note || ''), score: Math.max(0, Math.min(2, Math.round(Number(x.score)) || 0)) })) : [];
      if (scores.length) {
        const max = scores.length * 2; const total = scores.reduce((a, x) => a + x.score, 0);
        pr.feedback = { scores, max, total, strengths: [].concat(f.strengths || []).map(String).slice(0, 5), improve: [].concat(f.improve || []).map(String).slice(0, 5), oneThing: String(f.oneThing || ''), wordForWord: String(f.wordForWord || '') };
        const pct = Math.round(total / max * 100);
        setLearning(L => { L.practice = L.practice || { count: 0, scores: [] }; L.practice.count = (L.practice.count || 0) + 1; L.practice.lastAt = new Date().toISOString(); L.practice.scores = (L.practice.scores || []).concat([{ rp: pr.rp.id, pct, at: new Date().toISOString() }]).slice(-40); });
        if (pct >= 75) confetti();
      } else pr.error = 'The coach reply was not readable. Try again.';
    } catch (e) { if (!(e && e.code === 'cancelled')) pr.error = e && e.code === 'invalid_json' ? 'The coach reply was not readable. Try again.' : 'Could not get feedback right now. Try again.'; console.warn(e); }
    pr.busy = false; pr.ctl = null; render();
  }

  // ---------- Team (managers) ----------
  function associates() { return S.roster.filter(p => p.role !== 'manager' && p.role !== 'manager-pending'); }
  // Adds (or keeps) pid on the manager list with `email` on the Monday report list. `prev` is an address it replaces
  // (their previous profile email); the address recorded for them earlier is replaced too, unless another manager uses it.
  async function addManager(pid, email, prev) {
    const by = emailMap(); const ids = managerIds().filter(x => x !== pid).concat([pid]);
    const drop = new Set([lc(prev), lc(by[pid])]);
    for (const e of keptManagerEmails(ids.filter(x => x !== pid), by)) drop.delete(e);
    drop.add(lc(email)); drop.delete(''); // the new address is de-duplicated, then added once
    if (email) by[pid] = email; else delete by[pid];
    const emails = (S.config.managerEmails || []).filter(x => x && !drop.has(lc(x))).concat(email ? [email] : []);
    const cfg = Object.assign({}, S.config, { managerIds: ids, managerEmails: emails, managerEmailById: by, updatedAt: new Date().toISOString() });
    await db().doc('config/program').set(cfg); S.config = cfg;
  }
  // Takes pid off the manager list, with both their current email and the one recorded when they were added, plus any
  // addresses in `also` (typed into Program settings, ticked on the Remove sheet).
  async function removeManager(pid, email, also) {
    const by = emailMap(); const ids = managerIds().filter(x => x !== pid);
    const drop = new Set([lc(email), lc(by[pid])].concat((also || []).map(lc))); delete by[pid];
    for (const e of keptManagerEmails(ids, by)) drop.delete(e);
    drop.delete('');
    const cfg = Object.assign({}, S.config, { managerIds: ids, managerEmails: (S.config.managerEmails || []).filter(x => !drop.has(lc(x))), managerEmailById: by, updatedAt: new Date().toISOString() });
    await db().doc('config/program').set(cfg); S.config = cfg;
  }
  async function setBoardStatus(pid, status) {
    try { const b = await boardRef(pid).get(); if (b.exists) await boardRef(pid).update({ status, updatedAt: new Date().toISOString() }); } catch (e) { console.warn('board status', e); }
  }
  // The Team page can lag a snapshot behind: re-read the person before acting on a request, in case they have just
  // cancelled it (or it was already handled). Returns their current row, or null after telling Damian.
  async function stillRequesting(pid, name) {
    const cur = await db().doc('people/' + pid).get(); const d = cur.exists ? cur.data() : null; const r = d && d.role;
    if (r === 'manager-pending' || (r === 'manager' && !managerIds().includes(pid))) return d;
    toast(r === 'manager' ? firstName(name) + ' is already a manager.' : (r === 'associate' && d.declinedAt) ? firstName(name) + '\'s request is already declined.' : firstName(name) + ' has already changed their request, so nothing was changed.', 4000); render(); return null;
  }
  // One approve or decline at a time per request: the row stays on Team until the config write lands, so a second tap
  // would queue a second job. The buttons are swapped for a label until this job ends (or fails, so it can be retried).
  function handleRequest(pid, what, job) {
    if (S.ui.handling[pid]) return;
    S.ui.handling[pid] = what; render();
    chain(job).finally(() => { delete S.ui.handling[pid]; render(); });
  }
  function approveManager(pid) {
    const p = S.roster.find(x => x.id === pid); if (!p) return;
    // Role first, then config: a managerIds entry never points at a row that is still pending.
    handleRequest(pid, 'Approving', async () => {
      const cur = await stillRequesting(pid, p.name); if (!cur) return;
      await db().doc('people/' + pid).update({ role: 'manager', declinedAt: null, updatedAt: new Date().toISOString() }); await addManager(pid, cur.email); await setBoardStatus(pid, 'manager');
      toast(firstName(p.name) + ' is now a manager. Managers must be shared as Editor.', 5000); render();
    });
  }
  function declineManager(pid) {
    const p = S.roster.find(x => x.id === pid); if (!p) return;
    const now = new Date().toISOString();
    handleRequest(pid, 'Declining', async () => {
      const cur = await stillRequesting(pid, p.name); if (!cur) return;
      await db().doc('people/' + pid).update({ role: 'associate', status: 'left', declinedAt: now, updatedAt: now });
      if (managerIds().includes(pid)) await removeManager(pid, cur.email);
      await setBoardStatus(pid, 'left'); toast('Declined. If they are doing the program, set them Active on their page.', 5000);
    });
  }
  function requestsCard() {
    const reqs = S.roster.filter(p => p.role === 'manager-pending' || (p.role === 'manager' && p.id !== S.me.id && !managerIds().includes(p.id))); if (!reqs.length) return '';
    return '<div class="card warn"><p class="eyebrow">Manager requests</p>' + reqs.map(p => '<div class="item static stack-sm"><div><div class="t">' + esc(p.name) + '</div><div class="s">' + esc(p.email || 'no email') + '</div></div>' + (!S.me.isOwner ? '<span class="small muted">Damian approves</span>' : S.ui.handling[p.id] ? '<span class="small muted">' + esc(S.ui.handling[p.id]) + '</span>' : '<div class="row"><button class="btn sm primary" data-approve="' + esc(p.id) + '">Approve</button><button class="btn sm ghost" data-decline="' + esc(p.id) + '">Decline</button></div>') + '</div>').join('') + '</div>';
  }
  function managersCard() {
    if (!S.me.isOwner) return '';
    const mgrs = S.roster.filter(p => p.role === 'manager' && p.id !== S.me.id && managerIds().includes(p.id)); if (!mgrs.length) return '';
    return '<details class="lesson"><summary><div><strong>Managers</strong><div class="small muted">' + mgrs.map(p => esc(p.name)).join(', ') + '</div></div><span class="muted">›</span></summary><div class="body">' + mgrs.map(p => '<div class="item static stack-sm"><div><div class="t">' + esc(p.name) + '</div><div class="s">' + esc(p.email || 'no email') + '</div></div><button class="btn sm ghost" data-demote="' + esc(p.id) + '">Remove as manager</button></div>').join('') + '<p class="tiny muted">Removing a manager takes away the Team view and the Monday report. To remove their access to the page entirely, change their sharing too.</p></div></details>';
  }
  // Someone with program history (they have logged) goes back on the program; anyone else is marked 'left'.
  function demoteStatus(p) { return p.lastLogDate ? ((p.status && p.status !== 'left') ? p.status : 'active') : 'left'; }
  // Report addresses that stay on the list after removing pid and belong to no remaining manager: typed into Program settings,
  // so the app cannot tell whose they are. The Remove sheet lists them so Damian can take off any that are this person's.
  function strayAfterRemoving(pid, email) {
    const by = emailMap(); const gone = new Set([lc(email), lc(by[pid])]); const kept = keptManagerEmails(managerIds().filter(x => x !== pid), by);
    return (S.config.managerEmails || []).filter(x => lc(x) && !gone.has(lc(x)) && !kept.has(lc(x)));
  }
  function demoteManager(pid) {
    const p = S.roster.find(x => x.id === pid); if (!p) return;
    const st = demoteStatus(p); const stray = strayAfterRemoving(pid, p.email);
    const what = st === 'left' ? 'They have not logged any days, so they are set to status left: no daily emails and no Team pulse.' : 'They have logged days, so they go back on the program as an associate with status ' + st + '.';
    const also = stray.length ? '<p class="small">The Monday report also goes to ' + (stray.length === 1 ? 'this address. Tick it if it is ' : 'these addresses. Tick any that are ') + esc(firstName(p.name)) + '\'s, so the report stops going there too.</p>' + stray.map(e => '<label class="row" style="gap:10px"><input type="checkbox" class="demote-also" value="' + esc(e) + '" style="width:auto"> ' + esc(e) + '</label>').join('') : '';
    sheet('<h3>Remove ' + esc(p.name) + ' as a manager?</h3><p class="small">They lose the Team view, and their own address comes off the Monday report list. ' + what + '</p>' + also + '<p class="small muted">Their sharing on this page does not change. They keep seeing what their sharing allows until you change their sharing.</p><div class="row"><button class="btn primary" data-demote-yes="' + esc(pid) + '">Remove</button><button class="btn ghost" data-close="1">Cancel</button></div>', { noFocus: true });
  }
  function demoteConfirmed(pid) {
    const p = S.roster.find(x => x.id === pid); if (!p) return;
    const also = $$('.demote-also').filter(x => x.checked).map(x => x.value); closeSheet();
    const st = demoteStatus(p);
    // Role first, then config (as in approveManager): while the config write is in flight the row is already an associate,
    // so it never shows up as a new manager request.
    chain(async () => { await db().doc('people/' + pid).update({ role: 'associate', status: st, declinedAt: null, updatedAt: new Date().toISOString() }); await removeManager(pid, p.email, also); await setBoardStatus(pid, st); toast(firstName(p.name) + ' is no longer a manager' + (st === 'left' ? '' : '. They are back on the program')); });
  }
  function inviteMessage() {
    const me = firstName(S.person && S.person.name);
    return 'Hi [first name],\n\nWelcome to ' + S.config.officeName + '. Your 12-week Launchpad program is where you log your numbers each day and work through the training.\n\nOpen this link on your phone: ' + (S.config.appUrl || APP_URL_DEFAULT) + '\n\nSign in to claude.ai with this email address. If you have not had the office Claude invite yet, tell me before you sign up. Then set your start date and log your first day.\n\nAny questions, just ask.\n\n' + me;
  }
  function inviteCard() {
    return '<details class="lesson"><summary><div><strong>Invite an associate</strong><div class="small muted">Two steps, about a minute</div></div><span class="muted">›</span></summary><div class="body"><div class="prose"><p><strong>1. Share the page.</strong> Use the Share button at the top of this page and add their email.</p><ul><li>On your office\'s Claude team plan: share them as <strong>Contributor</strong>. They see their own data plus the Team pulse (totals, streaks, who logged today), unless you turn the pulse off in Program settings.</li><li>Using their own Claude account: share them as <strong>Editor</strong>, because Claude treats them as a guest and a guest Contributor can only view. Editor also lets them read every associate\'s numbers and the manager notes. Prefer adding them to the office Claude plan and sharing as Contributor.</li><li>Do not turn on "anyone with the link".</li></ul><p><strong>2. Send them this message.</strong></p></div><textarea id="invite-msg" rows="9" readonly>' + esc(inviteMessage()) + '</textarea><div class="row"><button class="btn primary sm" data-act="copy-invite">' + ICONS.copy + ' Copy message</button></div></div></details>';
  }
  function csvCell(v) { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  async function exportCsv() {
    const dl = S.caps.downloads; if (!dl) { toast('Downloads are not available here'); return; }
    toast('Preparing the spreadsheet');
    const people = associates();
    const loaded = await Promise.all(people.map(p => loadTeamDays(p.id, true)));
    if (loaded.some(c => !c || c.error)) { toast('Could not load everyone\'s days. Try again in a moment.'); return; }
    const rows = [['Name', 'Email', 'Start date', 'Status', 'Date', 'Geo data', 'Appraisals', 'Listings', 'Sessions', 'Calls', 'Connections', 'Appointments', 'Note']];
    people.forEach((p, i) => { const c = loaded[i] || { days: [] }; c.days.slice().sort((a, b) => a.date < b.date ? -1 : 1).forEach(d => rows.push([p.name, p.email, p.startDate, p.status || 'active', d.date, num(d.geo), num(d.appraisals), num(d.listings), num(d.sessions), num(d.calls), num(d.connections), num(d.appointments), d.note || ''])); });
    const csv = '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    try { await dl.save({ filename: 'launchpad-' + todayStr() + '.csv', data: csv }); toast('Spreadsheet saved'); }
    catch (e) { if (!(e && e.code === 'declined')) toast(e && (e.code === 'unavailable' || e.code === 'not_granted') ? 'Downloads are not available in this view' : 'Could not save the file'); }
  }
  function personFocusCard(c, snap) {
    // The associate only has a This week's three card while the program runs, so there is nothing to agree before or after it.
    if (snap.status === 'upcoming') return '<div class="card"><p class="eyebrow">This week\'s three</p><p class="small muted">Starts ' + esc(niceDate(snap.cal.start)) + '. They pick their first three once the program starts.</p></div>';
    if (snap.status !== 'active') return '<div class="card"><p class="eyebrow">This week\'s three</p><p class="small muted">The program has finished, so there are no weekly commitments to agree.</p></div>';
    const d = (c.weeks || {})[focusOf(snap.cal).key]; const items = d && Array.isArray(d.items) ? d.items : [];
    return '<div class="card"><p class="eyebrow">This week\'s three</p>' + (items.length ? '<ul style="margin:0;padding-left:18px">' + items.map(x => '<li>' + (x.done ? '<strong>Done:</strong> ' : '') + esc(x.text) + '</li>').join('') + '</ul>' : '<p class="small muted">Nothing picked yet this week. Agree three in the Monday meeting.</p>') + '</div>';
  }
  function managerHomeHtml() { return teamHtml(); }
  function loadTeamDays(pid, force) {
    const c = S.teamCache[pid]; if (c && !force && !c.error && Date.now() - c.at < 120000) return Promise.resolve(c);
    if (S.teamLoading[pid]) return S.teamLoading[pid];
    const p = (async () => {
      try {
        const [ds, ps, ls, cs, ws] = await Promise.all([db().collection('people/' + pid + '/days').get(), db().collection('people/' + pid + '/pipeline').get(), learnRef(pid).get(), coachRef(pid).get(), db().collection('people/' + pid + '/weeks').get()]);
        const weeks = {}; for (const d of ws.docs) weeks[d.id] = d.data();
        const entry = { at: Date.now(), personUpdatedAt: (S.roster.find(x => x.id === pid) || {}).updatedAt || null, days: ds.docs.map(d => d.data()).filter(d => d && d.date), pipeline: ps.docs.map(d => Object.assign({}, d.data(), { id: d.id })), learning: ls.exists ? normLearning(ls.data()) : defaultLearning(), notes: cs.exists ? String(cs.data().notes || '') : '', notesVersion: cs.exists, weeks };
        S.teamCache[pid] = entry; return entry;
      } catch (e) { console.warn('team load', e); const entry = { at: Date.now(), error: true, personUpdatedAt: (S.roster.find(x => x.id === pid) || {}).updatedAt || null, days: [], pipeline: [], learning: defaultLearning(), notes: '' }; S.teamCache[pid] = entry; return entry; }
      finally { delete S.teamLoading[pid]; }
    })();
    S.teamLoading[pid] = p; return p;
  }
  function teamHtml() {
    if (S.ui.teamPerson) return teamPersonHtml();
    const list = associates().filter(p => S.ui.teamFilter === 'all' || (p.status || 'active') === 'active');
    const rows = list.map(p => { const c = S.teamCache[p.id]; const snap = c ? snapFor(p, c.days) : null; return { p, snap, c }; });
    rows.sort((a, b) => { const oa = a.snap ? P.BAND_ORDER[a.snap.overall] : 9; const ob = b.snap ? P.BAND_ORDER[b.snap.overall] : 9; return oa - ob || a.p.name.localeCompare(b.p.name); });
    const loggedToday = rows.filter(r => r.snap && r.snap.loggedToday).length; const attention = rows.filter(r => r.snap && (r.snap.overall === 'behind' || r.snap.overall === 'slipping')).length;
    const parts = ['<div class="hero"><p class="eyebrow">' + esc(S.config.officeName) + ' · ' + esc(longDate(todayStr())) + '</p><h1>Team Launchpad</h1><div class="row"><span class="pill">' + list.length + ' associate' + (list.length === 1 ? '' : 's') + '</span><span class="pill ' + (loggedToday === list.length && list.length ? 'good' : 'muted') + '">' + loggedToday + ' logged today</span>' + (attention ? '<span class="pill warn">' + attention + ' need attention</span>' : '') + '</div></div>'];
    if (!S.rosterLoaded) parts.push('<div class="card">Loading the team…</div>');
    parts.push(requestsCard());
    parts.push(managersCard());
    if (S.rosterLoaded && !associates().length) parts.push('<div class="card"><h3>No associates yet</h3><p>Invite your first recruit below. When they open the link, they set their start date and appear here. Share with Luke as an <strong>Editor</strong>; he asks for manager access on first open and you approve it here.</p></div>');
    else if (associates().length) parts.push('<div class="row between"><div class="chips"><button class="chip" aria-pressed="' + (S.ui.teamFilter === 'active') + '" data-tfilter="active">Active</button><button class="chip" aria-pressed="' + (S.ui.teamFilter === 'all') + '" data-tfilter="all">Everyone</button></div><button class="btn sm ghost" data-act="team-refresh">Refresh</button></div>' + (list.length ? '<div class="roster">' + rows.map(r => personCard(r.p, r.snap, r.c)).join('') + '</div>' : '<div class="card"><p class="small">No active associates right now. Tap Everyone to see anyone paused, graduated or left.</p></div>'));
    parts.push(weeklyTeamCard(rows));
    parts.push(inviteCard());
    if (S.caps.downloads && associates().length) parts.push('<div class="card"><div class="row between"><div><p class="eyebrow">Records</p><p class="small">Every logged day for every associate, as a spreadsheet.</p></div><button class="btn sm" data-act="export-csv">Download CSV</button></div></div>');
    parts.push('<div class="card"><p class="eyebrow">How reminders and reports work</p><p class="small">Every working day at ' + esc(String(S.config.nudgeHour || 18)) + ':00 (' + esc(S.config.timezone) + ') an email goes to each active associate from Damian\'s Gmail: a nudge if nothing is logged, a pat on the back if they are on track, and the pace from here if they are behind. Monday mornings, managers get the team report. Emails go to the addresses in each profile and the manager list in Settings.</p><button class="btn sm" data-act="open-settings">Program settings</button></div>');
    return parts.join('');
  }
  function personCard(p, snap, c) {
    if (!snap) return '<button class="person" data-person="' + esc(p.id) + '"><div class="head"><div class="row no-wrap"><div class="avatar">' + esc(initials(p.name)) + '</div><div class="grow"><strong>' + esc(p.name) + '</strong><div class="small muted">' + (p.startDate ? 'Started ' + niceDate(p.startDate) : 'No start date') + '</div></div></div><span class="pill muted">Loading</span></div></button>';
    const last = p.lastLogDate ? daysAgo(p.lastLogDate) : null; const lastTxt = last == null ? 'never logged' : (last === 0 ? 'logged today' : last === 1 ? 'logged yesterday' : 'last log ' + last + ' days ago');
    return '<button class="person" data-person="' + esc(p.id) + '"><div class="head"><div class="row no-wrap"><div class="avatar">' + esc(initials(p.name)) + '</div><div class="grow"><strong>' + esc(p.name) + '</strong><div class="small muted">' + (snap.status === 'upcoming' ? 'Starts ' + niceDate(snap.cal.start) : snap.status === 'finished' ? 'Finished' : 'Week ' + snap.week + ' · day ' + snap.idx + ' of ' + snap.total) + ' · ' + lastTxt + (snap.streak ? ' · ' + snap.streak + ' day streak' : '') + '</div></div></div>' + bandPill(snap.overall) + '</div><div class="bars">' + barRow('Geo data', snap.metrics.geo) + barRow('Appraisals', snap.metrics.appraisals) + barRow('Listings', snap.metrics.listings) + '</div>' + (snap.status === 'active' && !snap.loggedToday && ((last != null && last >= 2) || (last == null && snap.idx >= 2)) ? '<span class="pill bad">' + (last == null ? 'Nothing logged yet' : last + ' days without a log') + '</span>' : '') + '</button>';
  }
  function weeklyTeamCard(rows) {
    const live = rows.filter(r => r.snap); if (!live.length) return '';
    const sum = k => live.reduce((s, r) => s + (r.snap.thisWeek[k] || 0), 0); const tot = k => live.reduce((s, r) => s + r.snap.metrics[k].actual, 0);
    return '<div class="card"><p class="eyebrow">This week, whole team</p><div class="kpis">' + kpi(sum('geo'), 'geo data this week') + kpi(sum('appraisals'), 'appraisals this week') + kpi(sum('listings'), 'listings this week') + kpi(sum('calls'), 'calls this week') + '</div><div class="sep"></div><div class="kpis">' + kpi(tot('geo'), 'geo data, program to date') + kpi(tot('appraisals'), 'appraisals to date') + kpi(tot('listings'), 'listings to date') + '</div></div>';
  }
  function teamPersonHtml() {
    const p = S.roster.find(x => x.id === S.ui.teamPerson); if (!p) { S.ui.teamPerson = null; return teamHtml(); }
    const c = S.teamCache[p.id]; const snap = c ? snapFor(p, c.days) : null;
    const head = '<button class="btn sm ghost" data-act="team-back">' + ICONS.back + ' Team</button>';
    if (!snap) return head + '<div class="card">Loading ' + esc(p.name) + '…</div>';
    const coach = coachSuggestions(snap, c);
    const recent = c.days.slice().sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 7);
    return head + progressFor(snap, c.days, c.pipeline, c.learning, p, true) +
      personFocusCard(c, snap) +
      '<div class="card info"><p class="eyebrow">Coaching prompts for the Monday meeting</p><ul style="margin:0;padding-left:18px">' + coach.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul><p class="small muted">Close the meeting with: Do you need any support? Can you do all that? Will you do all that?</p></div>' +
      // Notes sit under the numbers, not in a last column, so they wrap to the card on a phone instead of hiding off to the side.
      '<div class="card"><p class="eyebrow">Last 7 logged days</p><div class="table-wrap"><table><thead><tr><th>Day</th><th>Geo</th><th>Appr</th><th>List</th><th>Calls</th><th>Conn</th><th>Appt</th></tr></thead><tbody>' + (recent.length ? recent.map(d => '<tr><td>' + niceDate(d.date) + '</td><td class="num">' + num(d.geo) + '</td><td class="num">' + num(d.appraisals) + '</td><td class="num">' + num(d.listings) + '</td><td class="num">' + num(d.calls) + '</td><td class="num">' + num(d.connections) + '</td><td class="num">' + num(d.appointments) + '</td></tr>').join('') : '<tr><td colspan="7">Nothing logged yet.</td></tr>') + '</tbody></table></div>' +
      (recent.some(d => d.note) ? '<p class="eyebrow">Their notes</p>' + recent.filter(d => d.note).map(d => '<p class="small day-note"><strong>' + niceDate(d.date) + ':</strong> ' + esc(d.note) + '</p>').join('') : '') + '</div>' +
      '<div class="card"><p class="eyebrow">Manager notes (managers and anyone shared as Editor can see these)</p>' + (c.error ? '<p class="small" style="color:var(--bad)">Could not load this person\'s records, so notes are locked to keep the ones already saved. Try again in a moment.</p>' : '') + '<textarea id="mgr-notes" rows="4" placeholder="' + (c.error ? 'Notes did not load' : 'Checkpoint notes, agreed actions, stakes from the Monday Plan') + '"' + (c.error ? ' disabled' : '') + '>' + esc(c.error ? '' : (c.notes || '')) + '</textarea><div class="row">' + (c.error ? '<button class="btn sm" data-act="person-retry" data-pid="' + esc(p.id) + '">Try again</button>' : '<button class="btn primary sm" data-act="save-notes" data-pid="' + esc(p.id) + '">Save notes</button>') + '</div></div>' +
      '<div class="card"><p class="eyebrow">Settings for ' + esc(p.name) + '</p><div class="stack"><label class="f">Start date<input type="date" id="tp-start" value="' + esc(p.startDate || '') + '"></label><label class="f">Email for reminders<input type="email" id="tp-email" value="' + esc(p.email || '') + '"></label><label class="f">Farm area<input id="tp-farm" value="' + esc(p.farm || '') + '"></label><div class="row"><label class="f grow">Geo target<input type="number" id="tp-geo" value="' + esc((p.targets || {}).geo || S.config.targets.geo) + '"></label><label class="f grow">Appraisals<input type="number" id="tp-appr" value="' + esc((p.targets || {}).appraisals || S.config.targets.appraisals) + '"></label><label class="f grow">Listings<input type="number" id="tp-list" value="' + esc((p.targets || {}).listings || S.config.targets.listings) + '"></label></div><p class="tiny muted">A target left at the program default follows Program settings.</p><label class="f">Status<select id="tp-status">' + ['active', 'paused', 'graduated', 'left'].map(s => '<option ' + ((p.status || 'active') === s ? 'selected' : '') + '>' + s + '</option>').join('') + '</select></label><p class="tiny muted">Left takes them out of the program: no daily emails, no Team pulse, and a short note instead of the daily sheet. They keep seeing what their sharing allows until you change their sharing.</p>' + (S.me.isOwner ? '<label class="f">Role<select id="tp-role"><option value="associate" ' + (p.role !== 'manager' ? 'selected' : '') + '>Associate</option><option value="manager" ' + (p.role === 'manager' ? 'selected' : '') + '>Manager</option></select></label><p class="tiny muted">Managers must be shared as Editor.</p>' : '') + '<button class="btn primary" data-act="save-person" data-pid="' + esc(p.id) + '">Save settings</button></div></div>';
  }
  function coachSuggestions(snap, c) {
    const out = []; const m = snap.metrics; const r = snap.ratios; const L = c.learning || defaultLearning();
    if (snap.status === 'upcoming') return ['Program has not started. Agree the farm area, print the Daily Call Sheet and run the Week 1 role-play together before day one.'];
    if (!snap.loggedToday && snap.missedDays >= 2) out.push(snap.missedDays + ' working days not logged. Ask what is in the way of logging before you ask about numbers.');
    if (m.geo.band === 'behind' || m.geo.band === 'slipping') out.push('Geo data under the guide (' + m.geo.actual + ' vs about ' + Math.round(m.geo.guide) + '). Check: is the 30-name list prepared before each session? How many 45-minute sessions this week (' + snap.thisWeek.calls + ' calls logged)?');
    if (m.geo.band === 'ahead') out.push('Geo data ahead of the guide. Make sure every record is complete in the CRM (name, address, phone, settlement date where possible) and tagged Cold, Warm or Hot.');
    if (r.connectionRate != null && r.connectionRate < 35 && snap.sessionTotals.calls >= 40) out.push('Connection rate ' + r.connectionRate + '% (benchmark: 45 to 50%). Look at call times and list quality.');
    if (r.appointmentRate != null && r.appointmentRate < 8 && snap.sessionTotals.connections >= 30) out.push('Appointments per connection ' + r.appointmentRate + '%. Role-play the Two-Minute Close and the two-times offer.');
    if (m.appraisals.inPlay && (m.appraisals.band === 'behind' || m.appraisals.band === 'slipping')) out.push('Appraisals behind pace. Is the Street Appraisal Days calendar live? Drill the Doorstep Script with a stopwatch.');
    if (m.appraisals.actual >= 5 && snap.week >= 6 && m.listings.actual === 0) out.push('Appraisals are happening but no listing yet. Walk the pipeline: who is in the 1 to 2 month bucket and when were they last touched?');
    const due = (c.pipeline || []).filter(p => p.status === 'active' && p.nextTouch && p.nextTouch < todayStr()).length; if (due) out.push(due + ' pipeline touch' + (due > 1 ? 'es' : '') + ' overdue.');
    const wk = Math.max(1, Math.min(snap.week, snap.cal.weeks)); const weeks = CONTENT().weeks.filter(w => w.week <= wk); const unread = weeks.reduce((s, w) => s + w.lessons.filter(l => !L.lessonsRead[l.id]).length, 0);
    const fw = (c.weeks || {})[focusOf(snap.cal).key]; const fItems = fw && Array.isArray(fw.items) ? fw.items : [];
    // Weekly commitments and checkpoints only while the program runs (after the end, the week number stays clamped at the last week).
    const running = snap.status === 'active';
    if (running) { if (!fItems.length) out.push('No commitments picked for this week. Agree this week\'s three together.'); else if (fItems.some(x => !x.done) && new Date().getDay() >= 4) out.push(fItems.filter(x => !x.done).length + ' of this week\'s three still open. Which one gets done by Friday?'); }
    if (unread > 4) out.push(unread + ' lessons from the weeks so far are unread. Agree one lesson a day.');
    if (!(L.practice && L.practice.count)) out.push('No AI role-plays yet. Do one together in the meeting; it takes five minutes.');
    if (running && [4, 8, 12].includes(wk)) out.push('Week ' + wk + ' is a checkpoint. Run the Checkpoint Conversation from this week\'s lessons.');
    if (!out.length) out.push('On track. Ask what one ratio they want to lift next week and what stake they put on it (Monday Plan).');
    return out;
  }
  function openSettingsSheet() {
    const c = S.config;
    sheet('<h3>Program settings</h3><p class="small muted">Defaults for every associate. Individual targets can be changed on their page.</p><div class="row"><label class="f grow">Geo data<input type="number" id="cf-geo" value="' + esc(c.targets.geo) + '"></label><label class="f grow">Appraisals<input type="number" id="cf-appr" value="' + esc(c.targets.appraisals) + '"></label><label class="f grow">Listings<input type="number" id="cf-list" value="' + esc(c.targets.listings) + '"></label></div>' +
      '<label class="f">Weeks<input type="number" id="cf-weeks" value="' + esc(c.weeks) + '" min="4" max="26"></label><p class="eyebrow">Working days</p><div class="chips" id="cf-days">' + [1, 2, 3, 4, 5, 6, 0].map(d => '<button type="button" class="chip" data-v="' + d + '" aria-pressed="' + (c.workDays.includes(d)) + '">' + DOW[d] + '</button>').join('') + '</div>' +
      '<label class="f">Office name<input id="cf-office" value="' + esc(c.officeName) + '"></label><label class="f">Manager emails for the Monday report (comma separated)<input id="cf-managers" value="' + esc((c.managerEmails || []).join(', ')) + '"></label>' +
      '<label class="row" style="gap:10px;font-weight:600"><input type="checkbox" id="cf-board" style="width:auto" ' + (c.teamBoard !== false ? 'checked' : '') + '> Show the Team pulse card to associates</label><p class="tiny muted">Associates see each other\'s names, totals and streaks. Notes, pipelines and quiz scores are not on the card; managers and anyone shared as Editor can see those.</p>' +
      '<label class="f">Daily reminder hour (24h, ' + esc(c.timezone) + ')<input type="number" id="cf-hour" min="0" max="23" value="' + esc(c.nudgeHour) + '"></label><p class="tiny muted">Changing the reminder hour here records your preference; ask Claude to move the scheduled task to match.</p>' +
      '<div class="row"><button class="btn primary" data-act="save-config">Save</button><button class="btn ghost" data-close="1">Cancel</button></div>', { noFocus: true });
    S.ui.cfShown = cfForm();
  }
  function cfForm() {
    const days = $$('#cf-days .chip[aria-pressed="true"]').map(b => Number(b.dataset.v)).sort();
    return { geo: Number($('#cf-geo').value) || 300, appraisals: Number($('#cf-appr').value) || 30, listings: Number($('#cf-list').value) || 3, weeks: Number($('#cf-weeks').value) || 12, workDays: days.length ? days : [1, 2, 3, 4, 5], officeName: $('#cf-office').value.trim() || 'Ray White Mildura', managerEmails: $('#cf-managers').value.split(',').map(s => s.trim()).filter(Boolean), nudgeHour: Number($('#cf-hour').value), teamBoard: !!($('#cf-board') && $('#cf-board').checked) };
  }
  // Only the fields changed in the sheet are written, onto the config as it is when the write runs, so a sheet left open does not
  // undo another manager's change (or this page's own queued approve or remove). Report addresses typed in or taken out are
  // applied to the current list.
  function saveConfig() {
    const now = cfForm(); const shown = S.ui.cfShown || now; closeSheet();
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    chain(async () => {
      const cfg = Object.assign({}, S.config, { targets: Object.assign({}, S.config.targets) });
      for (const k of ['geo', 'appraisals', 'listings']) if (now[k] !== shown[k]) cfg.targets[k] = now[k];
      for (const k of ['weeks', 'workDays', 'officeName', 'nudgeHour', 'teamBoard']) if (!same(now[k], shown[k])) cfg[k] = now[k];
      const was = shown.managerEmails.map(lc); const is = now.managerEmails.map(lc);
      if (!same(was, is)) {
        const emails = (S.config.managerEmails || []).filter(x => !(was.includes(lc(x)) && !is.includes(lc(x))));
        for (const e of now.managerEmails) if (!was.includes(lc(e)) && !emails.some(x => lc(x) === lc(e))) emails.push(e);
        cfg.managerEmails = emails;
      }
      cfg.updatedAt = new Date().toISOString();
      await db().doc('config/program').set(cfg); S.config = cfg; toast('Settings saved'); render();
    });
  }
  function savePersonSettings(pid) {
    const start = $('#tp-start').value; if (!P.parseDate(start)) { toast('Start date needed'); return; }
    const p = S.roster.find(x => x.id === pid) || {};
    const patch = { startDate: start, email: $('#tp-email').value.trim(), farm: $('#tp-farm').value.trim(), status: $('#tp-status').value, updatedAt: new Date().toISOString() };
    // Only a target that differs from the program default is stored for the person; the others are written as null, so they keep
    // following Program settings (and an override saved earlier is cleared, since update() merges into the stored targets).
    const def = Object.assign({}, P.DEFAULT_TARGETS, S.config.targets); const want = { geo: Number($('#tp-geo').value), appraisals: Number($('#tp-appr').value), listings: Number($('#tp-list').value) };
    const own = {}; const eff = {};
    for (const m of ['geo', 'appraisals', 'listings']) { const v = want[m] > 0 ? want[m] : Number(def[m]); own[m] = v !== Number(def[m]) ? v : null; eff[m] = v; }
    patch.targets = Object.values(own).some(v => v != null) ? own : null;
    const roleSel = $('#tp-role'); if (roleSel && S.me.isOwner) patch.role = roleSel.value;
    const promoting = patch.role === 'manager' && p.role !== 'manager';
    // A decline notice is stale once a manager has acted on the person again (set them back in the program, or made them a manager).
    if (p.declinedAt && (patch.status !== 'left' || patch.role === 'manager')) patch.declinedAt = null;
    const mgr = (patch.role || p.role) === 'manager';
    chain(async () => {
      await db().doc('people/' + pid).update(patch);
      // Promotion, or a manager's email edited here: put the new address on the Monday report list in place of the old one.
      if (mgr && (p.role !== 'manager' || !managerIds().includes(pid) || (patch.email && lc(patch.email) !== lc(p.email)))) await addManager(pid, patch.email || p.email, p.email);
      if (patch.role === 'associate' && (p.role === 'manager' || managerIds().includes(pid))) await removeManager(pid, p.email);
      // A manager's board row is marked 'manager' so the Team pulse (active rows only) drops it; demoting puts the person's status back.
      const boardStatus = (patch.role || p.role) === 'manager' ? 'manager' : patch.status;
      try { const b = await boardRef(pid).get(); if (b.exists) await boardRef(pid).update({ status: boardStatus, targets: eff, updatedAt: patch.updatedAt }); } catch (e) { console.warn('board update', e); }
      toast(promoting ? 'Saved. Managers must be shared as Editor.' : 'Saved', promoting ? 5000 : 0);
    });
  }

  // ---------- Profile ----------
  function meHtml() {
    const p = S.person; const canEditStart = isManager() || !S.days.length;
    return '<div class="hero"><p class="eyebrow">Profile</p><h1>' + esc(p.name) + '</h1><div class="row"><span class="pill">' + (p.role === 'manager' ? 'Manager' : p.role === 'manager-pending' ? 'Manager (awaiting approval)' : 'Associate') + '</span>' + (p.role === 'associate' && p.startDate ? '<span class="pill muted">Started ' + niceDate(p.startDate) + '</span>' : '') + '</div></div>' +
      '<div class="card"><div class="stack"><label class="f">Name<input id="me-name" value="' + esc(p.name) + '"></label><label class="f">Email for reminders and reports<input id="me-email" type="email" value="' + esc(p.email || '') + '"></label>' + (p.role === 'associate' ? '<label class="f">Farm area<input id="me-farm" value="' + esc(p.farm || '') + '"></label><label class="f">Program start date' + (canEditStart ? '' : ' <span class="muted">(ask a manager to change this once you have logged days)</span>') + '<input type="date" id="me-start" value="' + esc(p.startDate || '') + '" ' + (canEditStart ? '' : 'disabled') + '></label>' : '') + '<button class="btn primary" data-act="save-me">Save</button></div></div>' +
      '<div class="card"><p class="eyebrow">About Launchpad</p><p class="small">Built for ' + esc(S.config.officeName) + ' across six modules: Database Foundations, The Doorstep Appraisal, Pipeline Rhythm, The 30-Day Trust Plan, Neighbourhood Campaigns and The Scoreboard. Three numbers in twelve weeks: ' + S.config.targets.geo + ' geo data, ' + S.config.targets.appraisals + ' appraisals, ' + S.config.targets.listings + ' listings.</p><p class="small muted">Geo data: one new contact record from your farm (owner name, phone or email, address) in the CRM. Appraisal: a curbside or walk-through with an action plan and a pipeline category. Listing: signed and live.</p></div>' +
      (p.role === 'manager' ? '<div class="card"><p class="eyebrow">Sharing</p><p class="small">Use the Share button on this page. Associates on the office Claude plan: Contributor. Managers: Editor. Associates using their own Claude account need Editor, because a guest Contributor can only view. Editor also lets them read every associate\'s numbers and the manager notes. Prefer adding them to the office Claude plan and sharing as Contributor.</p><p class="small">Anyone shared as Viewer can read but cannot log. New managers ask for access on first open and Damian approves them on the Team page. A manager shared as Contributor cannot open the Team view.</p></div>' : '');
  }
  function saveMe() {
    const patch = { name: $('#me-name').value.trim() || S.person.name, email: $('#me-email').value.trim(), updatedAt: new Date().toISOString() };
    if (isManager() && patch.email && lc(patch.email) !== lc(S.person.email)) { const prev = S.person.email; chain(() => addManager(S.me.id, patch.email, prev)); }
    if ($('#me-farm')) patch.farm = $('#me-farm').value.trim();
    if ($('#me-start') && !$('#me-start').disabled && P.parseDate($('#me-start').value)) patch.startDate = $('#me-start').value;
    const renamed = patch.name !== S.person.name;
    chain(async () => {
      await myRef().update(patch); toast('Saved');
      if (!isManager() && boardOn() && renamed) { try { const b = await boardRef(S.me.id).get(); if (b.exists) await boardRef(S.me.id).update({ name: patch.name, updatedAt: patch.updatedAt }); } catch (e) { console.warn('board name', e); } }
    });
  }

  // ---------- Events ----------
  function bindGlobal() {
    document.addEventListener('click', onClick);
    document.addEventListener('submit', e => { if (e.target.id === 'onb') { e.preventDefault(); submitOnboarding(e.target); } });
    document.addEventListener('input', e => {
      if (e.target.id === 'day-note') { if (S.draft && S.daysLoaded) { S.draft.note = e.target.value; S.dirty = true; S.draftRev = (S.draftRev || 0) + 1; scheduleSave(); } }
      if (e.target.id === 'scripts-q') { S.ui.scriptsQuery = e.target.value; render(); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'focus-in') { e.preventDefault(); focusAdd(e.target.value); return; } if (e.key === 'Escape') closeSheet(); if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'chat-in') { e.preventDefault(); sendChat(); } });
    document.addEventListener('toggle', e => { const d = e.target; if (d.matches && d.matches('details.lesson[data-lesson]')) S.ui.openLesson = d.open ? d.dataset.lesson : null; if (d.matches && d.matches('details.calls')) S.ui.callsOpen = d.open; }, true);
    const flush = () => { if (S.dirty) saveDay(false); };
    window.addEventListener('beforeunload', flush); window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else if (S.person && !isManager()) rollDate(); });
    setInterval(() => { if (S.person && !isManager() && document.visibilityState === 'visible') rollDate(); }, 60000);
  }
  function onClick(e) {
    const t = e.target.closest('[data-nav],[data-step],[data-act],[data-logdate],[data-week],[data-read],[data-drill],[data-qpick],[data-stab],[data-scat],[data-open-script],[data-open-template],[data-copy-script],[data-copy-template],[data-practice],[data-person],[data-tfilter],[data-pipe],[data-touch],[data-pstatus],[data-chart],[data-learn-week],[data-close],[data-role],[data-focus-add],[data-focus-tick],[data-focus-remove],[data-approve],[data-decline],[data-demote],[data-demote-yes],.chips [data-v],[data-close]');
    if (!t || t.classList.contains('backdrop')) return;
    const d = t.dataset;
    if (t.matches('.chip[data-role]')) { $$('.chip[data-role]').forEach(b => b.setAttribute('aria-pressed', b === t)); const a = $('#onb-assoc'); if (a) a.hidden = d.role !== 'associate'; return; }
    if (t.matches('.chips [data-v]') && t.closest('[data-group], #cf-days')) { const multi = !!t.closest('#cf-days'); if (multi) t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') !== 'true'); else { $$('.chip', t.parentElement).forEach(b => b.setAttribute('aria-pressed', b === t)); } return; }
    if (d.nav) { if (d.nav === 'more') { openMore(); return; } if (d.close) closeSheet(); if (d.nav === 'team') S.ui.teamPerson = null; go(d.nav); return; }
    if (d.step) { step(d.step, Number(d.n)); return; }
    if (d.logdate) { setLogDate(d.logdate); return; }
    if (d.learnWeek) { S.ui.learnWeek = Number(d.learnWeek); ls.set('lp.learnWeek', S.ui.learnWeek); go('learn'); return; }
    if (d.week) { S.ui.learnWeek = Number(d.week); ls.set('lp.learnWeek', S.ui.learnWeek); S.ui.quiz = null; render(); window.scrollTo(0, 0); return; }
    if (d.read) { setLearning(L => { if (L.lessonsRead[d.read]) delete L.lessonsRead[d.read]; else L.lessonsRead[d.read] = new Date().toISOString(); }); return; }
    if (d.drill) { setLearning(L => { if (L.drillsDone[d.drill]) delete L.drillsDone[d.drill]; else L.drillsDone[d.drill] = new Date().toISOString(); }); return; }
    if (d.qpick != null) { quizPick(Number(d.qpick)); return; }
    if (d.stab) { S.ui.scriptsTab = d.stab; S.ui.scriptsCat = 'all'; render(); return; }
    if (d.scat) { S.ui.scriptsCat = d.scat; render(); return; }
    if (d.openScript) { S.ui.scriptsTab = 'scripts'; S.ui.scriptsCat = 'all'; S.ui.scriptsQuery = ''; S.ui.openScript = d.openScript; go('scripts'); setTimeout(() => { const el = $('#script-' + CSS.escape(d.openScript)); if (el) el.scrollIntoView({ block: 'start' }); }, 50); return; }
    if (d.openTemplate) { openTemplateSheet(d.openTemplate); return; }
    if (d.copyScript) { const s = CONTENT().scripts.find(x => x.id === d.copyScript); if (s) copyText(scriptText(s)); return; }
    if (d.copyTemplate) { const s = CONTENT().templates.find(x => x.id === d.copyTemplate); if (s) copyText(templateText(s)); return; }
    if (d.practice) { closeSheet(); startPractice(d.practice); return; }
    if (d.person) { S.ui.teamPerson = d.person; render(); loadTeamDays(d.person).then(render); window.scrollTo(0, 0); return; }
    if (d.tfilter) { S.ui.teamFilter = d.tfilter; render(); return; }
    if (d.pipe) { openPipelineItem(d.pipe); return; }
    if (d.touch) { touchPipeline(d.touch); if (d.close) closeSheet(); return; }
    if (d.pstatus) { setPipelineStatus(d.pid, d.pstatus); return; }
    if (d.chart) { S.ui.chartMetric = d.chart; render(); return; }
    if (d.focusAdd != null) { focusAdd(d.focusAdd); return; }
    if (d.focusTick != null) { focusTick(Number(d.focusTick)); return; }
    if (d.focusRemove != null) { focusRemove(Number(d.focusRemove)); return; }
    if (d.approve) { approveManager(d.approve); return; }
    if (d.decline) { declineManager(d.decline); return; }
    if (d.demote) { demoteManager(d.demote); return; }
    if (d.demoteYes) { demoteConfirmed(d.demoteYes); return; }
    if (d.act) { action(d.act, d); return; }
    if (d.close) { closeSheet(); return; }
  }
  function action(a, d) {
    switch (a) {
      case 'done': saveDay(true); break;
      case 'pick-date': openDatePicker(); break;
      case 'pick-date-go': setLogDate($('#pick-date').value); break;
      case 'save-appraisal': saveAppraisal(); break;
      case 'save-listing': saveListing(); break;
      case 'save-pl-notes': { const v = $('#pl-notes').value; chain(async () => { await db().doc('people/' + S.me.id + '/pipeline/' + d.pid).update({ notes: v }); closeSheet(); toast('Notes saved'); }); break; }
      case 'quiz-start': S.ui.quiz = { week: Number(d.qweek), i: 0, answers: [], picked: null }; S.ui.focusAfter = '[data-qpick="0"]'; render(); break;
      case 'quiz-next': quizNext(); break;
      case 'quiz-close': S.ui.quiz = null; S.ui.focusAfter = '#view [data-act="quiz-start"]'; render(); break;
      case 'practice-exit': if (S.ui.practice && S.ui.practice.ctl) S.ui.practice.ctl.abort(); S.ui.practice = null; render(); break;
      case 'practice-script': { const s = CONTENT().scripts.find(x => x.id === S.ui.practice.rp.scriptId); if (s) sheet('<h3>' + esc(s.title) + '</h3><div>' + s.steps.map(b => '<div class="beat"><div class="lab">' + esc(b.label || '') + '</div><div class="line">' + esc(b.line) + '</div></div>').join('') + '</div><div class="sheet-actions"><button class="btn block" data-close="1">Back to the call</button></div>', { noFocus: true }); break; }
      case 'chat-send': sendChat(); break;
      case 'chat-stop': if (S.ui.practice && S.ui.practice.ctl) S.ui.practice.ctl.abort(); break;
      case 'practice-feedback': practiceFeedback(); break;
      case 'team-back': S.ui.teamPerson = null; render(); break;
      case 'team-refresh': associates().forEach(p => loadTeamDays(p.id, true).then(render)); toast('Refreshing'); break;
      case 'open-settings': openSettingsSheet(); break;
      case 'save-config': saveConfig(); break;
      case 'person-retry': loadTeamDays(d.pid, true).then(render); toast('Loading'); break;
      case 'save-notes': { const c = S.teamCache[d.pid]; if (!c || c.error) { toast('Notes did not load. Try again before saving.', 4000); break; } const v = $('#mgr-notes').value; chain(async () => { await coachRef(d.pid).set({ notes: v, updatedAt: new Date().toISOString(), by: S.me.id }); if (S.teamCache[d.pid]) S.teamCache[d.pid].notes = v; toast('Notes saved'); }); break; }
      case 'save-person': savePersonSettings(d.pid); break;
      case 'save-me': saveMe(); break;
      case 'focus-add-own': focusAdd(($('#focus-in') || {}).value); break;
      case 'copy-invite': copyText(inviteMessage()); break;
      case 'export-csv': exportCsv(); break;
      case 'cancel-request': if (S.person && S.person.role === 'manager-pending') sheet('<h3>Switch to the associate program?</h3><p class="small">This cancels your manager request and sets you up to log your days as an associate. If you need manager access later, Damian can switch you back from your page on the Team view.</p><div class="row"><button class="btn primary" data-act="cancel-request-yes">Switch</button><button class="btn ghost" data-close="1">Cancel</button></div>'); break;
      case 'cancel-request-yes': closeSheet(); if (S.person && S.person.role === 'manager-pending') chain(async () => { await myRef().update({ role: 'associate', updatedAt: new Date().toISOString() }); toast('Set up as an associate. Check your start date in Profile.'); }); break;
    }
  }
  function openMore() {
    const items = isManager() ? [NAV[6]] : [NAV[4], NAV[6]];
    sheet('<h3>More</h3><div class="list">' + items.map(n => '<button class="item" data-nav="' + n.id + '" data-close="1"><div class="row">' + ICONS[n.icon] + '<div class="t">' + n.label + '</div></div><span class="muted">›</span></button>').join('') + '</div>');
  }
  function afterRender() {
    if (S.view === 'team' && isManager() && S.rosterLoaded) { for (const p of associates()) { const c = S.teamCache[p.id]; if (!S.teamLoading[p.id] && (!c || c.personUpdatedAt !== (p.updatedAt || null))) loadTeamDays(p.id, !!c).then(() => { if (S.view === 'team') render(); }); } }
    if (S.view === 'practice' && S.ui.practice) { const chat = $('#chat'); if (chat) chat.scrollTop = chat.scrollHeight; }
  }
  if (window.claude && window.claude.use) boot(); else { S.caps.signedOut = true; S.caps.ready = true; render(); }
})();
