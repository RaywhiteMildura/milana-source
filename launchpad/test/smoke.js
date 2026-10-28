/* Playwright smoke test for the Launchpad app with the mock runtime.
   Usage: node smoke.js [associate|manager|all] */
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
  if (role === 'manager') {
    const days = workDaysBack(12);
    seed['people/u_assoc1'] = { id: 'u_assoc1', name: 'Jordan Blake', email: 'jordan@example.com', role: 'associate', startDate: start, farm: 'Irymple', status: 'active', lastLogDate: days[days.length - 1], summary: null, managerNotes: '' };
    days.forEach((dt, i) => { seed['people/u_assoc1/days/' + dt] = { date: dt, geo: 6, appraisals: i % 5 === 0 ? 1 : 0, listings: 0, calls: 22, connections: 10, appointments: 1, sessions: 1, note: i === 3 ? 'Good session, two appraisals booked' : '', closed: true, updatedAt: new Date().toISOString() }; });
    seed['people/u_assoc1/pipeline/p1'] = { address: '14 Riverside Ave, Mildura', kind: 'curbside', category: '1-2', group: 'audience', plan: '1 month plan', date: days[2], status: 'active', lastTouch: days[2], nextTouch: days[6], createdAt: new Date().toISOString() };
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
    await page.waitForSelector('[data-step="geo"][data-n="1"]', { timeout: 5000 });
    await shot('02-today-empty');
    for (let i = 0; i < 5; i++) await page.click('[data-step="geo"][data-n="1"]');
    await page.click('[data-step="appraisals"][data-n="1"]');
    await page.waitForSelector('#ap-address'); await page.fill('#ap-address', '22 Walnut Ave, Mildura'); await page.click('[data-group="category"] [data-v="1-2"]'); await shot('03-appraisal-sheet');
    await page.click('[data-act="save-appraisal"]');
    await page.waitForTimeout(300);
    await page.click('details summary'); // open call sessions
    await page.click('[data-step="calls"][data-n="5"]'); await page.click('[data-step="calls"][data-n="5"]'); await page.click('[data-step="connections"][data-n="1"]');
    await page.fill('#day-note', 'First session done. Two neighbours want the market report.');
    await shot('04-today-filled');
    await page.click('[data-act="done"]');
    await page.waitForSelector('.sheet', { timeout: 5000 }); await shot('05-verdict');
    const verdict = await page.textContent('.sheet'); log('verdict:', verdict.slice(0, 160).replace(/\s+/g, ' '));
    await page.click('.sheet [data-nav="progress"]');
    await page.waitForSelector('.rings', { timeout: 5000 }); await shot('06-progress');
    log('hscroll progress:', await hasHScroll());
    await page.click('[data-chart="appraisals"]'); await page.waitForTimeout(200);
    await page.click('[data-pipe]'); await page.waitForSelector('.sheet'); await shot('07-pipeline-item'); await page.click('.sheet [data-touch]'); await page.waitForTimeout(300);
    await page.click('#tabbar [data-nav="learn"]'); await page.waitForSelector('.week-nav', { timeout: 5000 }); await shot('08-learn');
    const weekTitle = await page.textContent('h1'); log('learn h1:', weekTitle);
    await page.click('details.lesson summary'); await page.waitForTimeout(200); await shot('09-lesson-open');
    await page.click('[data-read]'); await page.waitForTimeout(300);
    const drill = await page.$('[data-drill]'); if (drill) await drill.click();
    await page.click('[data-act="quiz-start"]'); await page.waitForSelector('[data-qpick]');
    for (let i = 0; i < 12; i++) { const opt = await page.$('[data-qpick="0"]:not([disabled])'); if (!opt) break; await opt.click(); await page.waitForTimeout(100); const nx = await page.$('[data-act="quiz-next"]'); if (nx) await nx.click(); await page.waitForTimeout(100); }
    await shot('10-quiz-done');
    const scripts = await page.evaluate(() => (window.LAUNCHPAD_CONTENT || {}).scripts ? window.LAUNCHPAD_CONTENT.scripts.length : 0); log('scripts loaded:', scripts);
    await page.click('#tabbar [data-nav="practice"]'); await page.waitForSelector('[data-practice]', { timeout: 5000 }); await shot('11-practice-list');
    await page.click('[data-practice]'); await page.waitForTimeout(400);
    for (const line of ['Hi, it\'s Taylor from Ray White Mildura. Just a courtesy call today.', 'I\'m touching base because we have a local market report out. Your neighbours have loved it. Can I grab your details and send one?', 'Totally understand. It\'s just a report, no obligation. Any real estate needs in the next 12 months?', 'Great. Does Thursday 2pm or 4pm suit?']) {
      const ta = await page.$('#chat-in:not([disabled])'); if (!ta) break; await page.fill('#chat-in', line); await page.click('[data-act="chat-send"]'); await page.waitForTimeout(400);
    }
    await shot('12-practice-chat');
    const fb = await page.$('[data-act="practice-feedback"]:not([disabled])'); if (fb) { await fb.click(); await page.waitForTimeout(600); await shot('13-practice-feedback'); }
    await page.click('#tabbar [data-nav="more"]'); await page.waitForSelector('.sheet'); await page.click('.sheet [data-nav="scripts"]'); await page.waitForSelector('#scripts-q', { timeout: 5000 });
    await page.fill('#scripts-q', 'magic'); await page.waitForTimeout(200); await page.click('details.lesson summary'); await shot('14-scripts');
    await page.click('[data-stab="templates"]'); await page.waitForTimeout(200); await shot('15-templates');
    await page.click('#tabbar [data-nav="more"]'); await page.waitForSelector('.sheet'); await page.click('.sheet [data-nav="me"]'); await page.waitForSelector('#me-name'); await shot('16-profile');
    const stored = await page.evaluate(() => Array.from(window.__MOCK_STORE.keys()));
    log('store keys:', stored.join(', '));
    const person = await page.evaluate(() => window.__MOCK_STORE.get('people/u_test000000000000000001'));
    log('summary:', JSON.stringify(person.summary).slice(0, 300));
  } else {
    await page.waitForSelector('.roster', { timeout: 5000 }); await page.waitForTimeout(600); await shot('02-team');
    log('hscroll team:', await hasHScroll());
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
(async () => {
  const { srv, port } = await serve();
  let fails = 0;
  for (const r of (which === 'all' ? ['associate', 'manager'] : [which])) { try { fails += await run(r, port); } catch (e) { console.log('[' + r + '] FAILED:', e.message); fails++; } }
  srv.close(); process.exit(fails ? 1 : 0);
})();
