/**
 * Live end-to-end check against the real racing sources, exactly as the phone
 * would drive it: list meetings, research one meeting through the API, wait for
 * the job, print what every source returned and what RaceLens made of it, then
 * fetch results for a meeting that has already been run.
 *
 *   npx tsx src/server/tools/live-check.ts [upcomingDate] [upcomingVenue] [resultsDate] [resultsVenue] [outDir]
 *
 * Defaults: today (tomorrow after 7 pm, Melbourne time) at Flemington, results from last Saturday at
 * Caulfield, output in ./live-check-out. Exit code 1 when no race-card source
 * worked or the research job failed, so a CI run goes red. Prints no secrets.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { JobProgress, MeetingPack, MeetingSummary, SourceStatus } from '../../shared/types.js';
import { createApp } from '../app.js';

const TZ = 'Australia/Melbourne';
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const today = ymd(new Date());
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// Before 7 pm in Melbourne the meeting that matters is today's; after that, tomorrow's (as the app's home page does).
const hourInMelbourne = Number(new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
const raceDay = hourInMelbourne >= 19 ? addDays(today, 1) : today;
const lastSaturday = (() => {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 6 = Saturday
  return addDays(today, -(((dow + 1) % 7) || 7));
})();

// Arguments, or LIVE_* environment variables (blank means "use the default").
const arg = (i: number, env: string) => process.argv[2 + i] || process.env[env] || undefined;
const upDate = arg(0, 'LIVE_UP_DATE') ?? raceDay;
const upVenue = arg(1, 'LIVE_UP_VENUE') ?? 'flemington';
const resDate = arg(2, 'LIVE_RES_DATE') ?? lastSaturday;
const resVenue = arg(3, 'LIVE_RES_VENUE') ?? 'caulfield';
const outDir = arg(4, 'LIVE_OUT_DIR') ?? 'live-check-out';
fs.mkdirSync(outDir, { recursive: true });

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'racelens-live-'));
const recordDir = process.env.LIVE_RECORD_DIR;
const { app, scheduler } = createApp({ mode: process.env.RACELENS_MODE === 'demo' ? 'demo' : 'live', dataDir, password: '', record: !!recordDir });
scheduler.stop();
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => server.once('listening', () => r()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`::error::${msg}`);
};

async function api<T>(method: string, p: string, body?: unknown): Promise<T> {
  const res = await fetch(base + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok && res.status !== 202) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function waitJob(id: string, limitMs = 15 * 60_000): Promise<JobProgress> {
  const started = Date.now();
  let last = '';
  for (;;) {
    const j = await api<JobProgress>('GET', `/api/jobs/${id}`);
    if (j.message !== last) {
      last = j.message;
      console.log(`   … ${Math.round((Date.now() - started) / 1000)}s ${j.percent}% ${j.message}`);
    }
    if (j.status === 'done' || j.status === 'error') return j;
    if (Date.now() - started > limitMs) throw new Error(`job ${id} still running after ${limitMs / 60000} min`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

function printStatuses(statuses: SourceStatus[]) {
  for (const s of statuses) console.log(`   ${s.ok ? 'OK  ' : 'FAIL'} ${s.name.padEnd(34)} ${String(s.ms).padStart(6)}ms ${s.itemCount != null ? `${s.itemCount} items ` : ''}${s.error ? `– ${s.error.slice(0, 160)}` : ''}`);
}

function printSteps(job: JobProgress) {
  for (const s of job.steps) console.log(`   [${s.status.padEnd(7)}] ${s.label}${s.detail ? ` – ${s.detail.slice(0, 220)}` : ''}`);
}

async function research(date: string, venueSlug: string): Promise<MeetingPack | null> {
  console.log(`\n## Meetings on ${date}`);
  const listed = await api<{ meetings: MeetingSummary[]; sourceStatuses: SourceStatus[] }>('GET', `/api/meetings?date=${date}&force=1`);
  printStatuses(listed.sourceStatuses);
  for (const m of listed.meetings) console.log(`   ${m.venue.padEnd(24)} ${m.raceType.padEnd(12)} ${(m.state || '').padEnd(4)} races=${m.raceCount ?? '?'} first=${m.firstRaceTime ?? '?'} sources=${m.sources.join(',')}`);
  if (!listed.meetings.length) fail(`No meetings found for ${date} by any source`);
  const slugs = listed.meetings.filter((m) => m.raceType === 'thoroughbred').map((m) => m.venueSlug);
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i || slugs.some((o) => o !== s && (s.endsWith(`-${o}`) || o.endsWith(`-${s}`))));
  if (dupes.length) fail(`The same meeting is listed twice (${[...new Set(dupes)].join(', ')}) – the phone would show duplicate cards`);
  const meeting = listed.meetings.find((m) => m.venueSlug === venueSlug) ?? listed.meetings.find((m) => m.venueSlug.startsWith(venueSlug));
  if (!meeting) {
    fail(`No '${venueSlug}' meeting on ${date}`);
    return null;
  }
  console.log(`\n## Researching ${meeting.venue} ${date} (found by ${meeting.sources.join(', ')})`);
  const { jobId } = await api<{ jobId: string }>('POST', '/api/research', { date, venueSlug: meeting.venueSlug });
  const job = await waitJob(jobId);
  printSteps(job);
  if (job.status !== 'done') {
    fail(`Research of ${meeting.venue} failed: ${job.error}`);
    return null;
  }
  const pack = await api<MeetingPack>('GET', `/api/packs/${encodeURIComponent(meeting.id)}`);
  fs.writeFileSync(path.join(outDir, `pack-${date}-${meeting.venueSlug}.json`), JSON.stringify(pack, null, 1));
  return pack;
}

function summarise(pack: MeetingPack) {
  console.log(`\n## ${pack.meeting.venue} ${pack.meeting.date}: ${pack.races.length} races, verification ${Math.round(pack.verificationScore * 100)}%, track ${pack.meeting.trackCondition ?? '?'}, rail ${pack.meeting.rail ?? '?'}`);
  console.log(`   weather: ${pack.weather?.summary ?? 'none'}`);
  console.log(`   news items: ${pack.news.length}`);
  console.log('   sources:');
  printStatuses(pack.sourceStatuses);
  const racecard = pack.sourceStatuses.filter((s) => s.ok && pack.races.some((r) => r.sources.includes(s.source)));
  if (!racecard.length) fail('No race-card source contributed to the pack');
  for (const race of pack.races) {
    const active = race.runners.filter((r) => !r.scratched);
    const withOdds = active.filter((r) => (r.odds?.length ?? 0) > 0).length;
    const withForm = active.filter((r) => (r.form?.length ?? 0) > 0).length;
    const p = pack.predictions[race.number];
    const top = p ? p.top.slice(0, 3).map((a) => `${a.number} ${a.name} ${Math.round(a.winProb * 100)}%`).join(' | ') : 'NO PREDICTION';
    console.log(`   R${race.number} ${new Date(race.startTime ?? '').toLocaleTimeString('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })} ${race.name.slice(0, 34).padEnd(34)} runners=${active.length}/${race.runners.length} odds=${withOdds} form=${withForm} sources=${race.sources.join(',')} verified=${Math.round(race.verification.score * 100)}% conflicts=${race.verification.conflicts.length}`);
    console.log(`      picks: ${top}  confidence=${p?.confidence.overall ?? '-'} ${p?.confidence.label ?? ''} stance=${p?.betting.stance ?? '-'}`);
    if (!p) fail(`R${race.number} has no prediction`);
    if (active.length && withOdds === 0) console.log(`::warning::R${race.number}: no runner has odds from any source`);
  }
}

/** Print the first meeting objects each feed really sent (field names and short values) – public racing data only. */
function printRawMeetingSamples() {
  const dir = path.resolve('fixtures/recorded');
  if (!fs.existsSync(dir)) return;
  console.log('\n## Raw meeting records as the feeds sent them (first two per response)');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.endsWith('.meta.json'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/"(venueName|meetingName|venue_name|meetName)"/.test(text)) continue;
    const found: unknown[] = [];
    const walk = (o: unknown) => {
      if (found.length >= 2 || !o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      const rec = o as Record<string, unknown>;
      if ('venueName' in rec || 'meetingName' in rec || 'venue_name' in rec || 'meetName' in rec) {
        found.push(Object.fromEntries(Object.entries(rec).filter(([, v]) => v === null || typeof v !== 'object').map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 60) : v])));
        return;
      }
      Object.values(rec).forEach(walk);
    };
    try {
      walk(JSON.parse(text));
    } catch {
      continue;
    }
    if (found.length) console.log(`   ${f.slice(0, 90)}\n${found.map((x) => `      ${JSON.stringify(x)}`).join('\n')}`);
  }
}

try {
  console.log(`RaceLens live check – upcoming ${upDate} ${upVenue}; results ${resDate} ${resVenue}; server clock ${new Date().toISOString()}`);
  const upcoming = await research(upDate, upVenue);
  if (upcoming) summarise(upcoming);

  const past = await research(resDate, resVenue);
  if (past) summarise(past);
  if (past) {
    console.log(`\n## Results for ${past.meeting.venue} ${resDate}`);
    const { jobId } = await api<{ jobId: string | null }>('POST', `/api/packs/${encodeURIComponent(past.id)}/results`, {});
    if (jobId) printSteps(await waitJob(jobId));
    const after = await api<MeetingPack>('GET', `/api/packs/${encodeURIComponent(past.id)}`);
    fs.writeFileSync(path.join(outDir, `pack-${resDate}-${past.meeting.venueSlug}-results.json`), JSON.stringify(after, null, 1));
    let got = 0;
    for (const race of after.races) {
      const r = after.results[race.number];
      const w = after.resultWatch?.[race.number];
      if (r) got++;
      console.log(`   R${race.number} ${r ? `${r.status} ${r.placings.map((g) => g.join('=')).join('-')} by ${(r.confirmedBy ?? [r.source]).join('+')}` : 'NO RESULT'}${w?.note ? ` – ${w.note}` : ''}${r?.scorecard ? ` – winner was our #${r.scorecard.winnerRank ?? '?'}` : ''}`);
    }
    if (!got) fail(`No results collected for ${past.meeting.venue} ${resDate}`);
  }
  if (recordDir) printRawMeetingSamples();
} catch (err) {
  fail(err instanceof Error ? err.stack || err.message : String(err));
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} problem(s) found` : '\nLive check passed');
process.exit(failures ? 1 : 0);
