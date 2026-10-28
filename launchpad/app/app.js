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
    caps: { db: null, user: null, sample: null, ready: false, signedOut: false },
    me: { id: null, name: '', email: '', isOwner: false, canEdit: false, canWrite: null },
    config: { officeName: 'Ray White Mildura', programName: 'Launchpad', targets: { geo: 300, appraisals: 30, listings: 3 }, weeks: 12, workDays: [1, 2, 3, 4, 5], managerEmails: [], nudgeHour: 18, timezone: 'Australia/Melbourne' },
    configLoaded: false, person: null, personLoaded: false, days: [], pipeline: [], learning: null,
    roster: [], rosterLoaded: false, teamCache: {}, teamLoading: {}, saveFailed: false, busy: 0, daysLoaded: false, daysError: false, learnDirty: false, learnRev: 0, logPinned: false,
    view: 'today', logDate: todayStr(), draft: null, dirty: false, saving: null, saveTimer: null, learnTimer: null,
    ui: { learnWeek: null, quiz: null, practice: null, teamPerson: null, scriptsTab: 'scripts', scriptsQuery: '', scriptsCat: 'all', openScript: null, teamFilter: 'active', confetti: null },
    unsubs: [],
  };
  const VIEWS = ['today', 'progress', 'learn', 'practice', 'scripts', 'team', 'me'];
  const NAV = [
    { id: 'today', label: 'Today', icon: 'today' }, { id: 'progress', label: 'Progress', icon: 'progress' },
    { id: 'learn', label: 'Learn', icon: 'learn' }, { id: 'practice', label: 'Practice', icon: 'practice' },
    { id: 'scripts', label: 'Scripts', icon: 'scripts' }, { id: 'team', label: 'Team', icon: 'team', managers: true }, { id: 'me', label: 'Profile', icon: 'me' },
  ];
  const isManager = () => !!(S.me.canEdit && S.person && S.person.role === 'manager');
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
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.body.style.overflow = 'hidden';
    if (opts && opts.onOpen) opts.onOpen(root);
    const f = $('input,textarea,button', sh); if (f && !(opts && opts.noFocus)) setTimeout(() => f.focus(), 50);
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
  const coachRef = pid => db().doc('coaching/' + pid);
  function writeFail(e) {
    console.error(e);
    const code = e && e.code;
    if (code === 'invalid_argument') toast('Could not save. Ask Damian to share this with you as a Contributor.', 5000);
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
    const [dbc, userc, samplec] = await Promise.all([window.claude.use('db'), window.claude.use('user'), window.claude.use('sample')]);
    S.caps.db = dbc; S.caps.user = userc; S.caps.sample = samplec;
    if (!dbc || !userc) { S.caps.signedOut = true; S.caps.ready = true; render(); return; }
    const me = await userc.me(); S.me = { id: me.id, name: me.name || '', email: me.email || '', isOwner: !!me.isOwner, canEdit: !!me.canEdit, canWrite: null };
    try { S.me.canWrite = await userc.can('data.write'); } catch (e) { S.me.canWrite = null; }
    if (!me.id) { S.caps.signedOut = true; S.caps.ready = true; render(); return; }
    try { const c = await db().doc('config/program').get(); if (c.exists) Object.assign(S.config, c.data()); } catch (e) { console.warn('config', e); }
    S.configLoaded = true;
    S.unsubs.push(db().doc('config/program').onSnapshot(snap => { if (snap.exists) { Object.assign(S.config, snap.data()); render(); } }, e => console.warn(e)));
    S.unsubs.push(myRef().onSnapshot(snap => {
      S.person = snap.exists ? snap.data() : null; S.personLoaded = true; S.caps.ready = true;
      if (S.person && !S.unsubs.personal) subscribePersonal();
      if (isManager()) subscribeRoster();
      render();
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
    S.unsubs.push(learnRef(S.me.id).onSnapshot(snap => { if (S.learnDirty) return; S.learning = snap.exists ? normLearning(snap.data()) : defaultLearning(); render(); }, e => console.error(e)));
    if (isManager()) subscribeRoster();
  }
  function subscribeRoster() {
    if (S.unsubs.roster) return; S.unsubs.roster = true;
    S.unsubs.push(db().collection('people').onSnapshot(qs => { S.roster = qs.docs.map(d => Object.assign({}, isObj(d.data()) ? d.data() : {}, { id: d.id })); S.rosterLoaded = true; render(); }, e => console.error(e)));
  }
  function route() {
    const h = (location.hash || '').replace('#', '');
    const v = VIEWS.includes(h) ? h : 'today';
    if (v === 'team' && !isManager()) { S.view = 'today'; } else S.view = v;
    if (S.view !== 'practice' && S.ui.practice && S.ui.practice.ctl) { try { S.ui.practice.ctl.abort(); } catch (e) { } }
    render(); window.scrollTo(0, 0);
    const hd = $('#view h1, #view h2'); if (hd) announce(hd.textContent);
  }
  function go(v) { if (location.hash !== '#' + v) location.hash = '#' + v; else { S.view = v; render(); } }

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
    else if (!S.person) html = onboardingHtml();
    else {
      switch (S.view) {
        case 'today': html = isManager() ? managerHomeHtml() : todayHtml(); break;
        case 'progress': html = isManager() ? managerHomeHtml() : progressHtml(); break;
        case 'learn': html = learnHtml(); break;
        case 'practice': html = practiceHtml(); break;
        case 'scripts': html = scriptsHtml(); break;
        case 'team': html = isManager() ? teamHtml() : todayHtml(); break;
        case 'me': html = meHtml(); break;
        default: html = todayHtml();
      }
    }
    el.innerHTML = html;
    for (const id of Object.keys(keep)) { const f = document.getElementById(id); if (f) { if (f.type === 'checkbox') f.checked = keep[id]; else f.value = keep[id]; } }
    if (key) { const f = $(key); if (f && f !== document.activeElement) { try { f.focus({ preventScroll: true }); if (sel && typeof f.setSelectionRange === 'function' && (f.tagName === 'TEXTAREA' || /^(text|search|url|tel|password)$/.test(f.type))) f.setSelectionRange(sel[0], sel[1]); } catch (e) { } } }
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
  function loadingHtml() { return '<div class="card"><h1>Signing you in</h1><p class="muted">One moment.</p></div>'; }
  function signedOutHtml() {
    return '<div class="card"><div class="brand"><div class="mark">3</div><div><div class="name">Launchpad</div><div class="sub">300 geo data · 30 appraisals · 3 listings</div></div></div>' +
      '<h1>Sign in to open your Launchpad</h1><p>This page keeps your daily numbers and your progress, so it needs to know who you are. Open the link while signed in to claude.ai with the account Damian invited. If you have not been invited yet, ask Damian or Luke to share the Launchpad link with you.</p>' +
      '<p class="muted small">Already signed in and still seeing this? Refresh the page once. If it persists, the link may have been shared as view-only.</p></div>';
  }

  // ---------- Onboarding ----------
  function onboardingHtml() {
    const canManage = S.me.canEdit;
    return '<div class="card"><div class="brand"><div class="mark">3</div><div><div class="name">Launchpad</div><div class="sub">' + esc(S.config.officeName) + '</div></div></div>' +
      '<h1>Welcome. Let\'s set up your 90 days.</h1>' +
      '<p>Three numbers, twelve weeks: <strong>300 geo data</strong>, <strong>30 appraisals</strong>, <strong>3 listings</strong>. You log your day in under a minute, the app shows you the pace from here, and your managers see the same picture.</p>' +
      '<form id="onb" class="stack">' +
      (canManage ? '<div class="chips" role="radiogroup" aria-label="Your role"><button type="button" class="chip" data-role="manager" aria-pressed="true">I\'m a manager (Damian or Luke)</button><button type="button" class="chip" data-role="associate" aria-pressed="false">I\'m doing the program</button></div>' : '') +
      '<label class="f">Your name<input id="onb-name" required value="' + esc(S.me.name) + '" placeholder="First and last name"></label>' +
      '<label class="f">Email for reminders and reports<input id="onb-email" type="email" value="' + esc(S.me.email) + '" placeholder="you@raywhite.com"></label>' +
      '<div id="onb-assoc" class="stack"' + (canManage ? ' hidden' : '') + '>' +
      '<label class="f">Program start date<input id="onb-start" type="date" value="' + todayStr() + '" required></label>' +
      '<label class="f">Your farm area (suburb or streets)<input id="onb-farm" placeholder="e.g. Mildura South, Deakin Ave to Fifteenth St"></label>' +
      '<p class="small muted">Your 60 working days run Monday to Friday from the start date. Weekend work still counts; log it on the day.</p></div>' +
      '<button class="btn primary big block" type="submit">Start</button></form></div>';
  }
  async function submitOnboarding(form) {
    const role = (S.me.canEdit && ($('.chip[aria-pressed="true"]', form) || {}).dataset || {}).role || 'associate';
    const name = $('#onb-name').value.trim(); if (!name) { toast('Enter your name'); return; }
    const email = $('#onb-email').value.trim();
    const startDate = role === 'associate' ? $('#onb-start').value : todayStr();
    if (role === 'associate' && !P.parseDate(startDate)) { toast('Pick a start date'); return; }
    const doc = { id: S.me.id, name, email, role, startDate, farm: role === 'associate' ? $('#onb-farm').value.trim() : '', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastLogDate: null, summary: null };
    const btn = $('button[type=submit]', form); btn.disabled = true;
    try { await myRef().set(doc); await learnRef(S.me.id).set(defaultLearning()); toast('Welcome aboard'); }
    catch (e) { writeFail(e); btn.disabled = false; }
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
      '<details ' + ((d.calls || d.connections || d.appointments || d.sessions) ? 'open' : '') + '><summary class="row between" style="cursor:pointer;list-style:none"><strong>Call sessions</strong><span class="small muted">calls · connections · appointments</span></summary><div class="mini-steppers" style="margin-top:10px">' +
      mini('sessions', '45-min sessions', d.sessions, 1) + mini('calls', 'Calls', d.calls, 5) + mini('connections', 'Connections', d.connections, 1) + mini('appointments', 'Appointments', d.appointments, 1) + '</div>' +
      '<p class="tiny muted" style="margin-top:8px">Jess\'s benchmark per 45-minute session: 18 to 24 calls, 8 to 12 connections, 1 to 3 appointments.</p></details>' +
      '<label class="f">One line about today<textarea id="day-note" rows="2" placeholder="A win, a lesson, or what got in the way">' + esc(d.note || '') + '</textarea></label>' +
      '<button class="btn primary big block" data-act="done">' + (d.closed ? 'Update today' : 'Done for today') + '</button>' +
      '<p class="tiny muted" id="save-state">' + (S.saveFailed ? 'Not saved. Tap a number again to retry.' : S.dirty ? 'Saving…' : (d.updatedAt ? 'Saved ' + esc(new Date(d.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : 'Numbers save as you go.')) + '</p></div>');
    // pace strip
    const g = snap.metrics.geo, a = snap.metrics.appraisals, l = snap.metrics.listings;
    parts.push('<div class="card soft"><p class="eyebrow">Your pace from here</p><div class="bars">' + barRow('Geo data', g) + barRow('Appraisals', a) + barRow('Listings', l) + '</div>' +
      '<p class="small">' + esc(paceSentence(snap)) + '</p><button class="btn sm" data-nav="progress">See the full picture</button></div>');
    parts.push(learnTeaser(Math.min(Math.max(snap.week, 1), S.config.weeks)));
    parts.push(practiceTeaser(Math.min(Math.max(snap.week, 1), S.config.weeks)));
    parts.push(pipelineDue());
    return parts.join('');
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
      const st = $('#save-state'); if (st) st.textContent = 'Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); announce('Saved');
      if (close) showVerdict(snap, doc, P.milestones(prevTotals, nextTotals, snap.streak));
    });
  }
  function latestDate(days) { let m = null; for (const d of days) if (d.date && (!m || d.date > m)) m = d.date; return m; }
  function summarize(snap) {
    const t = {}; for (const m of P.METRICS) t[m] = snap.metrics[m].actual;
    const bands = {}; const need = {}; for (const m of P.METRICS) { bands[m] = snap.metrics[m].band; need[m] = snap.metrics[m].needPerDay; }
    return { asOf: snap.asOf, totals: Object.assign(t, snap.sessionTotals), bands, overall: snap.overall, needPerDay: need, streak: snap.streak, week: snap.week, dayIndex: snap.idx, totalDays: snap.total, remainingDays: snap.remainingDays, loggedDays: snap.loggedDays, missedDays: snap.missedDays, targets: snap.targets, thisWeek: snap.thisWeek, ratios: snap.ratios, programStatus: snap.status };
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
    const sw = () => { S.logDate = todayStr(); S.dirty = false; S.draft = Object.assign(emptyDay(S.logDate), S.days.find(d => d.date === S.logDate) || {}); render(); toast('New day: now logging ' + niceDate(S.logDate)); };
    if (S.dirty) saveDay(false).then(sw, sw); else sw();
    return true;
  }
  function openAppraisalSheet() {
    sheet('<h3>Appraisal details <span class="muted small">(optional)</span></h3><p class="small muted">Jess: an appraisal only counts once it has an action plan and a pipeline category. Thirty seconds now saves the follow-up later.</p>' +
      '<label class="f">Address<input id="ap-address" placeholder="12 Example St, Irymple"></label>' +
      '<div class="chips" data-group="kind"><button type="button" class="chip" data-v="curbside" aria-pressed="true">Curbside</button><button type="button" class="chip" data-v="walkthrough" aria-pressed="false">Quick walk-through</button></div>' +
      '<p class="eyebrow">Likely to list</p><div class="chips" data-group="category"><button type="button" class="chip" data-v="1-2" aria-pressed="false">1 to 2 months (weekly contact)</button><button type="button" class="chip" data-v="2-12" aria-pressed="true">2 to 12 months (monthly contact)</button></div>' +
      '<p class="eyebrow">Lead type</p><div class="chips" data-group="group"><button type="button" class="chip" data-v="skeptic" aria-pressed="false">Skeptic (cold)</button><button type="button" class="chip" data-v="audience" aria-pressed="true">Audience (warm)</button><button type="button" class="chip" data-v="advocate" aria-pressed="false">Advocate (hot)</button></div>' +
      '<p class="eyebrow">Action plan</p><div class="chips" data-group="plan">' + ['12 month re-appraisal', '1 month plan', '3 month plan', '6 month plan', 'Anniversary', 'On the market', 'Unsuccessful'].map((p, i) => '<button type="button" class="chip" data-v="' + esc(p) + '" aria-pressed="' + (i === 0) + '">' + esc(p) + '</button>').join('') + '</div>' +
      '<div class="row"><button class="btn primary grow" data-act="save-appraisal">Save to pipeline</button><button class="btn ghost" data-close="1">Skip, just count it</button></div>', { noFocus: false });
  }
  function chipVal(group) { const b = $('[data-group="' + group + '"] .chip[aria-pressed="true"]'); return b ? b.dataset.v : null; }
  function saveAppraisal() {
    const cat = chipVal('category') || '2-12'; const date = S.logDate;
    const rec = { address: $('#ap-address').value.trim(), kind: chipVal('kind') || 'curbside', category: cat, group: chipVal('group') || 'audience', plan: chipVal('plan') || '12 month re-appraisal', date, status: 'active', lastTouch: date, nextTouch: P.fmtDate(P.addDays(P.parseDate(date), cat === '1-2' ? 7 : 30)), reappraisal: P.fmtDate(P.addDays(P.parseDate(date), 365)), notes: '', createdAt: new Date().toISOString() };
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
      else if (addr) { await db().collection('people/' + S.me.id + '/pipeline').add({ address: addr, kind: 'listing', category: '1-2', group: 'advocate', plan: 'On the market', date: S.logDate, status: 'listed', listedDate: S.logDate, lastTouch: S.logDate, nextTouch: null, notes: '', createdAt: new Date().toISOString() }); }
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
    sheet('<h3>' + esc(p.address || 'Appraisal') + '</h3><p class="small muted">' + esc(p.kind || '') + ' · appraised ' + niceDate(p.date) + ' · ' + (p.category === '1-2' ? 'listing in 1 to 2 months' : 'listing in 2 to 12 months') + ' · ' + esc(p.group || '') + ' · ' + esc(p.plan || '') + '</p>' +
      '<p class="small">Last touch ' + (p.lastTouch ? niceDate(p.lastTouch) : 'none') + ' · next due ' + (p.nextTouch ? niceDate(p.nextTouch) : 'n/a') + (p.reappraisal ? ' · 12-month re-appraisal ' + niceDate(p.reappraisal) : '') + '</p>' +
      '<label class="f">Notes<textarea id="pl-notes" rows="2">' + esc(p.notes || '') + '</textarea></label>' +
      '<div class="row">' + (p.status === 'active' ? '<button class="btn primary" data-touch="' + esc(id) + '" data-close="1">Touched today</button><button class="btn" data-pstatus="listed" data-pid="' + esc(id) + '">Listed</button><button class="btn" data-pstatus="lost" data-pid="' + esc(id) + '">Lost</button>' : '<button class="btn" data-pstatus="active" data-pid="' + esc(id) + '">Reactivate</button>') + '<button class="btn ghost" data-act="save-pl-notes" data-pid="' + esc(id) + '">Save notes</button></div>');
  }

  // ---------- Progress ----------
  function progressHtml() { const snap = mySnap(); return progressFor(snap, daysWithDraft(), S.pipeline, S.learning || defaultLearning(), S.person, false); }
  function progressFor(snap, days, pipeline, learning, person, readOnly) {
    if (!snap) return '<div class="card">No start date set.</div>';
    const parts = [];
    parts.push('<div class="hero"><p class="eyebrow">' + esc(person.name) + (person.farm ? ' · ' + esc(person.farm) : '') + '</p><h1>' + (snap.status === 'upcoming' ? 'Starts ' + niceDate(snap.cal.start) : 'Week ' + Math.min(snap.week, snap.cal.weeks) + ' · Day ' + snap.idx + ' of ' + snap.total) + '</h1><div class="row">' + bandPill(snap.overall) + '<span class="pill">' + snap.remainingDays + ' working days left</span>' + (snap.streak ? '<span class="pill">' + ICONS.flame + ' ' + snap.streak + '</span>' : '') + '</div></div>');
    parts.push('<div class="rings">' + ring('Geo data', snap.metrics.geo) + ring('Appraisals', snap.metrics.appraisals) + ring('Listings', snap.metrics.listings) + '</div>');
    parts.push('<div class="card"><p class="eyebrow">Where you stand</p><div class="prose">' + P.METRICS.map(m => '<p><strong>' + P.LABELS[m][0].toUpperCase() + P.LABELS[m].slice(1) + ':</strong> ' + esc(P.metricLine(snap.metrics[m])) + '</p>').join('') + '</div></div>');
    parts.push('<div class="card"><div class="row between"><p class="eyebrow">Cumulative vs guide</p><div class="chips" id="chart-metric">' + P.METRICS.map(m => '<button class="chip sm" data-chart="' + m + '" aria-pressed="' + ((S.ui.chartMetric || 'geo') === m) + '">' + P.LABELS[m] + '</button>').join('') + '</div></div>' + chart(snap, days, S.ui.chartMetric || 'geo') + '<p class="tiny muted">Solid line: your running total. Dashed: the soft guide (front-loaded geo data, appraisals from week 2, listings from week 8). The guide is a reference, not a quota: the pace line above is what matters.</p></div>');
    parts.push('<div class="card"><p class="eyebrow">Call session ratios</p><div class="kpis">' + kpi(snap.sessionTotals.calls, 'calls') + kpi(snap.sessionTotals.connections, 'connections') + kpi(snap.sessionTotals.appointments, 'appointments') + kpi(snap.ratios.connectionRate == null ? '–' : snap.ratios.connectionRate + '%', 'connection rate (Jess: 45 to 50%)') + kpi(snap.ratios.appointmentRate == null ? '–' : snap.ratios.appointmentRate + '%', 'appointments per connection (Jess: 1 in 6 to 8)') + kpi(snap.ratios.appraisalsPer100Geo == null ? '–' : snap.ratios.appraisalsPer100Geo, 'appraisals per 100 geo data (program: 10)') + kpi(snap.ratios.listingsPerAppraisal == null ? '–' : snap.ratios.listingsPerAppraisal + '%', 'listings per appraisal (program: 10%)') + '</div></div>');
    parts.push('<div class="card"><p class="eyebrow">Logging streak</p>' + heat(snap, days) + '<p class="tiny muted">' + snap.loggedDays + ' of ' + snap.idx + ' working days logged' + (snap.missedDays ? ' · ' + snap.missedDays + ' missed' : '') + '</p></div>');
    parts.push('<div class="card"><p class="eyebrow">Week by week</p>' + weekTable(snap, days) + '</div>');
    parts.push(pipelineCard(pipeline, readOnly));
    parts.push(learningCard(learning, snap));
    return parts.join('');
  }
  function kpi(v, l) { return '<div class="kpi"><div class="v num">' + esc(v) + '</div><div class="l">' + esc(l) + '</div></div>'; }
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
    const row = p => '<button class="item" ' + (readOnly ? 'disabled' : 'data-pipe="' + esc(p.id) + '"') + '><div><div class="t">' + esc(p.address || 'Appraisal on ' + niceDate(p.date)) + '</div><div class="s">' + (p.category === '1-2' ? '1 to 2 months · weekly' : '2 to 12 months · monthly') + ' · ' + esc(p.group || '') + (p.nextTouch ? ' · next ' + niceDate(p.nextTouch) : '') + '</div></div>' + (p.nextTouch && p.nextTouch <= todayStr() ? '<span class="pill bad">Due</span>' : '<span class="pill muted">' + esc(p.plan || '') + '</span>') + '</button>';
    return '<div class="card"><div class="row between"><p class="eyebrow">Pipeline (Sales is a Contact Sport)</p><span class="small muted">' + active.length + ' active · ' + listed.length + ' listed · ' + lost.length + ' lost</span></div>' +
      (active.length ? '<div class="list">' + active.map(row).join('') + '</div>' : '<div class="empty"><strong>No appraisals in the pipeline yet.</strong><span class="small">When you add an appraisal on your daily sheet, give it an address and a category and it lands here with its next touch date.</span></div>') +
      (listed.length ? '<p class="eyebrow">Listed</p><div class="list">' + listed.map(row).join('') + '</div>' : '') + '</div>';
  }
  function learningCard(L, snap) {
    const weeks = CONTENT().weeks; if (!weeks.length) return '';
    const due = weeks.filter(w => w.week <= Math.max(1, Math.min(snap.week, snap.cal.weeks)));
    const lessonsDue = due.reduce((s, w) => s + w.lessons.length, 0); const read = due.reduce((s, w) => s + w.lessons.filter(l => L.lessonsRead[l.id]).length, 0);
    const quizzes = due.filter(w => L.quiz[w.week]).length; const practice = (L.practice && L.practice.count) || 0;
    const avg = L.practice && L.practice.scores && L.practice.scores.length ? Math.round(L.practice.scores.reduce((s, x) => s + (x.pct || 0), 0) / L.practice.scores.length) : null;
    return '<div class="card"><p class="eyebrow">Learning</p><div class="kpis">' + kpi(read + '/' + lessonsDue, 'lessons read (weeks due so far)') + kpi(quizzes + '/' + due.length, 'weekly quizzes done') + kpi(practice, 'role-plays completed') + kpi(avg == null ? '–' : avg + '%', 'average role-play score') + '</div></div>';
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
    parts.push('<div class="hero"><p class="eyebrow">Learn · 12 weeks built on Jess Densley\'s programs</p><h1>Week ' + w.week + ': ' + esc(w.theme) + '</h1><p class="sub">' + esc(w.tagline) + '</p></div>');
    parts.push('<div class="week-nav" role="tablist" aria-label="Weeks">' + weeks.map(x => { const r = x.lessons.filter(l => L.lessonsRead[l.id]).length; const complete = r === x.lessons.length && L.quiz[x.week]; return '<button role="tab" data-week="' + x.week + '" aria-pressed="' + (x.week === w.week) + '" class="' + (x.week === cur ? 'now ' : '') + (complete ? 'done' : '') + '"><span class="w">WK</span>' + x.week + '</button>'; }).join('') + '</div>');
    parts.push('<div class="card"><div class="row between"><span class="small"><strong>' + doneSteps + ' of ' + totalSteps + '</strong> steps this week</span><span class="pill ' + (doneSteps === totalSteps ? 'good' : 'muted') + '">' + (doneSteps === totalSteps ? 'Week complete' : esc(w.module)) + '</span></div><div class="progress-line"><i style="width:' + Math.round(doneSteps / totalSteps * 100) + '%"></i></div><div class="prose">' + md(w.intro) + '</div><div class="card soft"><p class="eyebrow">This week\'s numbers</p><p class="small">' + esc(w.focus) + '</p></div></div>');
    parts.push('<div class="stack"><h2>Lessons</h2>' + w.lessons.map((l, i) => '<details class="lesson" ' + (S.ui.openLesson === l.id ? 'open' : '') + ' data-lesson="' + esc(l.id) + '"><summary><div><div class="row"><span class="check ' + (L.lessonsRead[l.id] ? 'on' : '') + '">' + (L.lessonsRead[l.id] ? ICONS.check : '') + '</span><strong>' + (i + 1) + '. ' + esc(l.title) + '</strong></div><div class="small muted" style="margin-left:34px">' + (l.minutes || 4) + ' min read' + (l.source ? ' · ' + esc(l.source.replace(/-Letter-P\.pdf$|\.pdf$/, '').replace(/-/g, ' ')) : '') + '</div></div><span class="muted">›</span></summary><div class="body">' + (l.jessSays ? '<div class="jess">“' + esc(l.jessSays) + '”<span class="who">Jess Densley</span></div>' : '') + '<div class="prose">' + md(l.body) + '</div>' + (l.keyTakeaways && l.keyTakeaways.length ? '<div class="card soft"><p class="eyebrow">Take away</p><ul style="margin:0;padding-left:18px">' + l.keyTakeaways.map(k => '<li>' + inline(k) + '</li>').join('') + '</ul></div>' : '') + '<button class="btn ' + (L.lessonsRead[l.id] ? '' : 'primary') + '" data-read="' + esc(l.id) + '">' + (L.lessonsRead[l.id] ? 'Mark as unread' : 'Mark as read') + '</button></div></details>').join('') + '</div>');
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
      return '<div class="card ' + (pct >= 80 ? 'good' : 'soft') + '"><p class="eyebrow">Week ' + w.week + ' check</p><h2>' + score + ' of ' + w.quiz.length + '</h2><p>' + (pct >= 80 ? 'Pass. You know this week\'s material.' : 'Under 80%. Re-read the lessons you missed and go again; the retake counts.') + '</p><div class="row"><button class="btn" data-act="quiz-start" data-qweek="' + w.week + '">Try again</button><button class="btn ghost" data-act="quiz-close">Close</button></div></div>';
    }
    const item = w.quiz[q.i];
    return '<div class="card"><div class="row between"><p class="eyebrow">Question ' + (q.i + 1) + ' of ' + w.quiz.length + '</p><button class="btn sm ghost" data-act="quiz-close">Quit</button></div><h3>' + esc(item.q) + '</h3><div class="stack">' + item.options.map((o, i) => '<button class="quiz-opt ' + (q.picked == null ? '' : (i === item.answer ? 'right' : (i === q.picked ? 'wrong' : ''))) + '" data-qpick="' + i + '" ' + (q.picked == null ? '' : 'disabled') + '>' + esc(o) + '</button>').join('') + '</div>' + (q.picked == null ? '' : '<div class="card soft"><p class="small"><strong>' + (q.picked === item.answer ? 'Correct.' : 'Not quite.') + '</strong> ' + esc(item.explain || '') + '</p></div><button class="btn primary" data-act="quiz-next">' + (q.i + 1 >= w.quiz.length ? 'See score' : 'Next') + '</button>') + '</div>';
  }
  function setLearning(mut) {
    if (!S.learning) { toast('One moment, your progress is still loading'); return; }
    mut(S.learning); S.learning.updatedAt = new Date().toISOString(); S.learnDirty = true; S.learnRev++; render();
    clearTimeout(S.learnTimer);
    S.learnTimer = setTimeout(() => { const rev = S.learnRev; const body = clone(S.learning); chain(async () => { await learnRef(S.me.id).set(body); if (S.learnRev === rev) S.learnDirty = false; }); }, 600);
  }
  function quizPick(i) {
    const q = S.ui.quiz; const w = CONTENT().weeks.find(x => x.week === q.week); if (!q || q.picked != null) return;
    q.picked = i; q.answers[q.i] = i === w.quiz[q.i].answer; render();
  }
  function quizNext() {
    const q = S.ui.quiz; const w = CONTENT().weeks.find(x => x.week === q.week); q.i++; q.picked = null;
    if (q.i >= w.quiz.length) {
      const score = q.answers.filter(Boolean).length;
      setLearning(L => { const prev = L.quiz[w.week] || { score: 0, total: w.quiz.length, attempts: 0 }; L.quiz[w.week] = { score: Math.max(prev.score, score), total: w.quiz.length, last: score, attempts: prev.attempts + 1, at: new Date().toISOString() }; });
      if (score / w.quiz.length >= .8) confetti();
    } else render();
  }

  // ---------- Scripts & templates ----------
  function scriptsHtml() {
    const C = CONTENT(); const tab = S.ui.scriptsTab; const q = S.ui.scriptsQuery.toLowerCase();
    const parts = ['<div class="hero"><p class="eyebrow">Jess Densley\'s scripts, letters and templates</p><h1>Say it word for word first. Make it yours second.</h1></div>'];
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
    return '<details class="lesson" ' + (S.ui.openScript === s.id ? 'open' : '') + ' id="script-' + esc(s.id) + '"><summary><div><strong>' + esc(s.title) + '</strong><div class="small muted">' + esc(s.category) + ' · ' + esc(s.when) + '</div></div><span class="muted">›</span></summary><div class="body"><div>' + s.steps.map(b => '<div class="beat"><div class="lab">' + esc(b.label || '') + '</div><div class="line">' + esc(b.line) + '</div></div>').join('') + '</div>' + (s.goal ? '<p class="small"><strong>A win:</strong> ' + esc(s.goal) + '</p>' : '') + (s.tips && s.tips.length ? '<div class="card soft"><p class="eyebrow">Coaching tips</p><ul style="margin:0;padding-left:18px">' + s.tips.map(t => '<li class="small">' + inline(t) + '</li>').join('') + '</ul></div>' : '') + '<div class="row">' + (rp ? '<button class="btn primary sm" data-practice="' + esc(rp.id) + '">' + ICONS.practice + ' Practise with the AI</button>' : '') + '<button class="btn sm" data-copy-script="' + esc(s.id) + '">' + ICONS.copy + ' Copy</button><span class="tiny muted">' + esc(s.source || '') + '</span></div></div></details>';
  }
  function templateCard(t) {
    return '<details class="lesson" id="template-' + esc(t.id) + '" ' + (S.ui.openTemplate === t.id ? 'open' : '') + '><summary><div><strong>' + esc(t.title) + '</strong><div class="small muted">' + esc(t.kind) + ' · ' + esc(t.when) + '</div></div><span class="muted">›</span></summary><div class="body"><div class="prose">' + md(t.body) + '</div><div class="row"><button class="btn sm" data-copy-template="' + esc(t.id) + '">' + ICONS.copy + ' Copy text</button><span class="tiny muted">' + esc(t.source || '') + '</span></div></div></details>';
  }
  function openTemplateSheet(id) {
    const t = CONTENT().templates.find(x => x.id === id); if (!t) return;
    sheet('<h3>' + esc(t.title) + '</h3><p class="small muted">' + esc(t.when) + '</p><div class="prose">' + md(t.body) + '</div><div class="row"><button class="btn primary" data-copy-template="' + esc(t.id) + '">' + ICONS.copy + ' Copy text</button><button class="btn ghost" data-close="1">Close</button></div>');
  }

  // ---------- Practice (AI role-play) ----------
  function practiceHtml() {
    const C = CONTENT(); const pr = S.ui.practice;
    if (!S.caps.sample) return '<div class="hero"><h1>Practice</h1></div><div class="card"><p>The role-play partner needs Claude, which is not available in this view. You can still rehearse with a colleague: open any script and read the beats aloud.</p><button class="btn" data-nav="scripts">Open scripts</button></div>';
    if (!pr) {
      const cur = currentWeek(); const w = C.weeks.find(x => x.week === cur); const thisWeek = (w && w.rolePlays || []).map(id => C.rolePlays.find(r => r.id === id)).filter(Boolean);
      const L = S.learning || defaultLearning(); const scores = (L.practice && L.practice.scores) || [];
      const card = r => { const best = scores.filter(s => s.rp === r.id).sort((a, b) => b.pct - a.pct)[0]; return '<button class="item" data-practice="' + esc(r.id) + '"><div><div class="t">' + esc(r.title) + '</div><div class="s">' + esc(r.setting) + ' · ' + esc(r.difficulty) + (best ? ' · best ' + best.pct + '%' : '') + '</div></div><span class="pill ' + (r.difficulty === 'hard' ? 'bad' : r.difficulty === 'medium' ? 'warn' : 'good') + '">' + esc(r.difficulty) + '</span></button>'; };
      return '<div class="hero"><p class="eyebrow">Practice</p><h1>Rehearse the call before you make it.</h1><p class="sub">Claude plays a Mildura homeowner. You run the script. At the end you get a scorecard against Jess\'s beats. It uses your own Claude usage, so the first call asks your permission.</p></div>' +
        (thisWeek.length ? '<div class="card"><p class="eyebrow">This week</p><div class="list">' + thisWeek.map(card).join('') + '</div></div>' : '') +
        '<div class="card"><p class="eyebrow">All scenarios</p><div class="list">' + C.rolePlays.map(card).join('') + '</div></div>';
    }
    const rp = pr.rp; const script = C.scripts.find(s => s.id === rp.scriptId);
    const head = '<div class="row between"><button class="btn sm ghost" data-act="practice-exit">' + ICONS.back + ' All scenarios</button>' + (script ? '<button class="btn sm ghost" data-act="practice-script">Peek at the script</button>' : '') + '</div><div class="hero"><p class="eyebrow">' + esc(rp.setting) + ' · ' + esc(rp.difficulty) + '</p><h2>' + esc(rp.title) + '</h2><p class="small muted">' + esc(rp.goal) + '</p></div>';
    if (pr.feedback) {
      const f = pr.feedback; const pct = f.max ? Math.round(f.total / f.max * 100) : 0;
      return head + '<div class="card ' + (pct >= 75 ? 'good' : pct >= 50 ? 'soft' : 'warn') + '"><p class="eyebrow">Scorecard</p><h1>' + pct + '%</h1><p class="small">' + f.total + ' of ' + f.max + ' across ' + (f.scores || []).length + ' criteria</p></div>' +
        '<div class="card">' + (f.scores || []).map(s => '<div class="score"><div><strong>' + esc(s.criterion) + '</strong><div class="small muted">' + esc(s.note || '') + '</div></div><span class="pill ' + (s.score >= 2 ? 'good' : s.score === 1 ? 'warn' : 'bad') + '">' + s.score + '/2</span></div>').join('') + '</div>' +
        '<div class="card"><p class="eyebrow">What worked</p><ul style="margin:0;padding-left:18px">' + (f.strengths || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul><p class="eyebrow">Work on</p><ul style="margin:0;padding-left:18px">' + (f.improve || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' + (f.oneThing ? '<div class="jess">' + esc(f.oneThing) + '<span class="who">The one thing</span></div>' : '') + (f.wordForWord ? '<p class="small"><strong>Try this line next time:</strong> “' + esc(f.wordForWord) + '”</p>' : '') + '</div>' +
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
    const prompt = 'You are a warm, direct real estate sales coach reviewing a role-play by a brand-new associate at ' + S.config.officeName + ' who is practising "' + pr.rp.title + '" (' + pr.rp.setting + '). Jess Densley\'s standard: courtesy first, a reason for the call, value before the ask, listen (why\'s that? tell me more), update details, the cash-buyer question where it fits, always offer two times, never burn a bridge.\n\nGOAL: ' + pr.rp.goal + '\n\nRUBRIC (score each 0, 1 or 2):\n' + pr.rp.rubric.map((r, i) => (i + 1) + '. ' + r).join('\n') + '\n\nTRANSCRIPT:\n' + transcript + '\n\nReply with ONLY a JSON object: {"scores":[{"criterion":"<rubric item, shortened>","score":0,"note":"<one short sentence>"}],"total":<sum>,"max":<2 x number of criteria>,"strengths":["<2-3 short items>"],"improve":["<2-3 short items>"],"oneThing":"<the single most useful change, one sentence>","wordForWord":"<one line the associate could say next time, in Jess\'s style>"}. Australian English, plain words, no em-dashes.';
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
  function associates() { return S.roster.filter(p => p.role !== 'manager'); }
  function managerHomeHtml() { return teamHtml(); }
  function loadTeamDays(pid, force) {
    const c = S.teamCache[pid]; if (c && !force && !c.error && Date.now() - c.at < 120000) return Promise.resolve(c);
    if (S.teamLoading[pid]) return S.teamLoading[pid];
    const p = (async () => {
      try {
        const [ds, ps, ls, cs] = await Promise.all([db().collection('people/' + pid + '/days').get(), db().collection('people/' + pid + '/pipeline').get(), learnRef(pid).get(), coachRef(pid).get()]);
        const entry = { at: Date.now(), personUpdatedAt: (S.roster.find(x => x.id === pid) || {}).updatedAt || null, days: ds.docs.map(d => d.data()).filter(d => d && d.date), pipeline: ps.docs.map(d => Object.assign({}, d.data(), { id: d.id })), learning: ls.exists ? normLearning(ls.data()) : defaultLearning(), notes: cs.exists ? String(cs.data().notes || '') : '', notesVersion: cs.exists };
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
    else if (!list.length) parts.push('<div class="card"><h3>No associates yet</h3><p>Share this page with each new recruit as a <strong>Contributor</strong> (Share button, top right of the artifact). When they open it, they set their start date and appear here. Share with Luke as an <strong>Editor</strong> so he sees this manager view.</p></div>');
    else parts.push('<div class="row between"><div class="chips"><button class="chip" aria-pressed="' + (S.ui.teamFilter === 'active') + '" data-tfilter="active">Active</button><button class="chip" aria-pressed="' + (S.ui.teamFilter === 'all') + '" data-tfilter="all">Everyone</button></div><button class="btn sm ghost" data-act="team-refresh">Refresh</button></div><div class="roster">' + rows.map(r => personCard(r.p, r.snap, r.c)).join('') + '</div>');
    parts.push(weeklyTeamCard(rows));
    parts.push('<div class="card"><p class="eyebrow">How reminders and reports work</p><p class="small">Every working day at ' + esc(String(S.config.nudgeHour || 18)) + ':00 (' + esc(S.config.timezone) + ') an email goes to each active associate from Damian\'s Gmail: a nudge if nothing is logged, a pat on the back if they are on track, and the pace from here if they are behind. Monday mornings, managers get the team report. Emails go to the addresses in each profile and the manager list in Settings.</p><button class="btn sm" data-act="open-settings">Program settings</button></div>');
    return parts.join('');
  }
  function personCard(p, snap, c) {
    if (!snap) return '<button class="person" data-person="' + esc(p.id) + '"><div class="head"><div class="row"><div class="avatar">' + esc(initials(p.name)) + '</div><div><strong>' + esc(p.name) + '</strong><div class="small muted">' + (p.startDate ? 'Started ' + niceDate(p.startDate) : 'No start date') + '</div></div></div><span class="pill muted">Loading</span></div></button>';
    const last = p.lastLogDate ? daysAgo(p.lastLogDate) : null; const lastTxt = last == null ? 'never logged' : (last === 0 ? 'logged today' : last === 1 ? 'logged yesterday' : 'last log ' + last + ' days ago');
    return '<button class="person" data-person="' + esc(p.id) + '"><div class="head"><div class="row"><div class="avatar">' + esc(initials(p.name)) + '</div><div><strong>' + esc(p.name) + '</strong><div class="small muted">' + (snap.status === 'upcoming' ? 'Starts ' + niceDate(snap.cal.start) : snap.status === 'finished' ? 'Finished' : 'Week ' + snap.week + ' · day ' + snap.idx + ' of ' + snap.total) + ' · ' + lastTxt + (snap.streak ? ' · ' + snap.streak + ' day streak' : '') + '</div></div></div>' + bandPill(snap.overall) + '</div><div class="bars">' + barRow('Geo data', snap.metrics.geo) + barRow('Appraisals', snap.metrics.appraisals) + barRow('Listings', snap.metrics.listings) + '</div>' + (snap.status === 'active' && !snap.loggedToday && ((last != null && last >= 2) || (last == null && snap.idx >= 2)) ? '<span class="pill bad">' + (last == null ? 'Nothing logged yet' : last + ' days without a log') + '</span>' : '') + '</button>';
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
      '<div class="card info"><p class="eyebrow">Coaching prompts for the Monday meeting</p><ul style="margin:0;padding-left:18px">' + coach.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul><p class="small muted">Jess\'s close: Do you need any support? Can you do all that? Will you do all that?</p></div>' +
      '<div class="card"><p class="eyebrow">Last 7 logged days</p><div class="table-wrap"><table><thead><tr><th>Day</th><th>Geo</th><th>Appr</th><th>List</th><th>Calls</th><th>Conn</th><th>Appt</th><th style="text-align:left">Note</th></tr></thead><tbody>' + (recent.length ? recent.map(d => '<tr><td>' + niceDate(d.date) + '</td><td class="num">' + num(d.geo) + '</td><td class="num">' + num(d.appraisals) + '</td><td class="num">' + num(d.listings) + '</td><td class="num">' + num(d.calls) + '</td><td class="num">' + num(d.connections) + '</td><td class="num">' + num(d.appointments) + '</td><td style="text-align:left;white-space:normal;min-width:160px">' + esc(d.note || '') + '</td></tr>').join('') : '<tr><td colspan="8">Nothing logged yet.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="card"><p class="eyebrow">Manager notes (' + esc(p.name) + ' cannot see these)</p>' + (c.error ? '<p class="small" style="color:var(--bad)">Could not load this person\'s records. Refresh to try again.</p>' : '') + '<textarea id="mgr-notes" rows="4" placeholder="Checkpoint notes, agreed actions, stakes from the Monday Game Plan">' + esc(c.notes || '') + '</textarea><div class="row"><button class="btn primary sm" data-act="save-notes" data-pid="' + esc(p.id) + '">Save notes</button></div></div>' +
      '<div class="card"><p class="eyebrow">Settings for ' + esc(p.name) + '</p><div class="stack"><label class="f">Start date<input type="date" id="tp-start" value="' + esc(p.startDate || '') + '"></label><label class="f">Email for reminders<input type="email" id="tp-email" value="' + esc(p.email || '') + '"></label><label class="f">Farm area<input id="tp-farm" value="' + esc(p.farm || '') + '"></label><div class="row"><label class="f grow">Geo target<input type="number" id="tp-geo" value="' + esc((p.targets || {}).geo || S.config.targets.geo) + '"></label><label class="f grow">Appraisals<input type="number" id="tp-appr" value="' + esc((p.targets || {}).appraisals || S.config.targets.appraisals) + '"></label><label class="f grow">Listings<input type="number" id="tp-list" value="' + esc((p.targets || {}).listings || S.config.targets.listings) + '"></label></div><label class="f">Status<select id="tp-status">' + ['active', 'paused', 'graduated', 'left'].map(s => '<option ' + ((p.status || 'active') === s ? 'selected' : '') + '>' + s + '</option>').join('') + '</select></label><label class="f">Role<select id="tp-role"><option value="associate" ' + (p.role !== 'manager' ? 'selected' : '') + '>Associate</option><option value="manager" ' + (p.role === 'manager' ? 'selected' : '') + '>Manager</option></select></label><button class="btn primary" data-act="save-person" data-pid="' + esc(p.id) + '">Save settings</button></div></div>';
  }
  function coachSuggestions(snap, c) {
    const out = []; const m = snap.metrics; const r = snap.ratios; const L = c.learning || defaultLearning();
    if (snap.status === 'upcoming') return ['Program has not started. Agree the farm area, print the Daily Call Sheet and run the Week 1 role-play together before day one.'];
    if (!snap.loggedToday && snap.missedDays >= 2) out.push(snap.missedDays + ' working days not logged. Ask what is in the way of logging before you ask about numbers.');
    if (m.geo.band === 'behind' || m.geo.band === 'slipping') out.push('Geo data under the guide (' + m.geo.actual + ' vs about ' + Math.round(m.geo.guide) + '). Check: is the 30-name list prepared before each session? How many 45-minute sessions this week (' + snap.thisWeek.calls + ' calls logged)?');
    if (m.geo.band === 'ahead') out.push('Geo data ahead of the guide. Make sure every record is complete in the CRM (name, address, phone, settlement date where possible) and tagged S/AU/AD.');
    if (r.connectionRate != null && r.connectionRate < 35 && snap.sessionTotals.calls >= 40) out.push('Connection rate ' + r.connectionRate + '% (Jess: 45 to 50%). Look at call times and list quality.');
    if (r.appointmentRate != null && r.appointmentRate < 8 && snap.sessionTotals.connections >= 30) out.push('Appointments per connection ' + r.appointmentRate + '%. Role-play the 2 Minute Rule close and the two-times offer.');
    if (m.appraisals.inPlay && (m.appraisals.band === 'behind' || m.appraisals.band === 'slipping')) out.push('Appraisals behind pace. Is the Appraisal Drive street calendar live? Drill the Front Door Script with a stopwatch.');
    if (m.appraisals.actual >= 5 && snap.week >= 6 && m.listings.actual === 0) out.push('Appraisals are happening but no listing yet. Walk the pipeline: who is in the 1 to 2 month bucket and when were they last touched?');
    const due = (c.pipeline || []).filter(p => p.status === 'active' && p.nextTouch && p.nextTouch < todayStr()).length; if (due) out.push(due + ' pipeline touch' + (due > 1 ? 'es' : '') + ' overdue.');
    const wk = Math.max(1, Math.min(snap.week, snap.cal.weeks)); const weeks = CONTENT().weeks.filter(w => w.week <= wk); const unread = weeks.reduce((s, w) => s + w.lessons.filter(l => !L.lessonsRead[l.id]).length, 0);
    if (unread > 4) out.push(unread + ' lessons from the weeks so far are unread. Agree one lesson a day.');
    if (!(L.practice && L.practice.count)) out.push('No AI role-plays yet. Do one together in the meeting; it takes five minutes.');
    if ([4, 8, 12].includes(wk)) out.push('Week ' + wk + ' is a checkpoint. Use The Leadership Piece: Mistakes, Approach, Problem, Conversation.');
    if (!out.length) out.push('On track. Ask what one ratio they want to lift next week and what stake they put on it (Monday Game Plan).');
    return out;
  }
  function openSettingsSheet() {
    const c = S.config;
    sheet('<h3>Program settings</h3><p class="small muted">Defaults for every associate. Individual targets can be changed on their page.</p><div class="row"><label class="f grow">Geo data<input type="number" id="cf-geo" value="' + esc(c.targets.geo) + '"></label><label class="f grow">Appraisals<input type="number" id="cf-appr" value="' + esc(c.targets.appraisals) + '"></label><label class="f grow">Listings<input type="number" id="cf-list" value="' + esc(c.targets.listings) + '"></label></div>' +
      '<label class="f">Weeks<input type="number" id="cf-weeks" value="' + esc(c.weeks) + '" min="4" max="26"></label><p class="eyebrow">Working days</p><div class="chips" id="cf-days">' + [1, 2, 3, 4, 5, 6, 0].map(d => '<button type="button" class="chip" data-v="' + d + '" aria-pressed="' + (c.workDays.includes(d)) + '">' + DOW[d] + '</button>').join('') + '</div>' +
      '<label class="f">Office name<input id="cf-office" value="' + esc(c.officeName) + '"></label><label class="f">Manager emails for the Monday report (comma separated)<input id="cf-managers" value="' + esc((c.managerEmails || []).join(', ')) + '"></label>' +
      '<label class="f">Daily reminder hour (24h, ' + esc(c.timezone) + ')<input type="number" id="cf-hour" min="0" max="23" value="' + esc(c.nudgeHour) + '"></label><p class="tiny muted">Changing the reminder hour here records your preference; ask Claude to move the scheduled task to match.</p>' +
      '<div class="row"><button class="btn primary" data-act="save-config">Save</button><button class="btn ghost" data-close="1">Cancel</button></div>');
  }
  function saveConfig() {
    const days = $$('#cf-days .chip[aria-pressed="true"]').map(b => Number(b.dataset.v)).sort();
    const cfg = Object.assign({}, S.config, { targets: { geo: Number($('#cf-geo').value) || 300, appraisals: Number($('#cf-appr').value) || 30, listings: Number($('#cf-list').value) || 3 }, weeks: Number($('#cf-weeks').value) || 12, workDays: days.length ? days : [1, 2, 3, 4, 5], officeName: $('#cf-office').value.trim() || 'Ray White Mildura', managerEmails: $('#cf-managers').value.split(',').map(s => s.trim()).filter(Boolean), nudgeHour: Number($('#cf-hour').value), updatedAt: new Date().toISOString() });
    closeSheet(); chain(async () => { await db().doc('config/program').set(cfg); S.config = cfg; toast('Settings saved'); render(); });
  }
  function savePersonSettings(pid) {
    const start = $('#tp-start').value; if (!P.parseDate(start)) { toast('Start date needed'); return; }
    const patch = { startDate: start, email: $('#tp-email').value.trim(), farm: $('#tp-farm').value.trim(), targets: { geo: Number($('#tp-geo').value) || S.config.targets.geo, appraisals: Number($('#tp-appr').value) || S.config.targets.appraisals, listings: Number($('#tp-list').value) || S.config.targets.listings }, status: $('#tp-status').value, role: $('#tp-role').value, updatedAt: new Date().toISOString() };
    chain(async () => { await db().doc('people/' + pid).update(patch); toast('Saved'); });
  }

  // ---------- Profile ----------
  function meHtml() {
    const p = S.person; const canEditStart = isManager() || !S.days.length;
    return '<div class="hero"><p class="eyebrow">Profile</p><h1>' + esc(p.name) + '</h1><div class="row"><span class="pill">' + (p.role === 'manager' ? 'Manager' : 'Associate') + '</span>' + (p.role !== 'manager' && p.startDate ? '<span class="pill muted">Started ' + niceDate(p.startDate) + '</span>' : '') + '</div></div>' +
      '<div class="card"><div class="stack"><label class="f">Name<input id="me-name" value="' + esc(p.name) + '"></label><label class="f">Email for reminders and reports<input id="me-email" type="email" value="' + esc(p.email || '') + '"></label>' + (p.role !== 'manager' ? '<label class="f">Farm area<input id="me-farm" value="' + esc(p.farm || '') + '"></label><label class="f">Program start date' + (canEditStart ? '' : ' <span class="muted">(ask a manager to change this once you have logged days)</span>') + '<input type="date" id="me-start" value="' + esc(p.startDate || '') + '" ' + (canEditStart ? '' : 'disabled') + '></label>' : '') + '<button class="btn primary" data-act="save-me">Save</button></div></div>' +
      '<div class="card"><p class="eyebrow">About Launchpad</p><p class="small">Built for ' + esc(S.config.officeName) + ' on Jess Densley\'s programs: Client Connections, The 15-Minute Appraisal, Sales is a Contact Sport, The 30-Day Lead Amplifier, The Listing Advantage and The Agent Dashboard. Three numbers in twelve weeks: ' + S.config.targets.geo + ' geo data, ' + S.config.targets.appraisals + ' appraisals, ' + S.config.targets.listings + ' listings.</p><p class="small muted">Geo data: one new contact record from your farm (owner name, phone or email, address) in the CRM. Appraisal: a curbside or walk-through with an action plan and a pipeline category. Listing: signed and live.</p></div>' +
      (p.role === 'manager' ? '<div class="card"><p class="eyebrow">Sharing</p><p class="small">Use the Share button on this page. Associates: Contributor. Luke and other managers: Editor. Anyone shared as Viewer can read but cannot log.</p></div>' : '');
  }
  function saveMe() {
    const patch = { name: $('#me-name').value.trim() || S.person.name, email: $('#me-email').value.trim(), updatedAt: new Date().toISOString() };
    if ($('#me-farm')) patch.farm = $('#me-farm').value.trim();
    if ($('#me-start') && !$('#me-start').disabled && P.parseDate($('#me-start').value)) patch.startDate = $('#me-start').value;
    chain(async () => { await myRef().update(patch); toast('Saved'); });
  }

  // ---------- Events ----------
  function bindGlobal() {
    document.addEventListener('click', onClick);
    document.addEventListener('submit', e => { if (e.target.id === 'onb') { e.preventDefault(); submitOnboarding(e.target); } });
    document.addEventListener('input', e => {
      if (e.target.id === 'day-note') { if (S.draft && S.daysLoaded) { S.draft.note = e.target.value; S.dirty = true; S.draftRev = (S.draftRev || 0) + 1; scheduleSave(); } }
      if (e.target.id === 'scripts-q') { S.ui.scriptsQuery = e.target.value; render(); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'chat-in') { e.preventDefault(); sendChat(); } });
    document.addEventListener('toggle', e => { const d = e.target; if (d.matches && d.matches('details.lesson[data-lesson]')) S.ui.openLesson = d.open ? d.dataset.lesson : null; }, true);
    const flush = () => { if (S.dirty) saveDay(false); };
    window.addEventListener('beforeunload', flush); window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else if (S.person && !isManager()) rollDate(); });
    setInterval(() => { if (S.person && !isManager() && document.visibilityState === 'visible') rollDate(); }, 60000);
  }
  function onClick(e) {
    const t = e.target.closest('[data-nav],[data-step],[data-act],[data-logdate],[data-week],[data-read],[data-drill],[data-qpick],[data-stab],[data-scat],[data-open-script],[data-open-template],[data-copy-script],[data-copy-template],[data-practice],[data-person],[data-tfilter],[data-pipe],[data-touch],[data-pstatus],[data-chart],[data-learn-week],[data-close],[data-role],.chips [data-v],[data-close]');
    if (!t) return;
    const d = t.dataset;
    if (t.matches('.chip[data-role]')) { $$('.chip[data-role]').forEach(b => b.setAttribute('aria-pressed', b === t)); const a = $('#onb-assoc'); if (a) a.hidden = d.role !== 'associate'; return; }
    if (t.matches('.chips [data-v]') && t.closest('[data-group], #cf-days')) { const multi = !!t.closest('#cf-days'); if (multi) t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') !== 'true'); else { $$('.chip', t.parentElement).forEach(b => b.setAttribute('aria-pressed', b === t)); } return; }
    if (d.nav) { if (d.nav === 'more') { openMore(); return; } if (d.close) closeSheet(); go(d.nav); return; }
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
    if (d.copyTemplate) { const s = CONTENT().templates.find(x => x.id === d.copyTemplate); if (s) copyText(s.title + '\n\n' + s.body.replace(/\*\*/g, '')); return; }
    if (d.practice) { closeSheet(); startPractice(d.practice); return; }
    if (d.person) { S.ui.teamPerson = d.person; render(); loadTeamDays(d.person).then(render); window.scrollTo(0, 0); return; }
    if (d.tfilter) { S.ui.teamFilter = d.tfilter; render(); return; }
    if (d.pipe) { openPipelineItem(d.pipe); return; }
    if (d.touch) { touchPipeline(d.touch); if (d.close) closeSheet(); return; }
    if (d.pstatus) { setPipelineStatus(d.pid, d.pstatus); return; }
    if (d.chart) { S.ui.chartMetric = d.chart; render(); return; }
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
      case 'quiz-start': S.ui.quiz = { week: Number(d.qweek), i: 0, answers: [], picked: null }; render(); break;
      case 'quiz-next': quizNext(); break;
      case 'quiz-close': S.ui.quiz = null; render(); break;
      case 'practice-exit': if (S.ui.practice && S.ui.practice.ctl) S.ui.practice.ctl.abort(); S.ui.practice = null; render(); break;
      case 'practice-script': { const s = CONTENT().scripts.find(x => x.id === S.ui.practice.rp.scriptId); if (s) sheet('<h3>' + esc(s.title) + '</h3><div>' + s.steps.map(b => '<div class="beat"><div class="lab">' + esc(b.label || '') + '</div><div class="line">' + esc(b.line) + '</div></div>').join('') + '</div><button class="btn block" data-close="1">Back to the call</button>'); break; }
      case 'chat-send': sendChat(); break;
      case 'chat-stop': if (S.ui.practice && S.ui.practice.ctl) S.ui.practice.ctl.abort(); break;
      case 'practice-feedback': practiceFeedback(); break;
      case 'team-back': S.ui.teamPerson = null; render(); break;
      case 'team-refresh': associates().forEach(p => loadTeamDays(p.id, true).then(render)); toast('Refreshing'); break;
      case 'open-settings': openSettingsSheet(); break;
      case 'save-config': saveConfig(); break;
      case 'save-notes': { const v = $('#mgr-notes').value; chain(async () => { await coachRef(d.pid).set({ notes: v, updatedAt: new Date().toISOString(), by: S.me.id }); if (S.teamCache[d.pid]) S.teamCache[d.pid].notes = v; toast('Notes saved'); }); break; }
      case 'save-person': savePersonSettings(d.pid); break;
      case 'save-me': saveMe(); break;
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
