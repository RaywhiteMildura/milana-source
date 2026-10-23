/**
 * CLI: probe every live source for a date and print what came back.
 *   npx tsx src/server/tools/probe-sources.ts [YYYY-MM-DD] [venueSlug]
 * Set RACELENS_RECORD=1 to save raw responses into fixtures/recorded/.
 */
import { createRegistry } from '../adapters/index.js';
import { HttpClient } from '../core/http.js';
import { logger } from '../core/logger.js';
import { discoverMeetings } from '../jobs/research.js';
import { DEFAULT_SETTINGS } from '../store/store.js';
import path from 'node:path';

const date = process.argv[2] || new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());
const venueSlug = process.argv[3];
const registry = createRegistry((process.env.RACELENS_MODE as 'live' | 'demo') || 'live');
const http = new HttpClient({ recordDir: process.env.RACELENS_RECORD === '1' ? path.resolve('fixtures/recorded') : undefined });
const ctx = { http, log: logger, now: () => new Date(), jurisdiction: DEFAULT_SETTINGS.jurisdiction };

const { meetings, statuses } = await discoverMeetings({ registry, ctx, settings: DEFAULT_SETTINGS }, date);
console.log(`\n=== Sources (${date}) ===`);
for (const s of statuses) console.log(`${s.ok ? 'OK  ' : 'FAIL'} ${s.name.padEnd(28)} ${String(s.ms).padStart(6)}ms ${s.itemCount != null ? s.itemCount + ' meetings' : ''} ${s.error || ''}`);
console.log(`\n=== Meetings (${meetings.length}) ===`);
for (const m of meetings) console.log(`${m.venue.padEnd(22)} ${m.raceType.padEnd(12)} ${m.state || ''} races=${m.raceCount ?? '?'} track=${m.trackCondition || '?'} sources=${m.sources.join(',')}`);

if (venueSlug) {
  const meeting = meetings.find((m) => m.venueSlug === venueSlug);
  if (!meeting) {
    console.error(`No meeting '${venueSlug}' on ${date}`);
    process.exit(1);
  }
  console.log(`\n=== Race cards for ${meeting.venue} ===`);
  for (const a of registry.withCapability('racecard')) {
    const started = Date.now();
    try {
      const m = await a.fetchMeeting!(meeting, ctx);
      const runners = m.races.reduce((n, r) => n + r.runners.length, 0);
      const withForm = m.races.reduce((n, r) => n + r.runners.filter((x) => (x.form?.length || 0) > 0).length, 0);
      const withOdds = m.races.reduce((n, r) => n + r.runners.filter((x) => (x.odds?.length || 0) > 0).length, 0);
      console.log(`OK   ${a.name.padEnd(28)} ${Date.now() - started}ms races=${m.races.length} runners=${runners} withForm=${withForm} withOdds=${withOdds}`);
      const r1 = m.races[0]?.runners[0];
      if (r1) console.log(`     sample: #${r1.number} ${r1.name} b${r1.barrier} ${r1.jockey || '-'} / ${r1.trainer || '-'} ${r1.weight || ''}kg odds=${r1.odds?.map((o) => `${o.bookmaker}:${o.win}`).join(' ') || '-'}`);
    } catch (err) {
      console.log(`FAIL ${a.name.padEnd(28)} ${Date.now() - started}ms ${err instanceof Error ? err.message : err}`);
    }
  }
}
