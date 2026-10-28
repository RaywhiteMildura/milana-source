/* Launchpad 300·30·3 — pacing engine (pure functions, no DOM)
   Works in the browser (window.PACE) and in node (module.exports) for tests. */
(function (root) {
  'use strict';

  // Soft guide curve: Jess's funnel ramp, per week, summing to the default targets.
  // Geo data front-loaded, appraisals ramp from week 2, listings expected from week 8.
  const WEEKLY = {
    geo:        [20, 35, 35, 35, 30, 30, 25, 25, 20, 20, 15, 10],   // 300
    appraisals: [0, 1, 2, 3, 3, 4, 4, 4, 3, 3, 2, 1],                // 30
    listings:   [0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1],                // 3
  };
  const METRICS = ['geo', 'appraisals', 'listings'];
  const LABELS = { geo: 'geo data', appraisals: 'appraisals', listings: 'listings' };
  const SINGULAR = { geo: 'geo data record', appraisals: 'appraisal', listings: 'listing' };
  const BAND_ORDER = { behind: 0, slipping: 1, ontrack: 2, ahead: 3, done: 4, notyet: 5, early: 6 };
  const DEFAULT_TARGETS = { geo: 300, appraisals: 30, listings: 3 };
  const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5]; // Mon..Fri (JS getDay: 0 = Sunday)
  const GRACE_DAYS = 3;      // no judgement in the first 3 working days
  const RATE_WINDOW = 10;    // recent pace = last 10 working days

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) {
    if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate(), 12);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], 12); // noon avoids DST edge cases
  }
  function addDays(d, n) { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); x.setHours(12, 0, 0, 0); return x; }
  function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); }
  function isWorkDay(d, workDays) { return (workDays || DEFAULT_WORKDAYS).indexOf(d.getDay()) !== -1; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }

  /** Build the program calendar: every working date from start for `weeks` calendar weeks. */
  function calendar(startDate, weeks, workDays) {
    const start = parseDate(startDate);
    if (!start) return null;
    weeks = weeks || 12;
    workDays = workDays && workDays.length ? workDays : DEFAULT_WORKDAYS;
    const end = addDays(start, weeks * 7 - 1);
    const workDates = [];
    for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkDay(d, workDays)) workDates.push(fmtDate(d));
    return { start: fmtDate(start), end: fmtDate(end), weeks, workDays, workDates, total: workDates.length };
  }

  /** Number of working days elapsed from start through `on` (inclusive). 0 before start, total after end. */
  function dayIndex(cal, on) {
    const s = fmtDate(parseDate(on) || today());
    if (s < cal.start) return 0;
    if (s > cal.end) return cal.total;
    let n = 0;
    for (let i = 0; i < cal.workDates.length; i++) { if (cal.workDates[i] <= s) n++; else break; }
    return n;
  }

  /** Calendar week number 1..weeks for a date (0 before start, weeks+1 after end). */
  function weekOf(cal, on) {
    const d = parseDate(on) || today();
    const start = parseDate(cal.start);
    const diff = Math.round((d - start) / 86400000);
    if (diff < 0) return 0;
    const w = Math.floor(diff / 7) + 1;
    return w > cal.weeks ? cal.weeks + 1 : w;
  }

  /** Working dates that fall in a given program week. */
  function weekDates(cal, week) {
    const start = parseDate(cal.start);
    const a = fmtDate(addDays(start, (week - 1) * 7)), b = fmtDate(addDays(start, week * 7 - 1));
    return cal.workDates.filter(x => x >= a && x <= b);
  }

  /** Scaled cumulative guide for a metric at the END of working day `idx` (1-based; 0 = before start). */
  function guideAt(metric, target, idx, cal) {
    const w = WEEKLY[metric];
    if (!w || !cal || !cal.total) return 0;
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    const cum = []; let acc = 0;
    for (let i = 0; i < w.length; i++) { acc += w[i]; cum.push(acc / sum * target); }
    // position in weeks (0..12) by share of working days elapsed, stretched to the configured week count
    const p = clamp(idx / cal.total, 0, 1) * w.length;
    const lo = Math.floor(p), frac = p - lo;
    const below = lo === 0 ? 0 : cum[lo - 1];
    const above = lo >= w.length ? cum[w.length - 1] : cum[lo];
    return below + (above - below) * frac;
  }

  /** Weekly guide amounts scaled to a target (for the "aim for about" copy). */
  function weeklyGuide(metric, target) {
    const w = WEEKLY[metric]; const sum = w.reduce((a, b) => a + b, 0) || 1;
    return w.map(x => x / sum * target);
  }

  /** Sum a metric over day docs. days: array of {date, geo, ...}. */
  function total(days, metric, upToDate) {
    let t = 0;
    for (const d of days) { if (!upToDate || d.date <= upToDate) t += Number(d[metric]) || 0; }
    return t;
  }

  /** Average per working day over the last `window` working days ending at index idx (1-based). */
  function recentRate(days, cal, idx, metric, window) {
    window = window || RATE_WINDOW;
    if (idx <= 0) return 0;
    const from = Math.max(0, idx - window), dates = cal.workDates.slice(from, idx);
    if (!dates.length) return 0;
    const byDate = {}; for (const d of days) byDate[d.date] = d;
    let sum = 0; for (const dt of dates) sum += Number((byDate[dt] || {})[metric]) || 0;
    return sum / dates.length;
  }

  /** Assess one metric. */
  function assess(metric, actual, target, idx, cal, rate) {
    const guide = guideAt(metric, target, idx, cal);
    const remainingDays = Math.max(0, cal.total - idx);
    const remaining = Math.max(0, target - actual);
    const needPerDay = remainingDays ? remaining / remainingDays : (remaining > 0 ? Infinity : 0);
    const workDaysPerWeek = cal.workDays.length;
    const projection = actual + (rate || 0) * remainingDays;
    let band;
    if (actual >= target) band = 'done';
    else if (idx <= 0) band = 'notyet';
    else if (idx <= GRACE_DAYS) band = 'early';
    else if (guide < 0.5 && actual === 0) band = 'notyet';           // metric not expected yet
    else {
      const ratio = guide > 0 ? actual / guide : (actual > 0 ? 2 : 1);
      if (ratio >= 1.15) band = 'ahead';
      else if (ratio >= 0.85) band = 'ontrack';
      else if (ratio >= 0.6) band = 'slipping';
      else band = 'behind';
      // Dynamic adjustment: the recent pace matters more than the guide once there is enough history.
      if (idx >= 8) {
        if ((band === 'slipping' || band === 'behind') && projection >= target && remainingDays > 0) band = 'ontrack';
        if (band === 'ontrack' && remainingDays > 0 && projection < target * 0.8 && guide >= 3) band = 'slipping';
        if (band === 'ahead' && remainingDays > 0 && projection < target * 0.9 && guide >= 3) band = 'ontrack';
      }
      if (remainingDays === 0 && actual < target) band = 'behind';
    }
    return {
      metric, actual, target, guide: round1(guide), ratio: guide > 0 ? round1(actual / guide) : null,
      remaining, remainingDays, needPerDay: isFinite(needPerDay) ? round1(needPerDay) : null,
      needPerWeek: isFinite(needPerDay) ? round1(needPerDay * workDaysPerWeek) : null,
      rate: round1(rate || 0), projection: Math.round(projection), band,
      inPlay: band !== 'notyet',
    };
  }

  /** Combine metric bands into one overall band. */
  function overall(assessments, idx) {
    if (idx <= 0) return 'notyet';
    if (idx <= GRACE_DAYS) return 'early';
    const inPlay = assessments.filter(a => a.inPlay && a.band !== 'early');
    if (!inPlay.length) return 'early';
    if (inPlay.every(a => a.band === 'done')) return 'done';
    let worst = 'ahead';
    for (const a of inPlay) { if (a.band === 'done') continue; if (BAND_ORDER[a.band] < BAND_ORDER[worst]) worst = a.band; }
    return worst;
  }

  /** Streak of consecutive logged working days ending today (or the previous working day if today is not logged yet). */
  function streak(days, cal, idx) {
    if (idx <= 0) return 0;
    const logged = {}; for (const d of days) logged[d.date] = true;
    let i = idx - 1;
    if (!logged[cal.workDates[i]]) i--;        // today not yet logged: count up to yesterday
    let n = 0;
    while (i >= 0 && logged[cal.workDates[i]]) { n++; i--; }
    return n;
  }

  /** Full snapshot for a person. days = array of day docs. targets = {geo, appraisals, listings}. */
  function snapshot(person, config, days, on) {
    const targets = Object.assign({}, DEFAULT_TARGETS, (config && config.targets) || {}, (person && person.targets) || {});
    const cal = calendar(person.startDate, (config && config.weeks) || 12, (config && config.workDays) || DEFAULT_WORKDAYS);
    if (!cal) return null;
    const onStr = fmtDate(parseDate(on) || today());
    const idx = dayIndex(cal, onStr);
    const week = weekOf(cal, onStr);
    const logged = {}; for (const d of days) logged[d.date] = d;
    const metrics = {};
    for (const m of METRICS) {
      const actual = total(days, m, onStr);
      metrics[m] = assess(m, actual, targets[m], idx, cal, recentRate(days, cal, idx, m));
    }
    const sessionTotals = {
      calls: total(days, 'calls', onStr), connections: total(days, 'connections', onStr),
      appointments: total(days, 'appointments', onStr), sessions: total(days, 'sessions', onStr),
    };
    const band = overall(METRICS.map(m => metrics[m]), idx);
    const wd = weekDates(cal, clamp(week, 1, cal.weeks));
    const thisWeek = {};
    for (const m of METRICS.concat(['calls', 'connections', 'appointments'])) thisWeek[m] = wd.reduce((s, dt) => s + (Number((logged[dt] || {})[m]) || 0), 0);
    const weekGuide = {}; for (const m of METRICS) weekGuide[m] = Math.round(weeklyGuide(m, targets[m])[clamp(week, 1, cal.weeks) - 1]);
    const loggedDays = cal.workDates.slice(0, idx).filter(dt => logged[dt]).length;
    const missedDays = Math.max(0, idx - loggedDays - (logged[onStr] ? 0 : 1)); // today is not "missed" yet
    return {
      asOf: onStr, cal, idx, total: cal.total, remainingDays: Math.max(0, cal.total - idx), week, targets,
      metrics, overall: band, thisWeek, weekGuide, sessionTotals,
      streak: streak(days, cal, idx), loggedDays, missedDays, loggedToday: !!logged[onStr],
      status: onStr < cal.start ? 'upcoming' : (onStr > cal.end ? 'finished' : 'active'),
      ratios: ratios(sessionTotals, metrics),
    };
  }

  function ratios(s, m) {
    const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) : null);
    return {
      connectionRate: pct(s.connections, s.calls),             // Jess: ~45-50%
      appointmentRate: pct(s.appointments, s.connections),     // Jess: 1 in 6-8 connections
      appraisalsPer100Geo: m.geo.actual > 0 ? round1(m.appraisals.actual / m.geo.actual * 100) : null,  // program: 10
      listingsPerAppraisal: pct(m.listings.actual, m.appraisals.actual), // program: 10%
    };
  }

  const BAND_COPY = {
    early: { label: 'Just started', tone: 'info' },
    notyet: { label: 'Not started', tone: 'muted' },
    ahead: { label: 'Ahead', tone: 'good' },
    ontrack: { label: 'On track', tone: 'good' },
    slipping: { label: 'Slipping', tone: 'warn' },
    behind: { label: 'Behind', tone: 'bad' },
    done: { label: 'Target hit', tone: 'good' },
  };

  /** Plain-English coaching line for a metric. */
  function metricLine(a) {
    const name = LABELS[a.metric];
    const need = a.needPerDay == null ? null : (a.needPerDay < 1 ? (a.needPerWeek + ' a week') : (a.needPerDay + ' a day'));
    switch (a.band) {
      case 'done': return 'Target hit: ' + a.actual + ' ' + name + '. Everything from here is a bonus.';
      case 'notyet': return a.metric === 'listings' ? 'Listings come from appraisals. Keep feeding the pipeline; the guide expects your first around week 8.' : 'Not expected yet. Keep building the base.';
      case 'early': return 'First few days. Log every day and the picture builds itself.';
      case 'ahead': return 'Ahead of the guide (' + a.actual + ' vs about ' + Math.round(a.guide) + '). ' + (need ? 'From here you only need ' + need + '.' : '');
      case 'ontrack': return 'On track (' + a.actual + ' vs about ' + Math.round(a.guide) + ' on the guide). ' + (need ? 'Keep to about ' + need + '.' : '');
      case 'slipping': return 'A little under the guide (' + a.actual + ' vs about ' + Math.round(a.guide) + '). ' + (need ? 'It takes ' + need + ' from here, which is very doable.' : '');
      case 'behind': return 'Behind the guide (' + a.actual + ' vs about ' + Math.round(a.guide) + '). ' + (need ? 'Still winnable: ' + need + ' from here gets you to ' + a.target + '.' : 'Time is up on this one; talk it through with your manager.');
    }
    return '';
  }

  /** Overall verdict copy after saving a day. */
  function verdict(snap, dayDoc) {
    const g = snap.metrics.geo, ap = snap.metrics.appraisals, li = snap.metrics.listings;
    const lines = [];
    let title;
    switch (snap.overall) {
      case 'early': title = 'Day ' + snap.idx + ' logged. Good start.'; break;
      case 'ahead': title = 'Ahead of the guide. Nice work.'; break;
      case 'ontrack': title = 'On track. Keep the rhythm.'; break;
      case 'slipping': title = 'Logged. You are a touch behind the guide.'; break;
      case 'behind': title = 'Logged. Behind, and still winnable.'; break;
      case 'done': title = 'Targets hit. Outstanding.'; break;
      default: title = 'Logged.';
    }
    if (dayDoc) {
      const parts = [];
      if (dayDoc.geo) parts.push(dayDoc.geo + ' geo data');
      if (dayDoc.appraisals) parts.push(dayDoc.appraisals + ' appraisal' + (dayDoc.appraisals > 1 ? 's' : ''));
      if (dayDoc.listings) parts.push(dayDoc.listings + ' listing' + (dayDoc.listings > 1 ? 's' : ''));
      if (dayDoc.calls) parts.push(dayDoc.calls + ' calls');
      lines.push(parts.length ? 'Today: ' + parts.join(', ') + '.' : 'Today: nothing logged yet, and that is still an honest day on the board.');
    }
    lines.push('Geo data: ' + metricLine(g));
    if (ap.inPlay) lines.push('Appraisals: ' + metricLine(ap));
    if (li.inPlay) lines.push('Listings: ' + metricLine(li));
    if (snap.streak >= 2) lines.push(snap.streak + ' working days in a row logged.');
    return { title, lines };
  }

  /** Milestones reached by a save (for celebrations). prev/next are totals before and after. */
  function milestones(prev, next, streakNow) {
    const out = [];
    for (const n of [50, 100, 150, 200, 250, 300]) if (prev.geo < n && next.geo >= n) out.push(n + ' geo data records. On Jess\'s maths that is $' + (n * 500 / 1000) + 'K of future income.');
    for (const n of [1, 5, 10, 15, 20, 25, 30]) if (prev.appraisals < n && next.appraisals >= n) out.push(n === 1 ? 'First appraisal logged. The pipeline has begun.' : n + ' appraisals. The pipeline is real.');
    for (const n of [1, 2, 3]) if (prev.listings < n && next.listings >= n) out.push(n === 1 ? 'First listing. This is the moment the program is built for.' : (n === 3 ? 'Three listings. Program target hit.' : 'Listing number ' + n + '.'));
    for (const n of [5, 10, 20, 30, 40, 50, 60]) if (streakNow === n) out.push(n + ' working days logged in a row.');
    return out;
  }

  const api = {
    WEEKLY, METRICS, LABELS, SINGULAR, DEFAULT_TARGETS, DEFAULT_WORKDAYS, GRACE_DAYS, BAND_COPY, BAND_ORDER,
    fmtDate, parseDate, addDays, today, isWorkDay, calendar, dayIndex, weekOf, weekDates, guideAt, weeklyGuide,
    total, recentRate, assess, overall, streak, snapshot, ratios, metricLine, verdict, milestones, clamp, round1,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PACE = api;
})(typeof window !== 'undefined' ? window : globalThis);
