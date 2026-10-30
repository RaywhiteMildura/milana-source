/* Playwright smoke test for the Launchpad app with the mock runtime.
   Usage: node smoke.js [associate|manager|extras|all]
   'extras' runs the round-2 to round-4 regression checks (weeks guard, focus week and summary.focusWeek, promote/decline/left,
   report-address bookkeeping, stale decline, pulse streak, phone layout, sheet focus trap, view-only card and toast, owner first run;
   round 4: Monday-dated weeks on a fixed clock, weekend start, approve busy state, targets that follow the defaults, the Remove
   sheet's leftover addresses, settings saved over a newer config, copy message, sheets and keyboard focus, Team tab, notes). */
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', 'app');
const OUT = path.resolve(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-claude.js'), 'utf8');
const which = process.argv[2] || 'all';
const skeleton = (body) => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + body + '</body></html>';
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rs) => {
      let p = req.url.split('?')[0]; if (p === '/' || p === '/index.html') { rs.setHeader('content-type', 'text/html'); rs.end(skeleton(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'))); return; }
      const f = path.join(ROOT, p); if (!fs.existsSync(f)) { rs.statusCode = 404; rs.end('nf'); return; }
      rs.setHeader('content-type', p.endsWith('.js') ? 'text/javascript' : 'text/plain'); rs.end(fs.readFileSync(f));
    });
    srv.listen(0, () => res({ srv, port: srv.address().port }));
  });
}
const iso = d => d.toISOString().slice(0, 10);
function workDaysBack(n) { const out = []; const d = new Date(); d.setHours(12, 0, 0, 0); while (out.length < n) { d.setDate(d.getDate() - 1); if (d.getDay() >= 1 && d.getDay() <= 5) out.push(iso(new Date(d))); } return out.reverse(); }
async function run(role, port) {
  const errors = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  const start = iso((() => { const d = new Date(); d.setDate(d.getDate() - 20); return d; })());
  const seed = {};
  if (role === 'associate') seed['board/u_peer'] = { name: 'Riley Chen', week: 3, totals: { geo: 64, appraisals: 5, listings: 0 }, targets: { geo: 300, appraisals: 30, listings: 3 }, streak: 4, lastLogDate: iso(new Date()), status: 'active', updatedAt: new Date().toISOString() };
  if (role === 'manager') {
    const days = workDaysBack(12);
    seed['people/u_assoc1'] = { id: 'u_assoc1', name: 'Jordan Blake', email: 'jordan@example.com', role: 'associate', startDate: start, farm: 'Irymple', status: 'active', lastLogDate: days[days.length - 1], summary: null, managerNotes: '' };
    days.forEach((dt, i) => { seed['people/u_assoc1/days/' + dt] = { date: dt, geo: 6, appraisals: i % 5 === 0 ? 1 : 0, listings: 0, calls: 22, connections: 10, appointments: 1, sessions: 1, note: i === 3 ? 'Good session, two appraisals booked' : '', closed: true, updatedAt: new Date().toISOString() }; });
    seed['people/u_assoc1/pipeline/p1'] = { address: '14 Riverside Ave, Mildura', kind: 'curbside', category: '1-2', group: 'warm', plan: '1 month plan', date: days[2], status: 'active', lastTouch: days[2], nextTouch: days[6], createdAt: new Date().toISOString() };
    const fw = focusFrom(new Date(start + 'T12:00:00'));
    seed['people/u_assoc1/weeks/' + fw.key] = { week: fw.week, monday: fw.key, items: [{ text: 'Two call sessions every morning', done: true }, { text: 'Book three appraisals', done: false }] };
    seed['people/u_luke'] = { id: 'u_luke', name: 'Luke Hermans', email: 'luke@example.com', role: 'manager-pending', startDate: start, farm: '', status: 'active', lastLogDate: null, summary: null };
    seed['people/u_assoc2'] = { id: 'u_assoc2', name: 'Sam Ortiz', email: 'sam@example.com', role: 'associate', startDate: start, farm: 'Red Cliffs', status: 'active', lastLogDate: days[3], summary: null, managerNotes: '' };
    days.slice(0, 4).forEach(dt => { seed['people/u_assoc2/days/' + dt] = { date: dt, geo: 2, appraisals: 0, listings: 0, calls: 8, connections: 3, appointments: 0, sessions: 1, note: '', closed: true, updatedAt: new Date().toISOString() }; });
  }
  await page.addInitScript({ content: 'window.__MOCK=' + JSON.stringify({ role, canEdit: role === 'manager', isOwner: role === 'manager', name: role === 'manager' ? 'Damian Portaro' : 'Taylor Associate', seed }) + ';' + MOCK });
  await page.goto('http://localhost:' + port + '/#today');
  const shot = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(OUT, role + '-' + name + '.png'), fullPage: true }); };
  const hasHScroll = async () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  const log = (...a) => console.log('[' + role + ']', ...a);

  await page.waitForSelector('#onb', { timeout: 5000 }); await shot('01-onboarding');
  if (role === 'associate') { await page.fill('#onb-start', start); await page.fill('#onb-farm', 'Mildura South'); }
  await page.click('#onb button[type=submit]');
  if (role === 'associate') {
    await page.waitForSelector('.sheet [data-close]', { timeout: 5000 }); await shot('02a-welcome');
    await page.click('.sheet button[data-close]'); await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForSelector('[data-step="geo"][data-n="1"]', { timeout: 5000 });
    await shot('02-today-empty');
    await page.click('[data-focus-add]'); await page.fill('#focus-in', 'Door-knock Walnut Ave on Thursday'); await page.press('#focus-in', 'Enter'); await page.waitForTimeout(200);
    await page.click('[data-focus-tick="0"]'); await page.waitForTimeout(200);
    log('focus summary:', JSON.stringify((await page.evaluate(() => window.__MOCK_STORE.get('people/u_test000000000000000001'))).focus));
    for (let i = 0; i < 5; i++) await page.click('[data-step="geo"][data-n="1"]');
    await page.click('[data-step="appraisals"][data-n="1"]');
    await page.waitForSelector('#ap-address'); await page.click('#ap-address'); if (!(await page.$('#ap-address'))) throw new Error('tapping a sheet field closed the sheet');
    await page.fill('#ap-address', '22 Walnut Ave, Mildura'); await page.click('[data-group="category"] [data-v="1-2"]'); await page.click('[data-group="group"] [data-v="hot"]'); await shot('03-appraisal-sheet');
    await page.click('[data-act="save-appraisal"]');
    await page.waitForTimeout(300);
    await page.click('details summary'); // open call sessions
    await page.click('[data-step="calls"][data-n="5"]'); await page.click('[data-step="calls"][data-n="5"]'); await page.click('[data-step="connections"][data-n="1"]');
    await page.fill('#day-note', 'First session done. Two neighbours want the market report.');
    await shot('04-today-filled');
    await page.click('[data-act="done"]');
    await page.waitForSelector('.sheet', { timeout: 5000 }); await shot('05-verdict');
    log('board doc:', JSON.stringify(await page.evaluate(() => window.__MOCK_STORE.get('board/u_test000000000000000001'))).slice(0, 220));
    const verdict = await page.textContent('.sheet'); log('verdict:', verdict.slice(0, 160).replace(/\s+/g, ' '));
    await page.click('.sheet button[data-close]:not([data-nav])'); await page.waitForSelector('.sheet', { state: 'detached' });
    log('pulse card:', !!(await page.$('text=Team pulse'))); await shot('05b-today-after');
    await page.click('#tabbar [data-nav="progress"]');
    await page.waitForSelector('.rings', { timeout: 5000 }); await shot('06-progress');
    log('hscroll progress:', await hasHScroll());
    await page.click('[data-chart="appraisals"]'); await page.waitForTimeout(200);
    await page.click('[data-pipe]'); await page.waitForSelector('.sheet'); await shot('07-pipeline-item'); await page.click('.sheet [data-touch]'); await page.waitForTimeout(300);
    await page.click('#tabbar [data-nav="learn"]'); await page.waitForSelector('.week-nav', { timeout: 5000 }); await shot('08-learn');
    const weekTitle = await page.textContent('h1'); log('learn h1:', weekTitle);
    await page.click('details.lesson summary'); await page.waitForTimeout(200); await shot('09-lesson-open');
    await page.click('[data-read]'); await page.waitForTimeout(300);
    if (await page.$('[data-drill]')) await page.click('[data-drill]');
    await page.click('[data-act="quiz-start"]'); await page.waitForSelector('[data-qpick]');
    for (let i = 0; i < 12; i++) { if (!(await page.$('[data-qpick="0"]:not([disabled])'))) break; await page.click('[data-qpick="0"]:not([disabled])'); await page.waitForTimeout(100); if (await page.$('[data-act="quiz-next"]')) await page.click('[data-act="quiz-next"]'); await page.waitForTimeout(100); }
    await shot('10-quiz-done');
    const scripts = await page.evaluate(() => (window.LAUNCHPAD_CONTENT || {}).scripts ? window.LAUNCHPAD_CONTENT.scripts.length : 0); log('scripts loaded:', scripts);
    await page.click('#tabbar [data-nav="practice"]'); await page.waitForSelector('[data-practice]', { timeout: 5000 }); await shot('11-practice-list');
    await page.click('[data-practice]'); await page.waitForTimeout(400);
    for (const line of ['Hi, it\'s Taylor from Ray White Mildura. Just a courtesy call today.', 'I\'m touching base because we have a local market report out. Your neighbours have loved it. Can I grab your details and send one?', 'Totally understand. It\'s just a report, no obligation. Any real estate needs in the next 12 months?', 'Great. Does Thursday 2pm or 4pm suit?']) {
      if (!(await page.$('#chat-in'))) break; await page.fill('#chat-in', line); await page.click('[data-act="chat-send"]'); await page.waitForTimeout(400);
    }
    await shot('12-practice-chat');
    if (await page.$('[data-act="practice-feedback"]:not([disabled])')) { await page.click('[data-act="practice-feedback"]'); await page.waitForTimeout(600); await shot('13-practice-feedback'); }
    await page.click('#tabbar [data-nav="more"]'); await page.waitForSelector('.sheet'); await page.click('.sheet [data-nav="scripts"]'); await page.waitForSelector('#scripts-q', { timeout: 5000 });
    await page.fill('#scripts-q', 'neighbours'); await page.waitForTimeout(200); await page.click('details.lesson summary'); await shot('14-scripts');
    await page.click('[data-stab="templates"]'); await page.waitForTimeout(200); await shot('15-templates');
    await page.click('#tabbar [data-nav="more"]'); await page.waitForSelector('.sheet'); await page.click('.sheet [data-nav="me"]'); await page.waitForSelector('#me-name'); await shot('16-profile');
    const stored = await page.evaluate(() => Array.from(window.__MOCK_STORE.keys()));
    log('store keys:', stored.join(', '));
    const person = await page.evaluate(() => window.__MOCK_STORE.get('people/u_test000000000000000001'));
    log('summary:', JSON.stringify(person.summary).slice(0, 300));
  } else {
    await page.waitForSelector('.roster', { timeout: 5000 }); await page.waitForTimeout(600); await shot('02-team');
    log('luke in roster before approval:', !!(await page.$('[data-person="u_luke"]')));
    await page.click('[data-approve="u_luke"]'); await page.waitForTimeout(400);
    const cfg0 = await page.evaluate(() => window.__MOCK_STORE.get('config/program')); log('managerIds after approval:', JSON.stringify(cfg0 && cfg0.managerIds), 'emails:', JSON.stringify(cfg0 && cfg0.managerEmails));
    await page.click('summary:has-text("Managers")'); await page.click('[data-demote="u_luke"]'); await page.click('[data-demote-yes="u_luke"]'); await page.waitForTimeout(400);
    const cfg1 = await page.evaluate(() => window.__MOCK_STORE.get('config/program')); log('managerIds after removal:', JSON.stringify(cfg1.managerIds), 'luke role:', (await page.evaluate(() => window.__MOCK_STORE.get('people/u_luke'))).role);
    const lukeStatus = (await page.evaluate(() => window.__MOCK_STORE.get('people/u_luke'))).status; log('luke status after removal (never logged):', lukeStatus);
    if (lukeStatus !== 'left' || cfg1.managerIds.includes('u_luke')) throw new Error('demote: expected Luke out of managerIds with status left');
    await page.click('text=Invite an associate'); await page.waitForTimeout(150); log('invite msg:', (await page.inputValue('#invite-msg')).slice(0, 90).replace(/\n/g, ' '));
    await page.click('[data-act="export-csv"]'); await page.waitForTimeout(500);
    const dls = await page.evaluate(() => window.__MOCK_DOWNLOADS); log('csv:', dls.length ? dls[0].filename + ' ' + dls[0].data.split('\r\n').length + ' lines; ' + dls[0].data.split('\r\n')[1] : 'none');
    log('hscroll team:', await hasHScroll());
    await page.click('[data-person="u_assoc1"]'); await page.waitForSelector('#mgr-notes', { timeout: 5000 }); await page.waitForTimeout(300); await shot('03a-person-focus');
    log('person focus card:', !!(await page.$('text=Two call sessions every morning')));
    await page.click('[data-act="team-back"]'); await page.waitForSelector('.roster');
    await page.click('[data-person="u_assoc2"]'); await page.waitForSelector('#mgr-notes', { timeout: 5000 }); await page.waitForTimeout(300); await shot('03-person');
    const coach = await page.textContent('.card.info'); log('coach:', coach.slice(0, 200).replace(/\s+/g, ' '));
    await page.fill('#mgr-notes', 'Checkpoint 1: agreed two sessions a day.'); await page.click('[data-act="save-notes"]'); await page.waitForTimeout(300);
    await page.click('[data-act="team-back"]'); await page.waitForSelector('.roster');
    await page.click('[data-act="open-settings"]'); await page.waitForSelector('#cf-geo'); await shot('04-settings'); await page.fill('#cf-managers', 'damian@example.com, luke@example.com'); await page.click('[data-act="save-config"]'); await page.waitForTimeout(300);
    await page.click('#tabbar [data-nav="learn"]'); await page.waitForSelector('.week-nav'); const coachNote = await page.$('.card.info'); log('coach note visible:', !!coachNote); await shot('05-learn-manager');
    const cfg = await page.evaluate(() => window.__MOCK_STORE.get('config/program')); log('config saved:', JSON.stringify(cfg).slice(0, 200));
  }
  // desktop + dark
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('http://localhost:' + port + '/#' + (role === 'manager' ? 'team' : 'progress')); await page.waitForTimeout(800); await shot('20-desktop');
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(200); await shot('21-desktop-dark');
  await browser.close();
  if (errors.length) { console.log('[' + role + '] CONSOLE ERRORS:'); errors.forEach(e => console.log('  ', e)); }
  else console.log('[' + role + '] no console errors');
  return errors.length;
}

// ---------- Round-2 regression checks ----------
const pad2 = n => (n < 10 ? '0' : '') + n;
const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); // local date, as the app uses
const addDays = (d, n) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() + n); return x; };
const lastMonday = () => { const t = addDays(new Date(), 0); return addDays(t, -((t.getDay() + 6) % 7)); };
// The app's focus week (Mon to Fri working days, 12 weeks): Mondays counted from the Monday of the first working day to the
// Monday of the last one, clamped to that span, and stored under the date of that Monday.
const monOf = d => addDays(d, -((d.getDay() + 6) % 7));
const isWork = d => d.getDay() >= 1 && d.getDay() <= 5;
const focusFrom = (start, on) => {
  let a = addDays(start, 0); while (!isWork(a)) a = addDays(a, 1);
  let z = addDays(start, 83); while (!isWork(z)) z = addDays(z, -1);
  a = monOf(a); z = monOf(z); let m = monOf(on || new Date()); if (m < a) m = a; if (m > z) m = z;
  return { week: Math.round((m - a) / 604800000) + 1, key: ymd(m) };
};
const prevWorkDay = () => { let d = addDays(new Date(), -1); while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, -1); return ymd(d); };
// Wraps the mock: delay the weeks snapshot, override can('data.write'), refuse the self people set, and record toasts.
const WRAP = `;(function () {
  const W = window.__WRAP || {}; const orig = window.claude.use;
  window.claude.use = async (name) => {
    const v = await orig(name);
    if (name === 'db') return {
      doc: p => { const r = v.doc(p); if (W.failSet && p === W.failSet) return Object.assign({}, r, { set: async () => { throw { code: 'invalid_argument', message: 'below the minimum level' }; } }); return r; },
      collection: p => { const c = v.collection(p); if (!(W.weeksDelay && /\\/weeks$/.test(p))) return c; return Object.assign({}, c, { onSnapshot: (fn, err) => c.onSnapshot(qs => setTimeout(() => fn(qs), W.weeksDelay), err) }); },
    };
    if (name === 'user' && 'canWrite' in W) return Object.assign({}, v, { can: async n => n === 'data.write' ? W.canWrite : null });
    return v;
  };
  window.__TOASTS = [];
  const watch = () => new MutationObserver(() => { const t = document.getElementById('toast-el'); if (t && !t.hidden && t.textContent && window.__TOASTS[window.__TOASTS.length - 1] !== t.textContent) window.__TOASTS.push(t.textContent); }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch);
})();`;
// Records what the app copies (Copy message / Copy text).
const CLIP = `;(function () { window.__CLIP = []; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__CLIP.push(t); } } }); } catch (e) { } })();`;
async function extras(port) {
  const errors = []; const expected = [];
  const browser = await chromium.launch();
  const log = (...a) => console.log('[extras]', ...a);
  const expect = (cond, msg) => { if (!cond) throw new Error('check failed: ' + msg); log('ok:', msg); };
  const open = async (mock, hash, opts) => {
    opts = opts || {};
    const ctx = opts.ctx || await browser.newContext(Object.assign({ viewport: opts.viewport || { width: 390, height: 844 }, colorScheme: 'light' }, opts.tz ? { timezoneId: opts.tz } : {}, opts.ctxOpts || {}));
    const page = await ctx.newPage(); const tag = opts.tag || hash;
    if (opts.time) await page.clock.setFixedTime(new Date(opts.time));
    const sink = opts.expectErrors ? expected : errors;
    page.on('console', m => { if (m.type() === 'error') sink.push(tag + ': ' + m.text()); });
    page.on('pageerror', e => errors.push(tag + ': PAGEERROR ' + e.message));
    await page.addInitScript({ content: 'window.__MOCK=' + JSON.stringify(mock) + ';window.__WRAP=' + JSON.stringify(opts.wrap || {}) + ';' + MOCK + WRAP + CLIP });
    await page.goto('http://localhost:' + port + '/#' + hash);
    return page;
  };
  const store = page => page.evaluate(() => Object.fromEntries(Array.from(window.__MOCK_STORE.entries())));
  const viewText = async page => (await page.textContent('#view')).replace(/\s+/g, ' ');
  const toasts = page => page.evaluate(() => window.__TOASTS.join(' | '));
  const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const ME = 'u_test000000000000000001';
  const assoc = (id, name, extra) => Object.assign({ id, name, email: id + '@example.com', role: 'associate', startDate: ymd(addDays(new Date(), -20)), farm: 'Irymple', status: 'active', welcomed: true, lastLogDate: null, summary: null }, extra || {});
  const boardRow = (name, extra) => Object.assign({ name, week: 3, totals: { geo: 40, appraisals: 3, listings: 0 }, targets: { geo: 300, appraisals: 30, listings: 3 }, streak: 0, lastLogDate: null, status: 'active', updatedAt: new Date().toISOString() }, extra || {});
  const asMe = { role: 'associate', canEdit: false, isOwner: false, name: 'Taylor Associate' };
  const asOwner = { role: 'manager', canEdit: true, isOwner: true, id: 'u_owner', name: 'Damian Portaro', email: 'damian@x.com' };
  try {
    // 1. This week's three on a fixed Melbourne clock: the weeksLoaded guard, Monday-dated week docs, and the last Monday of a
    //    Friday start (30 Oct 2026 to Thu 21 Jan 2027). Mon 18 Jan opens a fresh week 13 with chips from Learn week 12, and last
    //    week's three (stored under 2027-01-11) stay where they are. The round-3 rule clamped to 12 and kept last week's card.
    const mel = 'Australia/Melbourne';
    {
      const seed = {
        'config/program': { managerIds: ['u_owner'], managerEmails: ['damian@x.com'], teamBoard: true },
        ['people/' + ME]: assoc(ME, 'Taylor Associate', { startDate: '2026-10-30' }),
        ['people/' + ME + '/weeks/2027-01-11']: { week: 12, monday: '2027-01-11', items: [{ text: 'Last week A', done: true }, { text: 'Last week B', done: true }, { text: 'Last week C', done: true }] },
        ['people/' + ME + '/pipeline/p1']: { address: '14 Riverside Ave, Mildura', kind: 'curbside', category: '1-2', group: 'warm', plan: '1 month plan', date: '2027-01-12', status: 'active', lastTouch: '2027-01-12', nextTouch: '2027-01-19', notes: '' },
      };
      const page = await open(Object.assign({ seed }, asMe), 'today', { tag: 'weeks-final', wrap: { weeksDelay: 1500 }, tz: mel, time: '2027-01-18T10:00:00+11:00' });
      await page.waitForSelector('[data-step="geo"][data-n="1"]', { timeout: 5000 });
      expect(/Loading your week/.test(await viewText(page)), 'This week\'s three waits for the weeks snapshot');
      expect(!(await page.$('[data-focus-add]')) && !(await page.$('#focus-in')) && !(await page.$('[data-focus-tick]')), 'no chips, input or ticks before it lands');
      await page.waitForSelector('[data-focus-add]', { timeout: 5000 });
      let st = await store(page);
      expect(st['people/' + ME + '/weeks/2027-01-11'].items.length === 3, 'stored commitments untouched');
      const txt = await viewText(page);
      expect(/Week 12 · Day 57 of 60/.test(txt) && /Pick three things/.test(txt) && !/Last week A/.test(txt), 'last Monday of a Friday start opens a fresh week');
      expect(!/This week's three · Week/.test(txt), 'card is labelled without a week number');
      const chips = await page.$$eval('[data-focus-add]', bs => bs.map(b => b.dataset.focusAdd));
      const drills12 = await page.evaluate(() => window.LAUNCHPAD_CONTENT.weeks.find(w => w.week === 12).drills.map(d => d.title));
      expect(chips.length && chips.every(c => drills12.includes(c)) && /This week in Learn · Week 12/.test(txt), 'drill chips come from the Learn week (12), like the teaser');
      await page.click('[data-focus-add]'); await page.waitForFunction(id => { const p = window.__MOCK_STORE.get('people/' + id); return p && p.focus && p.focus.total === 1; }, ME, { timeout: 5000 });
      st = await store(page);
      expect(st['people/' + ME].focus.week === 13 && st['people/' + ME].focus.monday === '2027-01-18' && st['people/' + ME + '/weeks/2027-01-18'].items.length === 1 && st['people/' + ME + '/weeks/2027-01-11'].items.length === 3, 'the new three is stored under 2027-01-18 as week 13, last week untouched');
      await page.click('[data-step="geo"][data-n="1"]');
      await page.waitForFunction(id => { const p = window.__MOCK_STORE.get('people/' + id); return p && p.summary; }, ME, { timeout: 5000 });
      const sum = (await store(page))['people/' + ME].summary;
      expect(sum.focusWeek === 13 && sum.focusWeek === (await store(page))['people/' + ME].focus.week, 'summary.focusWeek matches focus.week (program week ' + sum.week + ')');
      const labels = await page.evaluate(() => ({ remove: Array.from(document.querySelectorAll('[data-focus-remove]')).map(b => b.getAttribute('aria-label')) }));
      expect(labels.remove.length && labels.remove.every(l => /^Remove: ./.test(l)), 'Remove buttons name their commitment');
      // Call sessions: a visible cue, and it stays open when a number is tapped.
      await page.click('details.calls summary'); await page.click('[data-step="geo"][data-n="1"]'); await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.querySelector('details.calls').open && /›/.test(document.querySelector('details.calls summary').textContent)), 'Call sessions shows a chevron and stays open after a tap');
      // Progress for someone with no calls, appraisals or role-plays: plain words, not a dash.
      await page.click('#tabbar [data-nav="progress"]'); await page.waitForSelector('.kpis');
      const prog = await viewText(page);
      expect(/Not yet/.test(prog) && !/[\u2013\u2014]/.test(prog), 'empty Progress tiles say Not yet, with no en or em dash');
      await page.click('[data-pipe="p1"]'); await page.waitForSelector('.sheet #pl-notes'); await page.waitForTimeout(200);
      expect(await page.evaluate(() => document.activeElement.classList.contains('sheet')), 'pipeline sheet opens without focusing Notes (no phone keyboard)');
      await page.context().close();
    }
    //    Weekend start: set up on Sat 31 Oct with the default start date. The three picked that weekend belong to the first working
    //    week (stored under Mon 2 Nov), are still this week's three on the Monday with week-1 chips, and stay put when the start date
    //    is moved to the Monday in Profile.
    {
      const seed = {
        'config/program': { managerIds: ['u_owner'], managerEmails: ['damian@x.com'], teamBoard: true },
        ['people/' + ME]: assoc(ME, 'Taylor Associate', { startDate: '2026-10-31' }),
      };
      const sat = await open(Object.assign({ seed }, asMe), 'today', { tag: 'weekend-sat', tz: mel, time: '2026-10-31T10:00:00+11:00' });
      await sat.waitForSelector('[data-focus-add]', { timeout: 5000 }); await sat.click('[data-focus-add]');
      await sat.waitForFunction(id => { const p = window.__MOCK_STORE.get('people/' + id); return p && p.focus && p.focus.total === 1; }, ME, { timeout: 5000 });
      let st = await store(sat);
      expect(st['people/' + ME + '/weeks/2026-11-02'] && st['people/' + ME].focus.week === 1, 'a weekend pick is stored under the first Monday as week 1');
      await sat.context().close();
      const mon = await open(Object.assign({ seed: st }, asMe), 'today', { tag: 'weekend-mon', tz: mel, time: '2026-11-02T09:30:00+11:00' });
      await mon.waitForSelector('[data-focus-tick="0"]', { timeout: 5000 });
      let txt = await viewText(mon);
      const chips = await mon.$$eval('[data-focus-add]', bs => bs.map(b => b.dataset.focusAdd));
      const drills1 = await mon.evaluate(() => window.LAUNCHPAD_CONTENT.weeks.find(w => w.week === 1).drills.map(d => d.title));
      expect(/Week 1 · Day 1 of 60/.test(txt) && /0 of 1 done/.test(txt) && chips.length && chips.every(c => drills1.includes(c)), 'first Monday: the weekend pick is this week\'s, chips from week 1');
      await mon.goto('http://localhost:' + port + '/#me'); await mon.waitForSelector('#me-start'); await mon.fill('#me-start', '2026-11-02'); await mon.click('[data-act="save-me"]');
      await mon.waitForFunction(id => window.__MOCK_STORE.get('people/' + id).startDate === '2026-11-02', ME, { timeout: 5000 });
      await mon.click('#tabbar [data-nav="today"]'); await mon.waitForSelector('[data-focus-tick="0"]', { timeout: 5000 });
      expect(/0 of 1 done/.test(await viewText(mon)), 'moving the start date keeps this week\'s three');
      await mon.context().close();
    }
    // 2. Team pulse streak rule, the pulse filters, and phone layout on Today (360x740).
    {
      const t = ymd(new Date());
      const seed = {
        'config/program': { managerIds: ['u_owner', 'u_orphan'], managerEmails: ['damian@x.com'], teamBoard: true },
        ['people/' + ME]: assoc(ME, 'Taylor Associate'),
        ['people/' + ME + '/weeks/' + focusFrom(addDays(new Date(), -20)).key]: { week: focusFrom(addDays(new Date(), -20)).week, items: [{ text: 'Door-knock Walnut Ave on Thursday and Friday afternoons', done: false }] },
        'board/u_stale': boardRow('Riley Chen', { streak: 12, lastLogDate: ymd(addDays(new Date(), -14)) }),
        'board/u_live': boardRow('Sam Lee', { streak: 5, lastLogDate: prevWorkDay() }),
        'board/u_today': boardRow('Alex Montgomery-Fitzgerald', { streak: 7, lastLogDate: t }),
        'board/u_orphan': boardRow('Morgan Promoted', { streak: 9, lastLogDate: t }),
        'board/u_mgr': boardRow('Pat Manager', { status: 'manager', streak: 4, lastLogDate: t }),
        ['board/' + ME]: boardRow('Taylor Associate', { streak: 3, lastLogDate: ymd(addDays(new Date(), -10)) }),
      };
      const page = await open(Object.assign({ seed }, asMe), 'today', { tag: 'pulse-360', viewport: { width: 360, height: 740 } });
      await page.waitForSelector('.pulse-row', { timeout: 5000 }); await page.waitForSelector('[data-focus-tick="0"]', { timeout: 5000 });
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.pulse-row')).map(r => { const a = r.querySelector('.avatar').getBoundingClientRect(); const n = r.querySelector('.t').getBoundingClientRect(); const svg = r.querySelector('.pill svg'); return { name: r.querySelector('.t').textContent, pills: (r.querySelector('.pulse-pills') || { textContent: '' }).textContent, inline: n.left >= a.right - 1 && n.top < a.bottom, svg: svg ? svg.getBoundingClientRect().width : null }; }));
      const row = n => rows.find(r => r.name.startsWith(n)) || {};
      expect(!row('Riley Chen').pills.includes('12'), 'stale streak hidden (last log 14 days ago)');
      expect(/5 day streak/.test(row('Sam Lee').pills), 'streak kept when the last log was the previous working day');
      expect(/7 day streak/.test(row('Alex').pills) && /Logged today/.test(row('Alex').pills), 'streak and Logged today for a log today');
      expect(!/3 day streak/.test(row('Taylor').pills), 'same rule on the viewer\'s own row');
      expect(!rows.some(r => /Morgan|Pat Manager/.test(r.name)), 'managers (in managerIds or status manager) are not in the pulse');
      expect(rows.every(r => r.inline), 'pulse avatar stays on the line of the name');
      expect(rows.filter(r => r.svg != null).every(r => r.svg > 8 && r.svg < 24), 'streak flame has a size in the pill');
      const tick = await page.evaluate(() => { const b = document.querySelector('[data-focus-tick="0"]'); const c = b.querySelector('.check').getBoundingClientRect(); const x = b.querySelector('.t').getBoundingClientRect(); return x.left >= c.right - 1 && x.top < c.bottom; });
      expect(tick, 'focus checkbox stays on the line of a long commitment');
      expect(await noHScroll(page), 'no horizontal scroll on Today at 360');
      await page.click('[data-step="appraisals"][data-n="1"]'); await page.waitForSelector('#ap-address');
      await page.waitForTimeout(300);
      const acts = await page.evaluate(() => ['[data-act="save-appraisal"]', '.sheet [data-close]:not(.backdrop)'].map(s => { const b = document.querySelector(s).getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return b.bottom <= innerHeight && !!hit && !!hit.closest(s); }));
      expect(acts.every(Boolean), 'appraisal sheet Save and Skip visible at 360x740 without scrolling');
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('.sheet') && !document.activeElement.classList.contains('sheet')), 'Shift+Tab right after the appraisal sheet opens stays inside it');
      await page.click('.sheet .btn.ghost[data-close]'); await page.waitForSelector('.sheet', { state: 'detached' });
      await page.click('#tabbar [data-nav="more"]'); await page.waitForSelector('.sheet [data-nav="me"]');
      const more = await page.evaluate(() => { const b = document.querySelector('.sheet [data-nav="me"]').getBoundingClientRect(); return { inView: b.bottom <= innerHeight, icons: Array.from(document.querySelectorAll('.sheet .item svg')).map(s => Math.round(s.getBoundingClientRect().width)) }; });
      expect(more.inView && more.icons.every(w => w > 0 && w <= 24), 'More sheet icons sized, Profile in view (' + more.icons.join(',') + ')');
      await page.context().close();
    }
    // 3. Status 'left': calm card, no welcome, no nags, no pulse; the board follows status changes while open.
    {
      const seed = {
        'config/program': { managerIds: ['u_owner'], managerEmails: ['damian@x.com'], teamBoard: true },
        ['people/' + ME]: assoc(ME, 'Taylor Associate', { status: 'left', welcomed: undefined, startDate: ymd(addDays(new Date(), -30)) }),
        'board/u_p1': boardRow('Riley Chen', { lastLogDate: ymd(new Date()) }), 'board/u_p2': boardRow('Sam Lee'),
      };
      const page = await open(Object.assign({ seed }, asMe), 'today', { tag: 'left', viewport: { width: 360, height: 740 } });
      await page.waitForSelector('text=Not in the program right now', { timeout: 5000 }); await page.waitForTimeout(500);
      let txt = await viewText(page);
      expect(/You're not in the Launchpad program right now\. Learn and Scripts stay open\. If you should be in it, ask Damian to set you active\./.test(txt), 'status left shows the read-only card');
      expect(!(await page.$('.sheet')) && !(await store(page))['people/' + ME].welcomed, 'no welcome sheet for status left');
      expect(!(await page.$('[data-step]')) && !/Team pulse|was not logged|Behind/.test(txt), 'no daily sheet, nags, verdicts or pulse');
      for (const h of ['progress', 'team']) { await page.goto('http://localhost:' + port + '/#' + h); await page.waitForTimeout(300); expect(/not in the Launchpad program right now/.test(await viewText(page)), '#' + h + ' shows the same card'); }
      await page.click('#tabbar [data-nav="learn"]'); await page.waitForSelector('.week-nav'); expect(true, 'Learn stays open');
      const setStatus = st => page.evaluate(async ([id, st]) => { const db = await window.claude.use('db'); await db.doc('people/' + id).update({ status: st }); }, [ME, st]);
      await page.click('#tabbar [data-nav="today"]'); await setStatus('active');
      await page.waitForSelector('[data-step="geo"][data-n="1"]', { timeout: 5000 });
      if (await page.$('.sheet')) { await page.click('.sheet button[data-close]'); await page.waitForSelector('.sheet', { state: 'detached' }); }
      await page.waitForSelector('text=Team pulse', { timeout: 5000 }); expect(true, 'set active while open: daily sheet and pulse appear');
      await setStatus('left'); await page.waitForSelector('text=Not in the program right now', { timeout: 5000 });
      expect(!/Team pulse/.test(await viewText(page)), 'set left while open: back to the card, pulse gone');
      await page.context().close();
    }
    // 4. Promote an associate shared as Contributor, then put them back; the owner's roster snapshot prunes stale config.
    {
      const days = workDaysBack(5);
      const seed = {
        'config/program': { managerIds: ['u_owner', 'u_stale'], managerEmails: ['damian@x.com', 'u_stale@example.com'], teamBoard: true },
        'people/u_owner': assoc('u_owner', 'Damian Portaro', { role: 'manager', email: 'damian@x.com' }),
        'people/u_a1': assoc('u_a1', 'Jordan Blake', { lastLogDate: days[days.length - 1] }),
        'people/u_stale': assoc('u_stale', 'Sam Ortiz'),
        'board/u_a1': boardRow('Jordan Blake', { streak: 5, lastLogDate: days[days.length - 1] }),
      };
      days.forEach(d => { seed['people/u_a1/days/' + d] = { date: d, geo: 3, appraisals: 0, listings: 0, closed: true }; });
      const owner = await open(Object.assign({ seed }, asOwner), 'team', { tag: 'promote-owner' });
      await owner.waitForFunction(() => !window.__MOCK_STORE.get('config/program').managerIds.includes('u_stale'), null, { timeout: 5000 });
      let cfg = (await store(owner))['config/program'];
      expect(!cfg.managerEmails.includes('u_stale@example.com') && cfg.managerEmails.includes('damian@x.com') && cfg.managerIds.includes('u_owner'), 'owner roster snapshot drops a stale managerIds entry and its email');
      await owner.click('[data-person="u_a1"]'); await owner.waitForSelector('#tp-role', { timeout: 5000 });
      expect(/Managers must be shared as Editor\./.test(await owner.evaluate(() => document.getElementById('tp-role').closest('.card').textContent)), 'Role select notes that managers must be shared as Editor');
      await owner.selectOption('#tp-role', 'manager'); await owner.click('[data-act="save-person"]');
      await owner.waitForFunction(() => (window.__MOCK_STORE.get('board/u_a1') || {}).status === 'manager', null, { timeout: 5000 });
      let st = await store(owner);
      expect(st['config/program'].managerIds.includes('u_a1') && st['people/u_a1'].role === 'manager', 'promotion writes role and managerIds');
      expect(/Managers must be shared as Editor/.test(await toasts(owner)), 'promotion toast reminds about Editor sharing');
      const jordan = await open({ role: 'associate', canEdit: false, isOwner: false, id: 'u_a1', name: 'Jordan Blake', seed: st }, 'today', { tag: 'promoted-contributor' });
      await jordan.waitForSelector('text=One more step', { timeout: 5000 });
      expect(/Damian has made you a manager, but this page is shared with you as Contributor\. Ask him to change your sharing to Editor, then reload\./.test(await viewText(jordan)), 'promoted Contributor is told to ask for Editor');
      expect(!(await jordan.$('[data-act="cancel-request"]')) && !/Waiting for approval|You asked for manager access/.test(await viewText(jordan)), 'no cancel button and no approval wording');
      await jordan.context().close();
      expect((st['config/program'].managerEmailById || {}).u_a1 === 'u_a1@example.com', 'promotion records the report address for the new manager');
      await owner.fill('#tp-email', 'jordan.new@example.com'); await owner.click('[data-act="save-person"]');
      await owner.waitForFunction(() => window.__MOCK_STORE.get('config/program').managerEmails.includes('jordan.new@example.com'), null, { timeout: 5000 });
      st = await store(owner);
      expect(!st['config/program'].managerEmails.includes('u_a1@example.com') && st['config/program'].managerEmailById.u_a1 === 'jordan.new@example.com', 'editing a manager\'s email on their page swaps it on the report list');
      await owner.selectOption('#tp-role', 'associate'); await owner.click('[data-act="save-person"]');
      await owner.waitForFunction(() => !window.__MOCK_STORE.get('config/program').managerIds.includes('u_a1'), null, { timeout: 5000 });
      st = await store(owner); const em = st['config/program'].managerEmails;
      expect(st['board/u_a1'].status === 'active' && !em.includes('u_a1@example.com') && !em.includes('jordan.new@example.com') && em.includes('damian@x.com') && !('u_a1' in st['config/program'].managerEmailById) && st['people/u_a1'].role === 'associate', 'setting back to associate clears config (old and new address) and puts the board row back to active');
      await owner.context().close();
    }
    // 5. Declining a manager request: associate, status left, declinedAt; the requester is told once.
    {
      const seed = {
        'config/program': { managerIds: ['u_owner'], managerEmails: ['damian@x.com'], teamBoard: true },
        'people/u_owner': assoc('u_owner', 'Damian Portaro', { role: 'manager', email: 'damian@x.com' }),
        'people/u_pat': assoc('u_pat', 'Pat Assistant', { role: 'manager-pending', startDate: ymd(new Date()), welcomed: undefined }),
        'people/u_kim': assoc('u_kim', 'Kim Nguyen', { role: 'manager-pending', startDate: ymd(new Date()), welcomed: undefined }),
        'people/u_a1': assoc('u_a1', 'Jordan Blake'),
      };
      const owner = await open(Object.assign({ seed }, asOwner), 'team', { tag: 'decline-owner' });
      await owner.click('[data-decline="u_pat"]');
      await owner.waitForFunction(() => window.__MOCK_STORE.get('people/u_pat').role === 'associate', null, { timeout: 5000 });
      const st = await store(owner); const pat = st['people/u_pat'];
      expect(pat.status === 'left' && !!pat.declinedAt, 'decline sets status left and declinedAt');
      expect(/Declined\. If they are doing the program, set them Active on their page\./.test(await toasts(owner)), 'decline toast tells Damian how to undo');
      // Kim switches to the program on the server, and Damian taps Decline before his roster snapshot shows it.
      await owner.evaluate(() => { const k = window.__MOCK_STORE.get('people/u_kim'); window.__MOCK_STORE.set('people/u_kim', Object.assign({}, k, { role: 'associate' })); });
      await owner.click('[data-decline="u_kim"]');
      await owner.waitForFunction(() => /already changed their request/.test(window.__TOASTS.join('|')), null, { timeout: 5000 });
      const kim = (await store(owner))['people/u_kim'];
      expect(kim.role === 'associate' && kim.status === 'active' && !kim.declinedAt, 'Decline on a request that was just cancelled changes nothing');
      const page = await open({ role: 'manager', canEdit: true, isOwner: false, id: 'u_pat', name: 'Pat Assistant', seed: st }, 'today', { tag: 'declined' });
      await page.waitForSelector('text=Your manager request was declined', { timeout: 5000 }); await page.waitForTimeout(400);
      expect(/not in the Launchpad program right now/.test(await viewText(page)) && !(await page.$('.sheet')), 'requester sees the decline on the left card, no welcome');
      await page.reload(); await page.waitForSelector('text=Not in the program right now', { timeout: 5000 });
      expect(!/declined/.test(await viewText(page)), 'the decline line shows once');
      await page.context().close();
      await owner.click('[data-tfilter="all"]'); await owner.click('[data-person="u_pat"]'); await owner.waitForSelector('#tp-status', { timeout: 5000 });
      await owner.selectOption('#tp-status', 'active'); await owner.click('[data-act="save-person"]');
      await owner.waitForFunction(() => window.__MOCK_STORE.get('people/u_pat').status === 'active', null, { timeout: 5000 });
      expect(!(await store(owner))['people/u_pat'].declinedAt, 'setting a declined person Active clears declinedAt');
      await owner.context().close();
    }
    // 6. Team cards at 360px with realistic long emails; pending manager's profile and the cancel confirmation.
    {
      const seed = {
        'config/program': { managerIds: ['u_owner', 'u_sam'], managerEmails: ['damian@x.com', 'samantha.oconnell@raywhite.com'], teamBoard: true },
        'people/u_owner': assoc('u_owner', 'Damian Portaro', { role: 'manager', email: 'damian.portaro@raywhite.com' }),
        'people/u_luke': assoc('u_luke', 'Luke Hermans', { role: 'manager-pending', email: 'luke.hermans@raywhite.com', startDate: ymd(new Date()), welcomed: undefined }),
        'people/u_sam': assoc('u_sam', 'Samantha O\'Connell', { role: 'manager', email: 'samantha.oconnell@raywhite.com' }),
        'people/u_a1': assoc('u_a1', 'Alexandra Montgomery-Fitzgerald', { email: 'alexandra.montgomery-fitzgerald@raywhite.com' }),
      };
      const owner = await open(Object.assign({ seed }, asOwner), 'team', { tag: 'team-360', viewport: { width: 360, height: 740 } });
      await owner.waitForSelector('[data-approve="u_luke"]', { timeout: 5000 }); await owner.waitForSelector('.roster'); await owner.waitForTimeout(400);
      expect(await noHScroll(owner), 'Team at 360: no horizontal overflow with the request card');
      await owner.click('summary:has-text("Managers")'); await owner.waitForSelector('[data-demote="u_sam"]', { state: 'visible' });
      const btn = await owner.evaluate(() => document.querySelector('[data-demote="u_sam"]').getBoundingClientRect().right);
      expect(await noHScroll(owner) && btn <= 360, 'Team at 360: Managers open, Remove inside the screen');
      await owner.click('[data-demote="u_sam"]'); await owner.waitForSelector('.sheet [data-demote-yes]');
      const sheetTxt = (await owner.textContent('.sheet')).replace(/\s+/g, ' ');
      expect(await noHScroll(owner) && /status left/.test(sheetTxt) && /until you change their sharing/.test(sheetTxt), 'demote sheet fits and says what happens');
      await owner.context().close();
      const luke = await open({ role: 'manager', canEdit: true, isOwner: false, id: 'u_luke', name: 'Luke Hermans', seed }, 'me', { tag: 'pending-360', viewport: { width: 360, height: 740 } });
      await luke.waitForSelector('#me-name', { timeout: 5000 });
      expect(!(await luke.$('#me-farm')) && !(await luke.$('#me-start')) && !/Started/.test(await viewText(luke)), 'pending manager profile has no associate fields');
      await luke.click('#tabbar [data-nav="today"]'); await luke.click('[data-act="cancel-request"]'); await luke.waitForSelector('.sheet [data-act="cancel-request-yes"]');
      expect((await store(luke))['people/u_luke'].role === 'manager-pending', 'cancel asks first and changes nothing yet');
      await luke.click('.sheet [data-act="cancel-request-yes"]');
      await luke.waitForFunction(() => window.__MOCK_STORE.get('people/u_luke').role === 'associate', null, { timeout: 5000 });
      expect(true, 'Switch makes them an associate');
      await luke.context().close();
    }
    // 7. View-only: canWrite false shows the card up front; canWrite unknown switches to it when the create is refused.
    {
      const page = await open(Object.assign({ seed: {} }, asMe), 'today', { tag: 'view-only', wrap: { canWrite: false } });
      await page.waitForSelector('text=This page is view-only for you', { timeout: 5000 });
      expect(!(await page.$('#onb')) && /Contributor if you are on the office Claude plan, or as Editor if you use your own Claude account/.test(await viewText(page)), 'canWrite false: view-only card instead of onboarding');
      await page.context().close();
      const g = await open(Object.assign({ seed: {} }, asMe), 'today', { tag: 'guest', wrap: { canWrite: null, failSet: 'people/' + ME }, expectErrors: true });
      await g.waitForSelector('#onb'); await g.fill('#onb-farm', 'Mildura South'); await g.click('#onb button[type=submit]');
      await g.waitForSelector('text=This page is view-only for you', { timeout: 5000 });
      expect(/Ask Damian to share it with you as Contributor if you are on the office Claude plan, or as Editor/.test(await toasts(g)), 'refused create: toast gives both sharing options, then the view-only card');
      expect(!/view-only for you\. Ask/.test(await viewText(g)) && /view-only for youAsk Damian/.test(await viewText(g)), 'view-only card does not repeat its heading in the body');
      const tb = await g.evaluate(() => { const r = document.getElementById('toast-el').getBoundingClientRect(); return { w: r.width, h: r.height, iw: innerWidth }; });
      expect(tb.w >= tb.iw - 40 && tb.h < tb.w / 2, 'long toast spans the screen width instead of a circle (' + Math.round(tb.w) + 'x' + Math.round(tb.h) + ')');
      expect(!(await g.$('.sheet')), 'no welcome sheet after a refused create');
      await g.context().close();
    }
    // 8. Owner's first onboarding with no managerIds yet: an existing role:'manager' row is adopted, not shown as a request.
    {
      const seed = {
        'config/program': { officeName: 'Ray White Mildura', managerEmails: [] },
        'people/u_luke': assoc('u_luke', 'Luke Hermans', { role: 'manager', email: 'luke@x.com' }),
      };
      const owner = await open(Object.assign({ seed }, asOwner), 'team', { tag: 'owner-first' });
      await owner.waitForSelector('#onb'); await owner.click('#onb button[type=submit]');
      await owner.waitForFunction(() => { const c = window.__MOCK_STORE.get('config/program'); return c && Array.isArray(c.managerIds) && c.managerIds.includes('u_luke'); }, null, { timeout: 5000 });
      await owner.waitForSelector('text=Team Launchpad', { timeout: 5000 }); await owner.waitForTimeout(300);
      const cfg = (await store(owner))['config/program'];
      expect(cfg.managerIds.includes('u_owner') && cfg.managerEmails.includes('damian@x.com') && !(await owner.$('[data-approve="u_luke"]')), 'owner\'s first onboarding adopts the existing manager row');
      await owner.context().close();
    }
    // 9. Approve and Decline: the buttons give way to a label as soon as one is tapped, so a second tap cannot queue a second job
    //    (which used to replace the success toast with "already changed their request"). A request handled on another device
    //    gets a message that says what happened.
    {
      const pend = (id, name) => assoc(id, name, { role: 'manager-pending', email: id + '@x.com', startDate: ymd(new Date()), welcomed: undefined });
      const seed = {
        'config/program': { managerIds: ['u_owner'], managerEmails: ['damian@x.com'], managerEmailById: { u_owner: 'damian@x.com' }, teamBoard: true },
        'people/u_owner': assoc('u_owner', 'Damian Portaro', { role: 'manager', email: 'damian@x.com' }),
        'people/u_luke': pend('u_luke', 'Luke Hermans'), 'people/u_kim': pend('u_kim', 'Kim Nguyen'), 'people/u_pat': pend('u_pat', 'Pat Assistant'),
      };
      const owner = await open(Object.assign({ seed }, asOwner), 'team', { tag: 'approve-busy' });
      await owner.waitForSelector('[data-approve="u_luke"]', { timeout: 5000 });
      const tap = await owner.evaluate(() => { document.querySelector('[data-approve="u_luke"]').click(); return { again: !!document.querySelector('[data-approve="u_luke"], [data-decline="u_luke"]'), label: /Approving/.test(document.getElementById('view').textContent) }; });
      expect(!tap.again && tap.label, 'Approve gives way to "Approving" at once, with no second button to tap');
      await owner.waitForFunction(() => /Luke is now a manager/.test(window.__TOASTS.join('|')), null, { timeout: 5000 }); await owner.waitForTimeout(300);
      expect(!/already/.test(await toasts(owner)) && (await store(owner))['config/program'].managerIds.includes('u_luke'), 'one approval, one success toast');
      await owner.evaluate(async () => {
        const db = await window.claude.use('db'); const c = window.__MOCK_STORE.get('config/program');
        await db.doc('config/program').set(Object.assign({}, c, { managerIds: c.managerIds.concat(['u_kim']) }));
        const k = window.__MOCK_STORE.get('people/u_kim'); window.__MOCK_STORE.set('people/u_kim', Object.assign({}, k, { role: 'manager' }));
        const p = window.__MOCK_STORE.get('people/u_pat'); window.__MOCK_STORE.set('people/u_pat', Object.assign({}, p, { role: 'associate', status: 'left', declinedAt: new Date().toISOString() }));
      });
      await owner.click('[data-approve="u_kim"]'); await owner.waitForFunction(() => /Kim is already a manager\./.test(window.__TOASTS.join('|')), null, { timeout: 5000 });
      await owner.click('[data-decline="u_pat"]'); await owner.waitForFunction(() => /Pat's request is already declined\./.test(window.__TOASTS.join('|')), null, { timeout: 5000 });
      expect(true, 'a request handled elsewhere says "already a manager" or "already declined"');
      await owner.context().close();
    }
    // 10. Targets: saving a person's page with the targets at the defaults stores no override (a legacy pin is cleared), so they
    //     follow Program settings; one changed target is stored alone (the others null), and pace.js fills nulls from the config.
    {
      const seed = {
        'config/program': { managerIds: ['u_owner'], managerEmails: ['damian@x.com'], managerEmailById: { u_owner: 'damian@x.com' }, targets: { geo: 300, appraisals: 30, listings: 3 }, teamBoard: true },
        'people/u_owner': assoc('u_owner', 'Damian Portaro', { role: 'manager', email: 'damian@x.com' }),
        'people/u_a1': assoc('u_a1', 'Jordan Blake', { targets: { geo: 300, appraisals: 30, listings: 3 } }),
        'board/u_a1': boardRow('Jordan Blake'),
      };
      const owner = await open(Object.assign({ seed }, asOwner), 'team', { tag: 'targets' });
      await owner.click('[data-person="u_a1"]'); await owner.waitForSelector('#tp-farm', { timeout: 5000 });
      await owner.fill('#tp-farm', 'Irymple North'); await owner.click('[data-act="save-person"]');
      await owner.waitForFunction(() => window.__MOCK_STORE.get('people/u_a1').farm === 'Irymple North', null, { timeout: 5000 }); await owner.waitForTimeout(200);
      let st = await store(owner);
      expect(st['people/u_a1'].targets === null && st['board/u_a1'].targets.geo === 300, 'saving other settings stores no target override');
      await owner.fill('#tp-geo', '350'); await owner.click('[data-act="save-person"]');
      await owner.waitForFunction(() => (window.__MOCK_STORE.get('people/u_a1').targets || {}).geo === 350, null, { timeout: 5000 });
      st = await store(owner); const t = st['people/u_a1'].targets;
      expect(t.appraisals === null && t.listings === null, 'a changed target is stored alone');
      await owner.context().close();
      const P = require(path.join(ROOT, 'pace.js'));
      const snap = P.snapshot({ startDate: ymd(addDays(new Date(), -20)), targets: t }, { targets: { geo: 250, appraisals: 25, listings: 4 }, weeks: 12 }, []);
      expect(snap.targets.geo === 350 && snap.targets.appraisals === 25 && snap.targets.listings === 4, 'the others follow the program default (' + JSON.stringify(snap.targets) + ')');
    }
    // 11. The Monday report list. A manager's profile email changed without a config write (shared as Contributor) is caught up
    //     by Damian's Team page. A settings sheet left open writes only what was changed in it, onto the newer config. Remove as
    //     manager offers addresses typed into Program settings, so the removed manager's work address can come off too.
    {
      const seed = {
        'config/program': { managerIds: ['u_owner', 'u_luke', 'u_jordan'], managerEmails: ['damian@x.com', 'luke.hermans@gmail.com', 'jordan@gmail.com'], managerEmailById: { u_owner: 'damian@x.com', u_luke: 'luke.hermans@gmail.com', u_jordan: 'jordan@gmail.com' }, targets: { geo: 300, appraisals: 30, listings: 3 }, teamBoard: true },
        'people/u_owner': assoc('u_owner', 'Damian Portaro', { role: 'manager', email: 'damian@x.com' }),
        'people/u_luke': assoc('u_luke', 'Luke Hermans', { role: 'manager', email: 'luke.hermans@gmail.com' }),
        'people/u_jordan': assoc('u_jordan', 'Jordan Blake', { role: 'manager', email: 'jordan@gmail.com' }),
      };
      const owner = await open(Object.assign({ seed }, asOwner), 'team', { tag: 'report-list' });
      await owner.waitForSelector('[data-act="open-settings"]', { timeout: 5000 }); await owner.waitForTimeout(300);
      await owner.evaluate(async () => { const db = await window.claude.use('db'); await db.doc('people/u_jordan').update({ email: 'jordan@raywhite.com' }); });
      await owner.waitForFunction(() => window.__MOCK_STORE.get('config/program').managerEmails.includes('jordan@raywhite.com'), null, { timeout: 5000 });
      let cfg = (await store(owner))['config/program'];
      expect(!cfg.managerEmails.includes('jordan@gmail.com') && cfg.managerEmailById.u_jordan === 'jordan@raywhite.com', 'a manager\'s new profile email replaces the old one on the report list');
      await owner.click('[data-act="open-settings"]'); await owner.waitForSelector('#cf-geo'); await owner.waitForTimeout(200);
      expect(await owner.evaluate(() => document.activeElement.classList.contains('sheet')), 'Program settings opens without focusing a field');
      await owner.evaluate(async () => { const db = await window.claude.use('db'); const c = window.__MOCK_STORE.get('config/program'); await db.doc('config/program').set(Object.assign({}, c, { managerEmails: c.managerEmails.concat(['office@x.com']), officeName: 'Ray White Mildura HQ' })); });
      await owner.fill('#cf-geo', '280'); await owner.fill('#cf-managers', 'damian@x.com, luke.hermans@raywhite.com, jordan@raywhite.com'); await owner.click('[data-act="save-config"]');
      await owner.waitForFunction(() => window.__MOCK_STORE.get('config/program').targets.geo === 280, null, { timeout: 5000 });
      cfg = (await store(owner))['config/program'];
      expect(cfg.managerEmails.includes('office@x.com') && cfg.officeName === 'Ray White Mildura HQ' && cfg.managerEmails.includes('luke.hermans@raywhite.com') && !cfg.managerEmails.includes('luke.hermans@gmail.com'), 'a stale settings sheet keeps the newer address and office name, and applies its own edits');
      await owner.click('summary:has-text("Managers")'); await owner.click('[data-demote="u_luke"]'); await owner.waitForSelector('.sheet [data-demote-yes]');
      const offered = await owner.$$eval('.demote-also', bs => bs.map(b => b.value + (b.checked ? ' ticked' : '')));
      expect(offered.includes('luke.hermans@raywhite.com') && offered.includes('office@x.com') && !offered.some(o => /damian|jordan|ticked/.test(o)), 'Remove offers the typed addresses, unticked (' + offered.join(', ') + ')');
      await owner.check('.demote-also[value="luke.hermans@raywhite.com"]'); await owner.click('[data-demote-yes="u_luke"]');
      await owner.waitForFunction(() => !window.__MOCK_STORE.get('config/program').managerIds.includes('u_luke'), null, { timeout: 5000 });
      cfg = (await store(owner))['config/program'];
      expect(!cfg.managerEmails.some(e => /luke/.test(e)) && cfg.managerEmails.includes('office@x.com') && cfg.managerEmails.includes('jordan@raywhite.com'), 'the ticked address comes off with Luke; the rest stay');
      await owner.context().close();
    }
    // 12. Learn: the hero says six modules; a template sheet opens at its title with focus on the sheet; Copy message copies only
    //     the message (no title, guidance or markdown); the quiz moves focus to the next step for keyboard users.
    {
      const seed = { 'config/program': { managerIds: ['u_owner'], managerEmails: ['damian@x.com'], teamBoard: true }, ['people/' + ME]: assoc(ME, 'Taylor Associate') };
      const page = await open(Object.assign({ seed }, asMe), 'learn', { tag: 'learn-copy', viewport: { width: 360, height: 740 } });
      await page.waitForSelector('.week-nav', { timeout: 5000 });
      expect(/Learn · 12 weeks, 6 modules/.test(await page.textContent('.hero .eyebrow')), 'Learn hero says six modules');
      const bad = await page.evaluate(() => window.LAUNCHPAD_CONTENT.templates.filter(t => ['sms', 'email', 'letter'].includes(t.kind)).filter(t => { const m = t.body.split(/\n## /)[0]; return !m.trim() || /^## /m.test(m); }).map(t => t.id));
      expect(!bad.length, 'every letter, email and SMS has its message before the first heading (' + bad.join(', ') + ')');
      const tpl = await page.evaluate(() => { const C = window.LAUNCHPAD_CONTENT; for (const w of C.weeks) for (const id of (w.templates || [])) { const t = C.templates.find(x => x.id === id); if (t && t.kind === 'sms' && /\n## /.test(t.body)) return { week: w.week, id, title: t.title, after: t.body.split(/\n## /)[1].split('\n')[0] }; } return null; });
      await page.click('[data-week="' + tpl.week + '"]'); await page.click('[data-open-template="' + tpl.id + '"]'); await page.waitForSelector('.sheet [data-copy-template]'); await page.waitForTimeout(300);
      const sh = await page.evaluate(() => { const s = document.querySelector('.sheet'); const h = s.querySelector('h3').getBoundingClientRect(); return { top: s.scrollTop, head: h.top >= s.getBoundingClientRect().top - 1, focus: document.activeElement === s, label: s.querySelector('[data-copy-template]').textContent.trim() }; });
      expect(sh.top === 0 && sh.head && sh.focus && sh.label === 'Copy message', 'template sheet opens at its title, focus on the sheet, button says Copy message');
      await page.click('.sheet [data-copy-template]'); await page.waitForTimeout(200);
      const clip = await page.evaluate(() => window.__CLIP[window.__CLIP.length - 1] || '');
      expect(clip.trim() && !clip.startsWith(tpl.title) && !clip.includes(tpl.after) && !/^## |^> |\*\*/m.test(clip), 'Copy message copies only the message (' + clip.length + ' chars)');
      await page.keyboard.press('Escape'); await page.waitForSelector('.sheet', { state: 'detached' });
      await page.focus('[data-act="quiz-start"]'); await page.keyboard.press('Enter');
      expect(await page.evaluate(() => document.activeElement.matches('[data-qpick="0"]')), 'quiz Start moves focus to the first answer');
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => document.activeElement.matches('[data-act="quiz-next"]')), 'an answer moves focus to Next');
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => document.activeElement.matches('[data-qpick="0"]:not([disabled])')), 'Next moves focus to the next question\'s first answer');
      await page.context().close();
    }
    // 13. Manager on a phone: roster avatars stay beside the name; a person's notes sit under the table, inside the screen; the
    //     Team tab goes back to the roster from the bottom of a person page.
    {
      const days = workDaysBack(3);
      const seed = {
        'config/program': { managerIds: ['u_owner'], managerEmails: ['damian@x.com'], managerEmailById: { u_owner: 'damian@x.com' }, teamBoard: true },
        'people/u_owner': assoc('u_owner', 'Damian Portaro', { role: 'manager', email: 'damian@x.com' }),
        'people/u_a1': assoc('u_a1', 'Alexandra Montgomery-Fitzgerald', { lastLogDate: days[2] }),
      };
      days.forEach((d, i) => { seed['people/u_a1/days/' + d] = { date: d, geo: 4, appraisals: 0, listings: 0, calls: 20, connections: 9, appointments: 1, sessions: 1, note: i === 1 ? 'Two neighbours want the market report, follow up Thursday' : '', closed: true }; });
      const owner = await open(Object.assign({ seed }, asOwner), 'team', { tag: 'team-phone', viewport: { width: 360, height: 740 } });
      await owner.waitForSelector('.roster .person .bars', { timeout: 5000 });
      expect(await owner.evaluate(() => Array.from(document.querySelectorAll('.person .head')).every(h => { const a = h.querySelector('.avatar').getBoundingClientRect(); const n = h.querySelector('strong').getBoundingClientRect(); return n.left >= a.right - 1 && n.top < a.bottom; })), 'roster avatar stays on the line of the name at 360');
      await owner.click('[data-person="u_a1"]'); await owner.waitForSelector('#mgr-notes', { timeout: 5000 });
      const note = await owner.evaluate(() => { const n = document.querySelector('.day-note'); const r = n.getBoundingClientRect(); return { text: n.textContent, inside: r.left >= 0 && r.right <= innerWidth, noteCol: Array.from(document.querySelectorAll('th')).some(th => /note/i.test(th.textContent)) }; });
      expect(/market report/.test(note.text) && note.inside && !note.noteCol, 'a day\'s note sits under the numbers, inside the screen');
      await owner.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await owner.waitForTimeout(100);
      await owner.click('#tabbar [data-nav="team"]'); await owner.waitForSelector('.roster', { timeout: 5000 });
      expect(await owner.evaluate(() => !document.getElementById('mgr-notes') && window.scrollY === 0), 'Team tab on a person page goes back to the roster, at the top');
      await owner.context().close();
    }
    // 14. Nobody active: the Active and Everyone chips stay, so a paused associate can still be reached. The Remove as manager
    //     sheet opens on the sheet itself, not on a report address checkbox.
    {
      const seed = {
        'config/program': { managerIds: ['u_owner', 'u_luke'], managerEmails: ['damian@x.com', 'luke@x.com', 'luke.work@x.com'], managerEmailById: { u_owner: 'damian@x.com', u_luke: 'luke@x.com' }, teamBoard: true },
        'people/u_owner': assoc('u_owner', 'Damian Portaro', { role: 'manager', email: 'damian@x.com' }),
        'people/u_luke': assoc('u_luke', 'Luke Manager', { role: 'manager', email: 'luke@x.com' }),
        'people/u_p1': assoc('u_p1', 'Paused Person', { status: 'paused' }),
      };
      const owner = await open(Object.assign({ seed }, asOwner), 'team', { tag: 'team-none-active', viewport: { width: 360, height: 740 } });
      await owner.waitForSelector('[data-tfilter="all"]', { timeout: 5000 });
      expect(/No active associates right now/.test(await viewText(owner)) && !/No associates yet/.test(await viewText(owner)), 'no one active: the chips stay and the roster says so');
      await owner.click('[data-tfilter="all"]'); await owner.waitForSelector('[data-person="u_p1"]', { timeout: 5000 });
      expect(true, 'Everyone shows the paused associate');
      await owner.click('details.lesson summary >> text=Managers'); await owner.click('[data-demote="u_luke"]'); await owner.waitForSelector('.demote-also', { timeout: 5000 }); await owner.waitForTimeout(150);
      expect(await owner.evaluate(() => !document.activeElement.classList.contains('demote-also') && /own address comes off/.test(document.querySelector('.sheet').textContent)), 'Remove sheet: focus is not on an address checkbox, and the copy says their address comes off');
      await owner.context().close();
    }
  } finally { await browser.close(); }
  if (errors.length) { console.log('[extras] CONSOLE ERRORS:'); errors.forEach(e => console.log('  ', e)); }
  else console.log('[extras] no console errors' + (expected.length ? ' (plus ' + expected.length + ' expected from the refused write)' : ''));
  return errors.length;
}
(async () => {
  const { srv, port } = await serve();
  let fails = 0;
  for (const r of (which === 'all' ? ['associate', 'manager', 'extras'] : [which])) { try { fails += r === 'extras' ? await extras(port) : await run(r, port); } catch (e) { console.log('[' + r + '] FAILED:', e.message); fails++; } }
  srv.close(); process.exit(fails ? 1 : 0);
})();
