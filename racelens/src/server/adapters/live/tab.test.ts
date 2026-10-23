import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HttpClient } from '../../core/http.js';
import { silentLogger } from '../../core/logger.js';
import type { FetchContext } from '../types.js';
import { TabAdapter } from './tab.js';
import { parseMargin, parseStats, titleCase, toISODateOnly } from './parse.js';

const fx = (name: string) => fs.readFileSync(path.resolve('fixtures/tab', name), 'utf8');

function ctxFor(routes: Array<[RegExp, string]>): FetchContext & { calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response('{"error":"not found"}', { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(hit[1], { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const http = new HttpClient({ fetchImpl, cacheTtlMs: 0, perHostDelayMs: 0 });
  return { http, log: silentLogger, now: () => new Date('2026-10-24T00:00:00.000Z'), jurisdiction: 'VIC', calls };
}

const routes: Array<[RegExp, string]> = [
  [/dates\/2026-10-24\/meetings\?jurisdiction=VIC/, fx('meetings-2026-10-24.json')],
  [/meetings\/R\/FLM\/races\/1\/form/, fx('form-FLE-1.json')],
  [/meetings\/R\/FLM\/races\/1\?/, fx('race-FLE-1.json')],
  [/meetings\/R\/FLM\/races\/2\?/, fx('race-FLE-1.json').replace('"raceNumber": 1', '"raceNumber": 2')],
];

describe('parse helpers', () => {
  it('titleCase handles caps names', () => {
    expect(titleCase('AELIANA')).toBe('Aeliana');
    expect(titleCase('J MCDONALD')).toBe('J McDonald');
    expect(titleCase("DANNY O'BRIEN")).toBe("Danny O'Brien");
    expect(titleCase('Already Cased')).toBe('Already Cased');
    expect(titleCase('SIR DELIUS (NZ)')).toBe('Sir Delius (NZ)');
  });
  it('parseStats reads objects and strings', () => {
    expect(parseStats({ numberOfStarts: 12, numberOfWins: 4, numberOfSeconds: 2, numberOfThirds: 1 })).toEqual({ starts: 12, wins: 4, seconds: 2, thirds: 1, prizeMoney: undefined });
    expect(parseStats('12: 4-2-1')).toEqual({ starts: 12, wins: 4, seconds: 2, thirds: 1 });
    expect(parseStats('4-2-1 (12)')).toEqual({ starts: 12, wins: 4, seconds: 2, thirds: 1 });
    expect(parseStats({ starts: 10, wins: 2, placings: 4 })).toMatchObject({ starts: 10, wins: 2, seconds: 2, thirds: 2 });
    expect(parseStats(undefined)).toBeUndefined();
    expect(parseStats('rubbish')).toBeUndefined();
  });
  it('parseMargin and dates', () => {
    expect(parseMargin('3.2L')).toBe(3.2);
    expect(parseMargin('NK')).toBe(0.3);
    expect(parseMargin('SHD')).toBe(0.1);
    expect(parseMargin(1.5)).toBe(1.5);
    expect(toISODateOnly('26/09/2026')).toBe('2026-09-26');
    expect(toISODateOnly('2026-10-03T00:00:00Z')).toBe('2026-10-03');
    expect(toISODateOnly('03 Oct 2026')).toBe('2026-10-03');
    expect(toISODateOnly('garbage')).toBeUndefined();
  });
});

describe('TabAdapter', () => {
  const tab = new TabAdapter();

  it('lists meetings with conditions and venue codes', async () => {
    const ctx = ctxFor(routes);
    const meetings = await tab.listMeetings('2026-10-24', ctx);
    expect(meetings).toHaveLength(3);
    const flem = meetings.find((m) => m.venue === 'Flemington')!;
    expect(flem.venueSlug).toBe('flemington');
    expect(flem.state).toBe('VIC');
    expect(flem.trackRating).toBe(4);
    expect(flem.trackCondition).toMatch(/Good 4/i);
    expect(flem.rail).toBe('+3m Entire Circuit');
    expect(flem.raceCount).toBe(2);
    expect(flem.firstRaceTime).toBe('2026-10-24T01:25:00.000Z');
    expect(flem.sourceRefs.tab).toBe('R/FLM');
    expect(meetings.find((m) => m.venue === 'The Meadows')!.raceType).toBe('greyhound');
  });

  it('fetches a meeting card with runners, odds, scratchings and ratings', async () => {
    const ctx = ctxFor(routes);
    const [flem] = await tab.listMeetings('2026-10-24', ctx);
    const m = await tab.fetchMeeting(flem, ctx);
    expect(m.races).toHaveLength(2);
    const r1 = m.races[0];
    expect(r1.name).toBe('Maribyrnong Trial Stakes');
    expect(r1.distance).toBe(1000);
    expect(r1.group).toBe('Listed');
    expect(r1.prize).toBe(200000);
    expect(r1.status).toBe('open');
    expect(r1.runners).toHaveLength(3);
    const quick = r1.runners[0];
    expect(quick.name).toBe('Quick Study');
    expect(quick.jockey).toBe('James McDonald');
    expect(quick.trainer).toBe('Chris Waller');
    expect(quick.barrier).toBe(3);
    expect(quick.weight).toBe(57);
    expect(quick.scratched).toBe(false);
    expect(quick.speedMapPosition).toBe('on-pace');
    expect(quick.ratings).toMatchObject({ 'tab.techFormRating': 92, 'tab.dfsFormRating': 95 });
    expect(quick.odds).toHaveLength(2);
    const fixed = quick.odds!.find((o) => o.type === 'fixed')!;
    expect(fixed.win).toBe(2.8);
    expect(fixed.opening).toBe(3.2);
    expect(fixed.flucs).toHaveLength(2);
    const scratched = r1.runners[1];
    expect(scratched.scratched).toBe(true);
    expect(scratched.name).toBe('Late Scratch');
    expect(scratched.country).toBe('NZ');
    expect(scratched.odds).toBeUndefined();
    const emergency = r1.runners[2];
    expect(emergency.emergency).toBe(true);
    expect(emergency.claim).toBe(2);
    expect(emergency.speedMapPosition).toBe('backmarker');
  });

  it('fetches deep form with breeding, stats and previous starts in several spellings', async () => {
    const ctx = ctxFor(routes);
    const [flem] = await tab.listMeetings('2026-10-24', ctx);
    const form = await tab.fetchForm(flem, 1, ctx);
    expect(form).toHaveLength(2);
    const q = form[0];
    expect(q.sire).toBe('Zoustar');
    expect(q.damSire).toBe('Snitzel');
    expect(q.career).toEqual({ starts: 1, wins: 1, seconds: 0, thirds: 0, prizeMoney: 60000 });
    expect(q.splits!.track).toEqual({ starts: 1, wins: 1, seconds: 0, thirds: 0 });
    expect(q.splits!.good).toMatchObject({ starts: 1, wins: 1 });
    expect(q.splits!.firstUp).toMatchObject({ starts: 1, wins: 1 });
    expect(q.daysSinceLastRun).toBe(21);
    expect(q.gearChanges).toEqual(['Blinkers first time']);
    expect(q.comment).toContain('worked brilliantly');
    expect(q.form).toHaveLength(1);
    const line = q.form![0];
    expect(line).toMatchObject({ date: '2026-10-03', venue: 'Caulfield', distance: 1000, trackRating: 4, position: 1, starters: 9, margin: 0, weight: 57, barrier: 4, jockey: 'J McDonald', raceClass: '2YO MDN', startingPrice: 2.4, inRunning: '2-2' });
    expect(line.second).toBe('Runner Up');
    const slow = form[1];
    expect(slow.career).toEqual({ starts: 1, wins: 0, seconds: 0, thirds: 0 });
    expect(slow.form![0]).toMatchObject({ date: '2026-09-26', venue: 'Bendigo', trackRating: 6, position: 4, margin: 3.2, winner: 'Winner One' });
  });

  it('returns results only once a race is paying', async () => {
    const open = ctxFor(routes);
    const [flem] = await tab.listMeetings('2026-10-24', open);
    expect(await tab.fetchResults(flem, 1, open)).toBeNull();
    const done = ctxFor([[/meetings\/R\/FLM\/races\/1\?/, fx('race-FLE-1-final.json')], ...routes]);
    const res = await tab.fetchResults(flem, 1, done);
    expect(res).not.toBeNull();
    expect(res!.placings).toEqual([[3], [1]]);
    expect(res!.dividends?.win).toBe(26.4);
    const race = await tab.fetchRace(flem, 1, done);
    expect(race.status).toBe('final');
    expect(race.runners.find((r) => r.number === 3)!.finishingPosition).toBe(1);
  });

  it('survives a race endpoint failing and still returns the rest', async () => {
    const ctx = ctxFor(routes.filter(([re]) => !re.source.includes('races\\/2')));
    const [flem] = await tab.listMeetings('2026-10-24', ctx);
    const m = await tab.fetchMeeting(flem, ctx);
    expect(m.races).toHaveLength(1);
  });

  it('works out the venue code from the meeting list when the ref is missing', async () => {
    const ctx = ctxFor(routes);
    const m = await tab.fetchMeeting({ id: '2026-10-24:flemington', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', raceType: 'thoroughbred', sourceRefs: {}, sources: [] }, ctx);
    expect(m.races.length).toBeGreaterThan(0);
  });
});
