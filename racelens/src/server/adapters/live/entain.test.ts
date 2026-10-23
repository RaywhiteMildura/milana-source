import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HttpClient } from '../../core/http.js';
import { silentLogger } from '../../core/logger.js';
import type { FetchContext, Logger } from '../types.js';
import type { MeetingSummary } from '../../../shared/types.js';
import { EntainAdapter, speedMap, splitRaceName } from './entain.js';

const fx = (name: string) => fs.readFileSync(path.resolve('fixtures/entain', name), 'utf8');

type Route = [RegExp, string, number?];

interface Harness {
  ctx: FetchContext;
  urls: string[];
  headers: Array<Record<string, string>>;
  log: Logger & { warnings: string[] };
}

function harness(routes: Route[], opts: { jurisdiction?: string; failHost?: RegExp } = {}): Harness {
  const urls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const warnings: string[] = [];
  const log: Harness['log'] = { ...silentLogger, warnings, warn: (m) => void warnings.push(String(m)) };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    headers.push({ ...((init?.headers as Record<string, string>) || {}) });
    if (opts.failHost && opts.failHost.test(url)) throw new TypeError('fetch failed');
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response('{"header":{"error":"event not found"},"data":null}', { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(hit[1], { status: hit[2] ?? 200, headers: { 'content-type': 'application/json' } });
  };
  const ctx: FetchContext = {
    http: new HttpClient({ fetchImpl, cacheTtlMs: 0, perHostDelayMs: 0 }),
    log,
    now: () => new Date('2026-10-23T02:00:00.000Z'),
    jurisdiction: opts.jurisdiction ?? 'VIC',
  };
  return { ctx, urls, headers, log };
}

const ctxFor = (routes: Route[]) => harness(routes).ctx;

const CRANBOURNE_R7 = 'd57c1bde-5361-4dc1-8adb-f73421ead4ee';
const BALLARAT_R1 = '084273b2-fc3c-428d-9b92-0ff7449c8c76';
const FLEMINGTON_R1 = 'e143b009-7376-5899-982c-f79b4a46fbcd';
const MISSING = '00000000-0000-0000-0000-000000000000';
const ENVELOPE_ERROR = '11111111-1111-1111-1111-111111111111';
const WRONG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const routes: Route[] = [
  [/\/meetings\?enc=json&date_from=2026-10-24&date_to=2026-10-24&category=T&country=AUS&limit=200$/, fx('affiliates_meetings_2026-10-24_T_AUS.json')],
  [new RegExp(`/events/${CRANBOURNE_R7}\\?enc=json$`), fx('affiliates_event_REAL_cranbourne_r7_open_2026-10-23.json')],
  [new RegExp(`/events/${BALLARAT_R1}\\?enc=json$`), fx('affiliates_event_REAL_ballarat_r1_interim_results_2026-10-23.json')],
  [new RegExp(`/events/${FLEMINGTON_R1}\\?enc=json$`), fx('affiliates_event_flemington_r1_final_results_dividends_2026-10-24.json')],
  [new RegExp(`/events/${MISSING}\\?enc=json$`), fx('affiliates_error_404_not_found.json'), 404],
  [new RegExp(`/events/${ENVELOPE_ERROR}\\?enc=json$`), fx('affiliates_error_404_not_found.json'), 200],
  // The Cranbourne payload served under a different id, for the identity check.
  [new RegExp(`/events/${WRONG_ID}\\?enc=json$`), fx('affiliates_event_REAL_cranbourne_r7_open_2026-10-23.json')],
];

function meeting(venue: string, date: string, ref: string): MeetingSummary {
  const slug = venue.toLowerCase();
  return { id: `${date}:${slug}`, date, venue, venueSlug: slug, raceType: 'thoroughbred', sourceRefs: { entain: ref }, sources: [] };
}

const cranbourne = meeting('Cranbourne', '2026-10-23', `e8b3a22d-b111-5448-9334-7ec9fcd51975|7:${CRANBOURNE_R7}`);
const ballarat = meeting('Ballarat', '2026-10-23', `d608c7eb-885e-522f-a65c-eece7f1506c7|1:${BALLARAT_R1}`);

describe('EntainAdapter', () => {
  const en = new EntainAdapter(0);

  it('declares itself as one odds source with no per-start form', () => {
    expect(en.id).toBe('entain');
    expect(en.name).toBe('Ladbrokes / Neds (Entain)');
    expect(en.kind).toBe('odds');
    expect(en.capabilities).toEqual(['meetings', 'racecard', 'odds', 'results', 'conditions']);
  });

  it('lists AU thoroughbred meetings for a date with race references', async () => {
    const h = harness(routes);
    const meetings = await en.listMeetings('2026-10-24', h.ctx);
    expect(meetings).toHaveLength(2);
    const flem = meetings.find((m) => m.venue === 'Flemington')!;
    expect(flem.id).toBe('2026-10-24:flemington');
    expect(flem.venueSlug).toBe('flemington');
    expect(flem.state).toBe('VIC');
    expect(flem.country).toBe('AUS');
    expect(flem.raceType).toBe('thoroughbred');
    expect(flem.raceCount).toBe(9); // race_number 0 (Jockey Challenge) is not a race
    expect(flem.trackCondition).toBe('Good 4');
    expect(flem.trackRating).toBe(4);
    expect(flem.weather).toBe('Fine');
    expect(flem.firstRaceTime).toBe('2026-10-24T01:40:00.000Z');
    expect(flem.sourceRefs.entain.startsWith(`c1eb9968-e932-5b14-a0f8-d159722d5017|1:${FLEMINGTON_R1},2:b04b24ce-8208-5044-aead-1c122120b5c4,`)).toBe(true);
    expect(flem.sourceRefs.entain).not.toMatch(/\|0:|,0:/);
    expect(flem.sources).toEqual(['entain']);
    const doomben = meetings.find((m) => m.venue === 'Doomben')!;
    expect(doomben.state).toBe('QLD');
    expect(doomben.raceCount).toBe(3);
    expect(doomben.trackRating).toBe(5);
    expect(doomben.weather).toBe('Overcast');
    // Identification headers and enc=json on every call.
    expect(h.urls[0]).toContain('https://api.ladbrokes.com.au/affiliates/v1/racing/meetings?enc=json&');
    expect(h.headers[0]['X-Partner']).toBe('RaceLens personal research');
    expect(h.headers[0].From).toBeTruthy();
    expect(h.headers[0]['Content-Type']).toBe('application/json');
    expect(h.headers[0].Accept).toBe('application/json');
  });

  it('parses the real open Cranbourne R7 card: race, runners, odds, flucs, speed map, tips', async () => {
    const race = await en.fetchRace(cranbourne, 7, ctxFor(routes));
    expect(race.number).toBe(7);
    expect(race.name).toBe('Ladbrokes Cox Plate @ Flemington');
    expect(race.raceClass).toBe('BM70 Hcp');
    expect(race.group).toBeUndefined();
    expect(race.distance).toBe(1200);
    expect(race.startTime).toBe('2026-10-23T10:15:00.000Z');
    expect(race.status).toBe('open');
    expect(race.trackCondition).toBe('Soft 5');
    expect(race.trackRating).toBe(5);
    expect(race.prize).toBe(60000);
    expect(race.source).toBe('entain');
    expect(race.sourceRefs.entain).toBe(CRANBOURNE_R7);
    expect(race.sourceRefs['entain.rail']).toBe('True Entire Circuit. (Pent: 5.51)');
    expect(race.sourceRefs['entain.tips']).toBe('1,9,2,8');
    expect(race.sourceRefs['entain.comment']!.startsWith('ESMAHLI (1) looks very well placed')).toBe(true);
    expect(race.sourceRefs['entain.comment']!.length).toBeLessThanOrEqual(500);
    expect(race.results).toBeUndefined();
    expect(race.dividends).toBeUndefined();

    expect(race.runners).toHaveLength(13);
    expect(race.runners.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

    const esmahli = race.runners.find((r) => r.name === 'Esmahli')!;
    expect(esmahli).toMatchObject({
      number: 1,
      barrier: 3,
      jockey: 'Nadia Daniels',
      trainer: 'Ben, Will & Jd Hayes',
      weight: 58.5,
      claim: 3,
      scratched: false,
      age: 4,
      sex: 'Gelding',
      colour: 'B/BR',
      sire: 'Blue Point',
      dam: 'Danaat',
      country: 'AUS',
      last5: '17x22',
      speedMapPosition: 'midfield',
    });
    expect(esmahli.odds).toHaveLength(1);
    expect(esmahli.odds![0]).toMatchObject({ source: 'entain', bookmaker: 'Ladbrokes', type: 'fixed', win: 2.7, place: 1.35, opening: 3.3 });
    expect(esmahli.odds![0].flucs).toHaveLength(6);
    expect(esmahli.odds![0].flucs![0]).toEqual({ price: 2.7, at: '2026-10-22T20:29:00Z' });
    expect(esmahli.odds![0].flucs![3].price).toBe(2.5);
    expect(esmahli.odds![0].flucs![5].price).toBe(2.7);
    expect(esmahli.splits!.jockey).toEqual({ starts: 0, wins: 0, seconds: 0, thirds: 0 });
    expect(esmahli.comment).toBe('Trackside pick #1 (Craig Sheppard): 2nd Best bet');
    expect(esmahli.silk).toMatch(/esmahli_64x64\.png$/);
    expect(esmahli.career).toBeUndefined();
    expect(esmahli.form).toBeUndefined();
    expect(esmahli.ratings).toBeUndefined();
    expect(esmahli.finishingPosition).toBeUndefined();

    const nationState = race.runners.find((r) => r.name === 'Nation State')!;
    expect(nationState).toMatchObject({ number: 4, barrier: 1, jockey: 'Jordan Childs', weight: 60, age: 6, colour: 'CH' });
    expect(nationState.claim).toBeUndefined(); // no apprentice indicator
    expect(nationState.odds![0]).toMatchObject({ win: 8, place: 2.15, opening: 19 });
    expect(nationState.splits!.jockey).toEqual({ starts: 1, wins: 0, seconds: 0, thirds: 0 });
    expect(nationState.comment).toBe('Unbeaten the Track; Trackside pick #4 (Craig Sheppard)');

    const shaime = race.runners.find((r) => r.name === 'Shaime')!;
    expect(shaime.sex).toBe('Mare');
    expect(shaime.speedMapPosition).toBe('on-pace'); // "Off Pace"
    expect(shaime.comment).toBe('Soft Specialist; Form on Soft');
    expect(race.runners.find((r) => r.name === 'Charming Nic')!.speedMapPosition).toBe('midfield'); // "Off Midfield"
    expect(race.runners.find((r) => r.name === 'Ladhar')!.sex).toBe('Filly');
    expect(race.runners.find((r) => r.name === 'Street Conqueror')!.splits!.jockey).toEqual({ starts: 4, wins: 1, seconds: 0, thirds: 2 });

    const scratched = race.runners.filter((r) => r.scratched).map((r) => r.number);
    expect(scratched).toEqual([3, 5, 12, 13]);
    const imperial = race.runners.find((r) => r.name === 'Imperial Award')!;
    expect(imperial.scratched).toBe(true);
    expect(imperial.odds).toBeUndefined(); // frozen price on a scratching is not a quote
    expect(imperial.speedMapPosition).toBeUndefined(); // "invalid settling lengths"
    expect(imperial.comment).toBe('Picket Fence; Distance Specialist; Unbeaten the Distance; Trackside pick #2 (Craig Sheppard)');
  });

  it('fetchMeeting sets rail, going and weather from the first race', async () => {
    const m = await en.fetchMeeting(cranbourne, ctxFor(routes));
    expect(m.source).toBe('entain');
    expect(m.races).toHaveLength(1);
    expect(m.meeting.rail).toBe('True Entire Circuit. (Pent: 5.51)');
    expect(m.meeting.trackCondition).toBe('Soft 5');
    expect(m.meeting.trackRating).toBe(5);
    expect(m.meeting.weather).toBe('Fine');
    expect(m.meeting.sources).toEqual(['entain']);
  });

  it('parses the real interim Ballarat R1: placings, scratchings, finishing positions, tips via derivatives', async () => {
    const race = await en.fetchRace(ballarat, 1, ctxFor(routes));
    expect(race.status).toBe('interim');
    expect(race.name).toBe('Epijoint F&M Mdn Plate');
    expect(race.raceClass).toBeUndefined();
    expect(race.distance).toBe(1000);
    expect(race.trackRating).toBe(4);
    expect(race.startTime).toBe('2026-10-23T01:35:00.000Z');
    expect(race.prize).toBe(42500);
    expect(race.results).toEqual([[10], [4], [9], [3]]);
    expect(race.dividends).toBeUndefined(); // none in the interim capture
    expect(race.runners).toHaveLength(11); // Live Racing derivative rows are not runners
    // Two of the four tip ids belong to the Live Racing market; they still resolve to saddlecloths.
    expect(race.sourceRefs['entain.tips']).toBe('7,11,4,3');

    const winner = race.runners.find((r) => r.name === 'Southern Sway')!;
    expect(winner).toMatchObject({ number: 10, barrier: 4, jockey: 'Billy Egan', trainer: 'Dominic Sutton', weight: 55.5, finishingPosition: 1, margin: 0 });
    expect(winner.odds![0]).toMatchObject({ win: 3.8, place: 1.55, opening: 9 });
    expect(winner.last5).toBeUndefined(); // first starter
    expect(winner.speedMapPosition).toBeUndefined(); // empty speedmap object
    const second = race.runners.find((r) => r.name === 'Kokeshi')!;
    expect(second.finishingPosition).toBe(2);
    expect(second.margin).toBeUndefined(); // margin_length 0 before Final = unknown
    expect(race.runners.find((r) => r.name === 'Moon God')!).toMatchObject({ finishingPosition: 3, claim: 1.5, weight: 54, sex: 'Filly' });
    expect(race.runners.find((r) => r.name === 'Hegely')!.finishingPosition).toBe(4);
    expect(race.runners.find((r) => r.name === "Charlotte's Web")!).toMatchObject({ number: 1, speedMapPosition: 'backmarker', last5: '375x', sex: 'Mare' });
    expect(race.runners.filter((r) => r.finishingPosition == null)).toHaveLength(7);

    const brookelinda = race.runners.find((r) => r.name === 'Brookelinda')!;
    expect(brookelinda.scratched).toBe(true);
    expect(brookelinda.odds).toBeUndefined();
    expect(race.runners.find((r) => r.name === 'Flash Inquiry')!.scratched).toBe(true);
    expect(race.runners.filter((r) => r.scratched)).toHaveLength(2);
  });

  it('fetchResults: null for an open race, placings for an interim race, dividends when the feed has them', async () => {
    const ctx = ctxFor(routes);
    expect(await en.fetchResults(cranbourne, 7, ctx)).toBeNull();

    const interim = await en.fetchResults(ballarat, 1, ctx);
    expect(interim).not.toBeNull();
    expect(interim!.placings).toEqual([[10], [4], [9], [3]]);
    expect(interim!.margins).toBeUndefined();
    expect(interim!.dividends).toBeUndefined();
    expect(interim!.source).toBe('entain');
    expect(interim!.raceNumber).toBe(1);
    expect(interim!.recordedAt).toBe('2026-10-23T02:00:00.000Z');

    const flem = meeting('Flemington', '2026-10-24', `c1eb9968-e932-5b14-a0f8-d159722d5017|1:${FLEMINGTON_R1}`);
    const final = await en.fetchResults(flem, 1, ctx);
    expect(final!.placings).toEqual([[3], [1], [5], [2]]);
    expect(final!.margins).toEqual([0, 1.25, 1.75, 3.5]);
    expect(final!.dividends).toEqual({ win: 2.9, place1: 1.3, place2: 1.5, place3: 2.2, exacta: 11.2, quinella: 6.4, trifecta: 54.6, first4: 318.4 });
    // Another jurisdiction picks that tote's dividends.
    const nsw = await en.fetchResults(flem, 1, harness(routes, { jurisdiction: 'NSW' }).ctx);
    expect(nsw!.dividends!.win).toBe(3);
    expect(nsw!.dividends!.first4).toBe(331);
  });

  it('refuses a payload for a different race number or event id', async () => {
    const wrongNumber = meeting('Cranbourne', '2026-10-23', `e8b3a22d-b111-5448-9334-7ec9fcd51975|6:${CRANBOURNE_R7}`);
    await expect(en.fetchRace(wrongNumber, 6, ctxFor(routes))).rejects.toThrow(/returned race 7 when 6/);
    const wrongId = meeting('Cranbourne', '2026-10-23', `e8b3a22d-b111-5448-9334-7ec9fcd51975|7:${WRONG_ID}`);
    await expect(en.fetchRace(wrongId, 7, ctxFor(routes))).rejects.toThrow(new RegExp(`returned event ${CRANBOURNE_R7}`));
  });

  it('skips a race that 404s (or carries an envelope error) without falling over to the other host', async () => {
    const h = harness(routes);
    const m = await en.fetchMeeting(meeting('Cranbourne', '2026-10-23', `e8b3a22d-b111-5448-9334-7ec9fcd51975|7:${CRANBOURNE_R7},8:${MISSING},9:${ENVELOPE_ERROR}`), h.ctx);
    expect(m.races.map((r) => r.number)).toEqual([7]);
    expect(h.log.warnings).toHaveLength(2);
    expect(h.log.warnings[0]).toMatch(/race 8 failed: HTTP 404/);
    expect(h.log.warnings[1]).toMatch(/race 9 failed: Entain: event not found/);
    expect(h.urls.every((u) => u.startsWith('https://api.ladbrokes.com.au/'))).toBe(true);
    expect(h.urls).toHaveLength(3);
  });

  it('falls over to api-affiliates when the primary host fails at the transport level, then sticks to it', async () => {
    const adapter = new EntainAdapter(0);
    const h = harness(routes, { failHost: /^https:\/\/api\.ladbrokes\.com\.au\// });
    const meetings = await adapter.listMeetings('2026-10-24', h.ctx);
    expect(meetings).toHaveLength(2);
    expect(h.urls.some((u) => u.startsWith('https://api.ladbrokes.com.au/affiliates/v1/racing/meetings?enc=json'))).toBe(true);
    expect(h.urls[h.urls.length - 1]).toMatch(/^https:\/\/api-affiliates\.ladbrokes\.com\.au\/affiliates\/v1\/racing\/meetings\?enc=json/);
    expect(h.log.warnings.some((w) => /api\.ladbrokes\.com\.au failed .*trying api-affiliates/.test(w))).toBe(true);
    // The next call goes straight to the fallback host.
    const before = h.urls.length;
    const race = await adapter.fetchRace(cranbourne, 7, h.ctx);
    expect(race.runners).toHaveLength(13);
    expect(h.urls.slice(before)).toEqual([`https://api-affiliates.ladbrokes.com.au/affiliates/v1/racing/events/${CRANBOURNE_R7}?enc=json`]);
  });

  it('resolves refs through listMeetings when a meeting summary carries none', async () => {
    const h = harness(routes);
    const bare: MeetingSummary = { id: '2026-10-24:flemington', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', raceType: 'thoroughbred', sourceRefs: {}, sources: [] };
    const race = await en.fetchRace(bare, 1, h.ctx);
    expect(race.status).toBe('final');
    expect(race.name).toBe('Carbine Club 3yo Mdn Plate');
    await expect(en.fetchRace(bare, 2, h.ctx)).rejects.toThrow(/HTTP 404/);
    await expect(en.fetchRace({ ...bare, venue: 'Nowhere', venueSlug: 'nowhere' }, 1, h.ctx)).rejects.toThrow(/no meeting matching Nowhere/);
  });

  it('helpers: race name splitting and speed-map labels', () => {
    expect(splitRaceName('Ladbrokes Cox Plate @ Flemington (Bm70) Hcp')).toEqual({ name: 'Ladbrokes Cox Plate @ Flemington', raceClass: 'BM70 Hcp' });
    expect(splitRaceName('Members Lounge Fillies & Mares (Bm78) Hcp')).toEqual({ name: 'Members Lounge Fillies & Mares', raceClass: 'BM78 Hcp' });
    expect(splitRaceName('Epijoint F&M Mdn Plate')).toEqual({ name: 'Epijoint F&M Mdn Plate' });
    expect(splitRaceName('Cox Plate (Group 1)')).toEqual({ name: 'Cox Plate', raceClass: 'Group 1' });
    expect(splitRaceName('(Bm64) Hcp')).toEqual({ name: '(Bm64) Hcp' });
    expect(speedMap('Leader')).toBe('leader');
    expect(speedMap('Front Runner')).toBe('leader');
    expect(speedMap('On Pace')).toBe('on-pace');
    expect(speedMap('Off Pace')).toBe('on-pace');
    expect(speedMap('Midfield')).toBe('midfield');
    expect(speedMap('Off Midfield')).toBe('midfield');
    expect(speedMap('Back Marker')).toBe('backmarker');
    expect(speedMap('Backmarker')).toBe('backmarker');
    expect(speedMap('invalid settling lengths')).toBeUndefined();
    expect(speedMap(undefined)).toBeUndefined();
  });

  it('survives a payload with everything missing', async () => {
    const h = harness([[/\/events\/empty\?enc=json$/, '{"header":{},"data":{"race":{"event_id":"empty","race_number":3},"runners":[{"name":"Lonely"},{"name":"Odds"},{}]}}']]);
    const race = await en.fetchRace(meeting('Nowhere', '2026-10-23', 'm|3:empty'), 3, h.ctx);
    expect(race.status).toBe('unknown');
    expect(race.name).toBe('Race 3');
    expect(race.distance).toBe(0);
    expect(race.runners).toHaveLength(1);
    expect(race.runners[0]).toMatchObject({ name: 'Lonely', scratched: false });
    expect(race.runners[0].odds).toBeUndefined();
    expect(vi.isMockFunction(h.ctx.log.warn)).toBe(false);
  });
});
