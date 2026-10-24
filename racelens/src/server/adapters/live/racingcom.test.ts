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
    expect(emergency.weight).toBe(55); // allotted `weight`, not the 53 kg `weightCarried`
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

  it('reports a protest-pending race as interim even though placings are published', async () => {
    const interim = fx('raceform-FLM-1-final.json').replace('"raceStatus":"Resulted"', '"raceStatus":"Interim"').replace('"raceStatus": "Resulted"', '"raceStatus": "Interim"');
    expect(interim).toMatch(/Interim/);
    const ctx = ctxFor([[/getRaceForm\(meetCode:"MEET-FLM-20261024", raceNumber:1\)/, interim], ...routes]);
    const meeting = { id: '2026-10-24:flemington', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', state: 'VIC', raceType: 'thoroughbred' as const, sourceRefs: { racingcom: 'MEET-FLM-20261024' }, sources: [] };
    expect((await rc.fetchRace(meeting, 1, ctx)).status).toBe('interim');
    const res = await rc.fetchResults(meeting, 1, ctx);
    expect(res).toMatchObject({ status: 'interim', placings: [[3], [1]] });
  });

  it('reports a tote that is "Closed" (suspended before the jump) or "Running" as closed, never as an interim result', async () => {
    const meeting = { id: '2026-10-24:flemington', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', state: 'VIC', raceType: 'thoroughbred' as const, sourceRefs: { racingcom: 'MEET-FLM-20261024' }, sources: [] };
    for (const [raceStatus, expected] of [['Closed', 'closed'], ['Running', 'closed'], ['Normal', 'open']] as const) {
      const form = fx('raceform-FLM-1.json').replace(/"raceStatus": *"Normal"/, `"raceStatus": "${raceStatus}"`);
      expect(form).toContain(`"raceStatus": "${raceStatus}"`);
      const ctx = ctxFor([[/getRaceForm\(meetCode:"MEET-FLM-20261024", raceNumber:1\)/, form], ...routes]);
      const race = await rc.fetchRace(meeting, 1, ctx);
      expect(race.status).toBe(expected);
      expect(race.results).toBeUndefined();
      expect(await rc.fetchResults(meeting, 1, ctx)).toBeNull();
    }
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

  it('reports the allotted weight and the claim separately for an apprentice (research fixture, BIRDCAGE BANDIT)', async () => {
    const research = fs.readFileSync(path.resolve('research/fixtures/racingcom/graphql-getRaceForm-prerace.json'), 'utf8');
    const meeting = { id: '2026-10-24:flemington', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', state: 'VIC', raceType: 'thoroughbred' as const, sourceRefs: { racingcom: 'MEET-FLM-20261024' }, sources: [] };
    const race = await rc.fetchRace(meeting, 3, ctxFor([[/getRaceForm\(meetCode:"MEET-FLM-20261024", raceNumber:3\)/, research]]));
    const bandit = race.runners.find((r) => r.number === 3)!;
    expect(bandit).toMatchObject({ name: 'BIRDCAGE BANDIT', jockey: 'Celine Gaudray', weight: 57.5, claim: 2 }); // weight '57.5kg', weightCarried '55.5kg'
    expect(race.runners.find((r) => r.number === 1)).toMatchObject({ weight: 58.5 });
    expect(race.runners.find((r) => r.number === 1)!.claim).toBeUndefined();
    // Form lines name the canonical venue.
    expect(race.runners.find((r) => r.number === 2)!.form!.map((f) => f.venue)).toEqual(['Caulfield', 'Moonee Valley']); // "The Valley"
    expect(race.runners.find((r) => r.number === 5)!.form!.map((f) => f.venue)).toEqual(['Flemington', 'Sandown']); // "Sandown Hillside" (the Werribee jump-out is not form)

    // Only `weightCarried` published: the claim is added back.
    const carriedOnly = research.replace('"weight": "57.5kg",', '');
    expect(carriedOnly).not.toBe(research);
    const r2 = await rc.fetchRace(meeting, 3, ctxFor([[/getRaceForm\(meetCode:"MEET-FLM-20261024", raceNumber:3\)/, carriedOnly]]));
    expect(r2.runners.find((r) => r.number === 3)).toMatchObject({ weight: 57.5, claim: 2 });
  });

  it('lists track configurations under the canonical venue and resolves either name, querying by meet code', async () => {
    const listing = JSON.stringify({
      data: {
        m: [
          { id: 'MEET-SAN-20261028', date: '2026-10-28', meetingName: 'Sandown Hillside', venueName: 'Sandown Hillside', state: 'VIC', country: 'AUS', isTab: 1, isTrial: false, isJumpOut: false, isPicnic: false, racesCount: 8 },
          { id: 'MEET-MV-20261028', date: '2026-10-28', meetingName: 'The Valley', venueName: 'The Valley', state: 'VIC', country: 'AUS', isTab: 1, isTrial: false, isJumpOut: false, isPicnic: false, racesCount: 8 },
        ],
      },
    });
    const ctx = ctxFor([
      [/GetMeetingByDate\(date:"2026-10-28"\)/, listing],
      [/getRacesForMeet\(meetCode:"MEET-SAN-20261028"\)/, fx('races-FLM.json')],
    ]);
    const list = await rc.listMeetings('2026-10-28', ctx);
    expect(list.map((m) => [m.venue, m.venueSlug, m.id])).toEqual([
      ['Sandown', 'sandown', '2026-10-28:sandown'],
      ['Moonee Valley', 'moonee-valley', '2026-10-28:moonee-valley'],
    ]);
    expect(list[0].sourceRefs).toEqual({ racingcom: 'MEET-SAN-20261028', 'racingcom.venue': 'Sandown Hillside' });
    for (const venue of ['Sandown', 'Sandown Hillside']) {
      const slug = venue.toLowerCase().replace(/\s+/g, '-');
      const m = await rc.fetchMeeting({ id: `2026-10-28:${slug}`, date: '2026-10-28', venue, venueSlug: slug, state: 'VIC', raceType: 'thoroughbred', sourceRefs: {}, sources: [] }, ctx);
      expect(m.meeting.sourceRefs.racingcom).toBe('MEET-SAN-20261028');
    }
    // GraphQL goes by the date and the feed's own meet code; the canonical name is never sent.
    expect(ctx.bodies.some((b) => /Sandown/.test(b))).toBe(false);

    // Flemington (today's card) is unchanged.
    const [flem] = await rc.listMeetings('2026-10-24', ctxFor(routes));
    expect(flem).toMatchObject({ id: '2026-10-24:flemington', venue: 'Flemington', venueSlug: 'flemington', state: 'VIC' });
    expect(flem.sourceRefs).toEqual({ racingcom: 'MEET-FLM-20261024', 'racingcom.venue': 'Flemington' });
  });
});
