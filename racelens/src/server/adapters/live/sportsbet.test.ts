import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HttpClient } from '../../core/http.js';
import { silentLogger } from '../../core/logger.js';
import type { FetchContext } from '../types.js';
import { SportsbetAdapter, epochToIso } from './sportsbet.js';

const fx = (name: string) => fs.readFileSync(path.resolve('fixtures/sportsbet', name), 'utf8');

function ctxFor(routes: Array<[RegExp, string]>): FetchContext {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response('{"code":"ResourceNotFound","message":"nope"}', { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(hit[1], { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { http: new HttpClient({ fetchImpl, cacheTtlMs: 0, perHostDelayMs: 0 }), log: silentLogger, now: () => new Date('2026-10-24T00:00:00.000Z'), jurisdiction: 'VIC' };
}

const routes: Array<[RegExp, string]> = [
  [/AllRacing\/2026-10-24$/, fx('allracing_2026-10-24.json')],
  [/Events\/10950007\/RacecardWithContext\?classId=1$/, fx('racecard_with_context_flemington_r7_priced.json')],
  [/Events\/10812059\/RacecardWithContext\?classId=1$/, fx('racecard_with_context_REAL_ruakaka_r5_resulted_trimmed.json')],
];

describe('SportsbetAdapter', () => {
  const sb = new SportsbetAdapter(0);

  it('lists meetings for a date by code with event references', async () => {
    const meetings = await sb.listMeetings('2026-10-24', ctxFor(routes));
    const flem = meetings.find((m) => m.venue === 'Flemington')!;
    expect(flem).toBeDefined();
    expect(flem.raceType).toBe('thoroughbred');
    expect(flem.country).toBe('AUS');
    expect(flem.raceCount).toBe(8);
    expect(flem.sourceRefs.sportsbet.startsWith('356|1|')).toBe(true);
    expect(flem.firstRaceTime).toMatch(/^2026-10-2/);
    expect(meetings.find((m) => m.venue === 'Ruakaka')!.country).toBe('NZ');
    expect(meetings.find((m) => m.venue === 'The Meadows')!.raceType).toBe('greyhound');
    expect(meetings.find((m) => m.venue === 'Melton')!.raceType).toBe('harness');
  });

  it('fetches the races it can and skips the ones that fail', async () => {
    const ctx = ctxFor(routes);
    const [flem] = (await sb.listMeetings('2026-10-24', ctx)).filter((m) => m.venue === 'Flemington');
    const m = await sb.fetchMeeting(flem, ctx);
    expect(m.races).toHaveLength(1); // only R7 has a fixture
    const r7 = m.races[0];
    expect(r7.number).toBe(7);
    expect(r7.name).toBe('Flemington Mile');
    expect(r7.group).toBe('G1');
    expect(r7.distance).toBeGreaterThan(0);
    expect(r7.status).toBe('open');
    expect(r7.trackRating).toBe(4);
    expect(m.meeting.trackRating).toBe(4);
    const first = r7.runners[0];
    expect(first).toMatchObject({ number: 1, name: 'Velvet Thunder', barrier: 7, jockey: 'L. Harcourt', trainer: 'C. Maher & D. Eustace', weight: 59, scratched: false });
    const fixed = first.odds![0];
    expect(fixed.win).toBe(3.4);
    expect(fixed.place).toBe(1.45);
    expect(fixed.bookmaker).toBe('Sportsbet');
    const scratched = r7.runners.find((r) => r.name === 'Midnight Ferry')!;
    expect(scratched.scratched).toBe(true);
    expect(scratched.odds).toBeUndefined();
  });

  it('parses the real resulted racecard: form, stats, breeding, placings', async () => {
    const ctx = ctxFor(routes);
    const meeting = { id: '2026-08-15:ruakaka', date: '2026-08-15', venue: 'Ruakaka', venueSlug: 'ruakaka', raceType: 'thoroughbred' as const, sourceRefs: { sportsbet: '583|1|5:10812059' }, sources: [] };
    const race = await sb.fetchRace(meeting, 5, ctx);
    expect(race.status).toBe('final');
    expect(race.name).toBe('Ruakākā Beach Front Motel');
    expect(race.raceClass).toBe('BM65');
    expect(race.distance).toBe(1600);
    expect(race.trackRating).toBe(6);
    expect(race.startTime).toBe(epochToIso(1786763220));
    expect(race.sourceRefs['sportsbet.tempo']).toBe('Normal');
    expect(race.results![0]).toEqual([9]);
    expect(race.results![1]).toEqual([8]);
    expect(race.results![2]).toEqual([2]);
    const dt = race.runners.find((r) => r.name === 'Double Take')!;
    expect(dt).toMatchObject({ number: 1, barrier: 14, jockey: 'Tom Wigram', trainer: 'J & R Vance', weight: 60, claim: 3, finishingPosition: 12, margin: 6.8, age: 10, sex: 'Gelding', colour: 'b', sire: 'Declaration Of War', dam: 'Hidden Kisses' });
    expect(dt.career).toMatchObject({ starts: 54, wins: 6, seconds: 5, thirds: 7 });
    expect(dt.splits!.track).toEqual({ starts: 8, wins: 2, seconds: 1, thirds: 1 });
    expect(dt.splits!.heavy).toEqual({ starts: 6, wins: 1, seconds: 0, thirds: 0 });
    expect(dt.splits!.jockey).toEqual({ starts: 0, wins: 0, seconds: 0, thirds: 0 });
    expect(dt.ratings).toMatchObject({ 'sportsbet.dryRating': 79, 'sportsbet.wetRating': 79 });
    expect(dt.odds![0]).toMatchObject({ win: 41, place: 9, opening: 23 });
    expect(dt.odds![0].flucs!.length).toBeGreaterThan(5);
    expect(dt.odds![0].flucs![dt.odds![0].flucs!.length - 1].price).toBe(41);
    expect(dt.form!.length).toBeGreaterThan(0);
    expect(dt.form![0]).toMatchObject({ date: '2026-07-25', venue: 'Te Rapa', distance: 1600, trackRating: 10, position: 7, starters: 7, margin: 15.5, weight: 56, barrier: 3, jockey: 'M Hashizume', raceClass: 'BM75', startingPrice: 23.6, winner: 'Pegasus', second: "Amira D'Argento" });
    expect(dt.comment).toBeTruthy();
    const res = await sb.fetchResults(meeting, 5, ctx);
    expect(res!.placings[0]).toEqual([9]);
    expect(res!.dividends?.win).toBeGreaterThan(1);
  });

  it('refuses a racecard for a different race number', async () => {
    const meeting = { id: 'x', date: '2026-08-15', venue: 'Ruakaka', venueSlug: 'ruakaka', raceType: 'thoroughbred' as const, sourceRefs: { sportsbet: '583|1|4:10812059' }, sources: [] };
    await expect(sb.fetchRace(meeting, 4, ctxFor(routes))).rejects.toThrow(/returned race 5/);
  });

  it('returns null results for an unfinished race', async () => {
    const ctx = ctxFor(routes);
    const [flem] = (await sb.listMeetings('2026-10-24', ctx)).filter((m) => m.venue === 'Flemington');
    expect(await sb.fetchResults(flem, 7, ctx)).toBeNull();
  });
});
