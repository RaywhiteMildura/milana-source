import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HttpClient } from '../../core/http.js';
import { silentLogger } from '../../core/logger.js';
import type { FetchContext } from '../types.js';
import { RacingComAdapter } from './racingcom.js';
import { clockToIso, localToIso, offsetMinutes, parseRaceTime } from './timezone.js';

const fx = (name: string) => fs.readFileSync(path.resolve('fixtures/racingcom', name), 'utf8');

/** Routes GraphQL POSTs by the operation text in the body. */
function ctxFor(routes: Array<[RegExp, string]>, opts: { rejectRich?: boolean } = {}): FetchContext & { bodies: string[] } {
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    let body = String(init?.body || '');
    try {
      body = String((JSON.parse(body) as { query?: string }).query || body);
    } catch {
      /* keep raw */
    }
    bodies.push(body);
    if (opts.rejectRich && /tempo/.test(body)) return new Response(fx('error-validation.json'), { status: 200, headers: { 'content-type': 'application/json' } });
    const hit = routes.find(([re]) => re.test(body));
    if (!hit) return new Response(JSON.stringify({ data: null, errors: [{ message: 'not found' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(hit[1], { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { http: new HttpClient({ fetchImpl, cacheTtlMs: 0, perHostDelayMs: 0 }), log: silentLogger, now: () => new Date('2026-10-24T00:00:00.000Z'), jurisdiction: 'VIC', bodies };
}

const routes: Array<[RegExp, string]> = [
  [/GetMeetingByDate\(date:"2026-10-24"\)/, fx('meetings-2026-10-24.json')],
  [/getRacesForMeet\(meetCode:"MEET-FLM-20261024"\)/, fx('races-FLM.json')],
  [/getRaceForm\(meetCode:"MEET-FLM-20261024", raceNumber:1\)/, fx('raceform-FLM-1.json')],
];

describe('timezone helpers', () => {
  it('computes AEDT / AEST offsets and converts local clocks', () => {
    expect(offsetMinutes('Australia/Melbourne', new Date('2026-10-24T02:00:00Z'))).toBe(660);
    expect(offsetMinutes('Australia/Brisbane', new Date('2026-10-24T02:00:00Z'))).toBe(600);
    expect(offsetMinutes('Australia/Adelaide', new Date('2026-10-24T02:00:00Z'))).toBe(630);
    expect(localToIso('2026-10-24T12:25', 'Australia/Melbourne')).toBe('2026-10-24T01:25:00.000Z');
    expect(clockToIso('2026-10-24', '3:45PM', 'VIC')).toBe('2026-10-24T04:45:00.000Z');
    expect(clockToIso('2026-10-24', '12:05pm', 'QLD')).toBe('2026-10-24T02:05:00.000Z');
    expect(parseRaceTime('2026-10-24T01:25:00.000Z')).toBe('2026-10-24T01:25:00.000Z');
    expect(parseRaceTime('2026-10-24T12:25:00', 'VIC')).toBe('2026-10-24T01:25:00.000Z');
    expect(parseRaceTime(undefined)).toBeUndefined();
  });
});

describe('RacingComAdapter', () => {
  const rc = new RacingComAdapter(0, 'test-key');

  it('lists TAB meetings only, deduped, skipping trials and overseas', async () => {
    const ctx = ctxFor(routes);
    const meetings = await rc.listMeetings('2026-10-24', ctx);
    expect(meetings.map((m) => m.venue)).toEqual(['Flemington', 'Randwick']);
    const flem = meetings[0];
    expect(flem.sourceRefs.racingcom).toBe('MEET-FLM-20261024');
    expect(flem.trackRating).toBe(4);
    expect(flem.trackCondition).toBe('Good 4');
    expect(flem.rail).toBe('+3m Entire Circuit');
    expect(flem.raceCount).toBe(9);
    expect(ctx.bodies[0]).toContain('GetMeetingByDate');
  });

  it('merges formRaceEntries and raceEntries, maps form, odds, stats and strike rates', async () => {
    const ctx = ctxFor(routes);
    const [flem] = await rc.listMeetings('2026-10-24', ctx);
    const m = await rc.fetchMeeting(flem, ctx);
    expect(m.races).toHaveLength(2); // R2 has no form fixture → skeleton only
    const r1 = m.races[0];
    expect(r1.number).toBe(1);
    expect(r1.distance).toBe(1000);
    expect(r1.prize).toBe(200000);
    expect(r1.group).toBe('Listed');
    expect(r1.startTime).toBe('2026-10-24T01:25:00.000Z');
    expect(r1.status).toBe('open');
    expect(r1.sourceRefs['racingcom.tempo']).toBe('Fast');
    expect(r1.runners).toHaveLength(3);
    const q = r1.runners[0];
    expect(q).toMatchObject({ number: 1, name: 'Quick Study', barrier: 3, jockey: 'James McDonald', trainer: 'Chris Waller', weight: 57, scratched: false, age: 2, sex: 'Colt', last5: '1' });
    expect(q.career).toEqual({ starts: 1, wins: 1, seconds: 0, thirds: 0 });
    expect(q.splits!.good).toEqual({ starts: 1, wins: 1, seconds: 0, thirds: 0 });
    expect(q.splits!.firstUp).toEqual({ starts: 1, wins: 1, seconds: 0, thirds: 0 });
    expect(q.ratings).toMatchObject({ 'racingcom.rating': 92, 'racingcom.handicapRating': 74 });
    expect(q.gearChanges).toEqual(['Blinkers first time']);
    expect(q.comment).toContain('Dominant on debut');
    expect(q.jockeyStats).toMatchObject({ winPct: 24.5, recentWinPct: 27.1 });
    expect(q.trainerStats).toMatchObject({ winPct: 18.2 });
    expect(q.odds).toHaveLength(3);
    expect(q.odds!.find((o) => o.bookmaker === 'Sportsbet')).toMatchObject({ type: 'fixed', win: 2.8, place: 1.3, opening: 3.2 });
    expect(q.odds!.find((o) => o.bookmaker === 'VIC Tote')!.type).toBe('tote');
    expect(q.form).toHaveLength(1); // the trial is filtered out
    expect(q.form![0]).toMatchObject({ date: '2026-10-03', venue: 'Caulfield', distance: 1000, position: 1, starters: 9, margin: 0, weight: 57, barrier: 4, startingPrice: 2.4, trackRating: 4, inRunning: '2-2', time: '57.80' });
    const scratched = r1.runners.find((r) => r.number === 2)!;
    expect(scratched.scratched).toBe(true);
    expect(scratched.country).toBe('NZ');
    const emergency = r1.runners.find((r) => r.number === 3)!;
    expect(emergency.emergency).toBe(true);
    expect(emergency.weight).toBe(53);
    expect(emergency.jockeyStats).toMatchObject({ winPct: 19 });
    expect(emergency.form![0]).toMatchObject({ trackRating: 6, margin: 3.2, inRunning: '9-8' });
  });

  it('reads results, margins and starting prices after the race', async () => {
    const ctx = ctxFor([[/getRaceForm\(meetCode:"MEET-FLM-20261024", raceNumber:1\)/, fx('raceform-FLM-1-final.json')], ...routes]);
    const meeting = { id: '2026-10-24:flemington', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', state: 'VIC', raceType: 'thoroughbred' as const, sourceRefs: { racingcom: 'MEET-FLM-20261024' }, sources: [] };
    const race = await rc.fetchRace(meeting, 1, ctx);
    expect(race.status).toBe('final');
    expect(race.results).toEqual([[3], [1]]);
    const winner = race.runners.find((r) => r.number === 3)!;
    expect(winner.finishingPosition).toBe(1);
    expect(winner.odds!.find((o) => o.bookmaker === 'Starting price')!.win).toBe(26);
    const second = race.runners.find((r) => r.number === 1)!;
    expect(second).toMatchObject({ finishingPosition: 2, margin: 0.5 });
    expect(race.dividends?.win).toBe(26);
    const res = await rc.fetchResults(meeting, 1, ctx);
    expect(res!.placings).toEqual([[3], [1]]);
    expect(await rc.fetchResults(meeting, 1, ctxFor(routes))).toBeNull();
  });

  it('falls back to the minimal field set when the schema rejects a rich field', async () => {
    const ctx = ctxFor(routes, { rejectRich: true });
    const meetings = await rc.listMeetings('2026-10-24', ctx);
    expect(meetings.length).toBeGreaterThan(0);
    const m = await rc.fetchMeeting(meetings[0], ctx);
    expect(m.races.length).toBeGreaterThan(0);
    expect(ctx.bodies.some((b) => /tempo/.test(b))).toBe(true);
    expect(ctx.bodies.filter((b) => /getRacesForMeet/.test(b)).length).toBe(2); // rich then minimal
  });

  it('refuses a race payload for a different race number', async () => {
    const ctx = ctxFor([[/raceNumber:2\)/, fx('raceform-FLM-1.json')], ...routes]);
    const meeting = { id: 'x', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', state: 'VIC', raceType: 'thoroughbred' as const, sourceRefs: { racingcom: 'MEET-FLM-20261024' }, sources: [] };
    await expect(rc.fetchRace(meeting, 2, ctx)).rejects.toThrow(/returned race 1/);
  });

  it('resolves the meet code from the date listing when refs are missing', async () => {
    const ctx = ctxFor(routes);
    const meeting = { id: '2026-10-24:flemington', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', raceType: 'thoroughbred' as const, sourceRefs: {}, sources: [] };
    const m = await rc.fetchMeeting(meeting, ctx);
    expect(m.meeting.sourceRefs.racingcom).toBe('MEET-FLM-20261024');
  });
});
