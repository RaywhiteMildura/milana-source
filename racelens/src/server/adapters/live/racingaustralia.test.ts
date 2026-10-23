import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HttpClient } from '../../core/http.js';
import { silentLogger } from '../../core/logger.js';
import type { FetchContext } from '../types.js';
import type { MeetingSummary } from '../../../shared/types.js';
import {
  RacingAustraliaAdapter,
  buildKey,
  canonicalVenue,
  classifyPage,
  localTimeToIso,
  meetingKey,
  parseCalendar,
  parseKey,
  parseResultsPage,
  stateUtcOffset,
} from './racingaustralia.js';

const fx = (name: string) => fs.readFileSync(path.resolve('fixtures/racingaustralia', name), 'utf8');

type Route = [RegExp, string | { body: string; status?: number }];

/** Fixture router: unmatched URLs get an HTML 404 (a transport failure for the adapter). */
function harness(routes: Route[], now = '2026-10-24T00:00:00.000Z') {
  const hits: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    hits.push(url);
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response('<html><body><h1>404 Not Found</h1></body></html>', { status: 404, headers: { 'content-type': 'text/html' } });
    const body = typeof hit[1] === 'string' ? hit[1] : hit[1].body;
    const status = typeof hit[1] === 'string' ? 200 : (hit[1].status ?? 200);
    return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  const ctx: FetchContext = { http: new HttpClient({ fetchImpl, cacheTtlMs: 0, perHostDelayMs: 0 }), log: silentLogger, now: () => new Date(now), jurisdiction: 'VIC' };
  return { ctx, hits };
}

const PRIMARY = /^https:\/\/www\.racingaustralia\.horse\/FreeFields\//;
const NSW_MIRROR = /^https:\/\/racing\.racingnsw\.com\.au\/FreeFields\//;

const meeting = (over: Partial<MeetingSummary> & Pick<MeetingSummary, 'date' | 'venue'>): MeetingSummary => ({
  id: `${over.date}:${over.venue.toLowerCase().replace(/\s+/g, '-')}`,
  venueSlug: over.venue.toLowerCase().replace(/\s+/g, '-'),
  raceType: 'thoroughbred',
  sourceRefs: {},
  sources: [],
  ...over,
});

const CAULFIELD = meeting({ date: '2025-10-18', venue: 'Caulfield', state: 'VIC', sourceRefs: { racingaustralia: '2025Oct18,VIC,Caulfield' } });
const FLEM = meeting({ date: '2026-10-24', venue: 'Flemington', state: 'VIC', sourceRefs: { racingaustralia: '2026Oct24,VIC,Flemington' } });
const TAREE = meeting({ date: '2026-07-21', venue: 'Taree', state: 'NSW', sourceRefs: { racingaustralia: '2026Jul21,NSW,Taree' } });

const RESULTS_ROUTE: Route = [/^https:\/\/www\.racingaustralia\.horse\/FreeFields\/Results\.aspx\?Key=2025Oct18%2CVIC%2CCaulfield$/, fx('results_REAL_caulfield_2025-10-18.html')];
const FORM_ROUTE: Route = [/^https:\/\/www\.racingaustralia\.horse\/FreeFields\/Form\.aspx\?Key=2026Oct24%2CVIC%2CFlemington$/, fx('form_flemington_2026-10-24.html')];

describe('RacingAustraliaAdapter', () => {
  const ra = new RacingAustraliaAdapter(0);

  it('declares itself as the official source', () => {
    expect(ra.id).toBe('racingaustralia');
    expect(ra.name).toBe('Racing Australia (official fields)');
    expect(ra.kind).toBe('official');
    expect(ra.capabilities).toEqual(['meetings', 'racecard', 'form', 'results', 'conditions']);
  });

  describe('key grammar', () => {
    it('builds YYYYMonDD,STATE,Venue keys with RA venue spelling kept intact', () => {
      expect(buildKey('2026-10-24', 'VIC', 'Flemington')).toBe('2026Oct24,VIC,Flemington');
      expect(buildKey('2026-10-24', 'nsw', 'Royal Randwick')).toBe('2026Oct24,NSW,Royal Randwick');
      expect(buildKey('2026-01-05', 'QLD', 'Sunshine Coast')).toBe('2026Jan05,QLD,Sunshine Coast');
      expect(() => buildKey('24/10/2026', 'VIC', 'Flemington')).toThrow();
    });

    it('derives the state from the venue table when the meeting has none', () => {
      expect(meetingKey(meeting({ date: '2026-10-24', venue: 'Randwick' }))).toBe('2026Oct24,NSW,Randwick');
      expect(meetingKey(meeting({ date: '2026-10-24', venue: 'Eagle Farm' }))).toBe('2026Oct24,QLD,Eagle Farm');
      expect(meetingKey(FLEM)).toBe('2026Oct24,VIC,Flemington'); // recorded sourceRef wins
      expect(() => meetingKey(meeting({ date: '2026-10-24', venue: 'Nowhere Downs' }))).toThrow(/state/);
    });

    it('decodes calendar keys, URL-encoded or not', () => {
      expect(parseKey('2026Oct24%2CVIC%2CSportsbet-Ballarat')).toEqual({ date: '2026-10-24', state: 'VIC', venue: 'Sportsbet-Ballarat', variant: undefined, key: '2026Oct24,VIC,Sportsbet-Ballarat' });
      expect(parseKey('2026Oct25%2CVIC%2CSportsbet+Sandown+Hillside')!.venue).toBe('Sportsbet Sandown Hillside');
      expect(parseKey('2026Jul21,NSW,Warren,Trial')).toMatchObject({ date: '2026-07-21', state: 'NSW', venue: 'Warren', variant: 'Trial' });
      expect(parseKey('BodyClass=PrintFriendly')).toBeUndefined();
    });

    it('maps RA sponsored venue names onto canonical venues', () => {
      expect(canonicalVenue('Sportsbet-Ballarat')).toBe('Ballarat');
      expect(canonicalVenue('Ladbrokes Geelong')).toBe('Geelong');
      expect(canonicalVenue('The Valley')).toBe('Moonee Valley');
      expect(canonicalVenue('Royal Randwick')).toBe('Randwick');
      expect(canonicalVenue('Sportsbet Sandown Hillside')).toBe('Sandown');
      expect(canonicalVenue('Canberra Acton')).toBe('Canberra Acton');
    });
  });

  describe('local time → ISO', () => {
    it('uses the state UTC offset for the race day (DST aware)', () => {
      expect(stateUtcOffset('VIC', '2026-10-24')).toBe('+11:00');
      expect(stateUtcOffset('NSW', '2026-10-24')).toBe('+11:00');
      expect(stateUtcOffset('VIC', '2026-06-20')).toBe('+10:00');
      expect(stateUtcOffset('QLD', '2026-10-24')).toBe('+10:00');
      expect(stateUtcOffset('SA', '2026-10-24')).toBe('+10:30');
      expect(stateUtcOffset('WA', '2026-10-24')).toBe('+08:00');
      expect(stateUtcOffset('NT', '2026-10-24')).toBe('+09:30');
    });

    it('combines the meeting date with the printed local time', () => {
      expect(localTimeToIso('2026-10-24', '12:40PM', 'VIC')).toBe('2026-10-24T01:40:00.000Z');
      expect(localTimeToIso('2026-10-24', '3:45PM', 'QLD')).toBe('2026-10-24T05:45:00.000Z');
      expect(localTimeToIso('2026-10-24', '11:55 am', 'WA')).toBe('2026-10-24T03:55:00.000Z');
      expect(localTimeToIso('2026-10-24', '13:30', 'VIC')).toBe('2026-10-24T02:30:00.000Z');
      expect(localTimeToIso('2026-10-24', 'TBA', 'VIC')).toBeUndefined();
    });
  });

  describe('page classification', () => {
    it('recognises bot walls, unpublished stages and empty bodies', () => {
      expect(classifyPage(fx('botwall.html'))).toBe('bot-wall');
      expect(classifyPage(fx('not_available.html'))).toBe('not-available');
      expect(classifyPage('<html></html>')).toBe('empty');
      expect(classifyPage(fx('form_flemington_2026-10-24.html'))).toBeUndefined();
      expect(classifyPage(fx('results_REAL_caulfield_2025-10-18.html'))).toBeUndefined();
      expect(classifyPage(fx('ozracing_acceptances_taree_2026-07-21.html'))).toBeUndefined();
    });
  });

  describe('Results.aspx (REAL Caulfield 2025-10-18 capture)', () => {
    it('reads every placing, cumulative margin and the winning time of race 7', async () => {
      const { ctx, hits } = harness([RESULTS_ROUTE]);
      const res = await ra.fetchResults(CAULFIELD, 7, ctx);
      expect(res).not.toBeNull();
      expect(res!.source).toBe('racingaustralia');
      expect(res!.raceNumber).toBe(7);
      expect(res!.placings).toEqual([[3], [1], [4], [6], [12], [2], [8], [9], [7], [5], [11], [10]]);
      expect(res!.margins).toEqual([0, 0.35, 1.1, 2.85, 3.25, 3.4, 6.65, 6.9, 7.65, 9.15, 10.15, 10.21]);
      expect(res!.time).toBe('1:37.83');
      expect(res!.dividends).toBeUndefined(); // RA prints starting prices, not tote dividends
      expect(hits).toHaveLength(1);
      expect(hits[0]).toBe('https://www.racingaustralia.horse/FreeFields/Results.aspx?Key=2025Oct18%2CVIC%2CCaulfield');
    });

    it('returns null for a race that is not on the page, reusing the cached page', async () => {
      const { ctx, hits } = harness([RESULTS_ROUTE]);
      const adapter = new RacingAustraliaAdapter(0);
      expect(await adapter.fetchResults(CAULFIELD, 7, ctx)).not.toBeNull();
      expect(await adapter.fetchResults(CAULFIELD, 1, ctx)).toBeNull();
      expect(await adapter.fetchResults(CAULFIELD, 8, ctx)).toBeNull();
      expect(hits).toHaveLength(1);
    });

    it('returns null (not an error) while the results stage is unpublished', async () => {
      const { ctx, hits } = harness([[/Results\.aspx/, fx('not_available.html')]]);
      expect(await new RacingAustraliaAdapter(0).fetchResults(CAULFIELD, 7, ctx)).toBeNull();
      expect(hits).toHaveLength(3); // every mirror was asked
    });

    it('exposes the row-level detail of the real results table', () => {
      const races = parseResultsPage(fx('results_REAL_caulfield_2025-10-18.html'));
      expect([...races.keys()]).toEqual([7]);
      const r7 = races.get(7)!;
      expect(r7).toMatchObject({ name: 'Schweppes Thousand Guineas', distance: 1600, time: '1:37.83', last600: '0:34.95' });
      expect(r7.condition).toEqual({ text: 'Good 4', rating: 4 });
      expect(r7.rows).toHaveLength(12);
      expect(r7.rows[0]).toMatchObject({ finish: 1, number: 3, name: 'Ole Dancer', trainer: 'Peter G Moody & Katherine Coleman', jockey: 'Blake Shinn', barrier: 5, weight: 56, sp: 5, scratched: false });
      expect(r7.rows[0].silk).toBe('https://www.racingaustralia.horse/JockeySilks/64092.png');
      expect(r7.rows[1]).toMatchObject({ finish: 2, number: 1, name: 'Apocalyptic', margin: 0.35, sp: 1.9, jockey: 'Mark Zahra' });
      expect(r7.rows[4]).toMatchObject({ finish: 5, number: 12, name: 'Mating Call', jockey: 'Ms Jamie Melham', trainer: 'Dan Clarken & Oopy MacGillivray' });
      expect(r7.rows[10]).toMatchObject({ finish: 11, number: 11, name: 'Chateau Eze', country: 'GB', margin: 10.15, sp: 18 });
    });
  });

  describe('Form.aspx (constructed Flemington 2026-10-24 fixture)', () => {
    it('parses the meeting header, every race and the full runner mapping', async () => {
      const { ctx, hits } = harness([FORM_ROUTE]);
      const adapter = new RacingAustraliaAdapter(0);
      const m = await adapter.fetchMeeting(FLEM, ctx);
      expect(hits).toHaveLength(1);
      expect(m.source).toBe('racingaustralia');
      expect(m.meeting).toMatchObject({ venue: 'Flemington', state: 'VIC', trackCondition: 'Good 4', trackRating: 4, rail: 'True Entire Circuit', weather: 'Fine', raceCount: 2, firstRaceTime: '2026-10-24T01:40:00.000Z' });
      expect(m.meeting.sourceRefs.racingaustralia).toBe('2026Oct24,VIC,Flemington');
      expect(m.races).toHaveLength(2);

      const r1 = m.races[0];
      expect(r1).toMatchObject({ number: 1, name: 'Maribyrnong Trial Stakes', distance: 1000, startTime: '2026-10-24T01:40:00.000Z', prize: 200000, group: 'Listed', ageRestriction: '2YO', raceClass: 'Set Weights, Two-Years-Old', trackCondition: 'Good 4', trackRating: 4, status: 'open' });
      expect(r1.sourceRefs.racingaustralia).toBe('2026Oct24,VIC,Flemington#Race1');
      expect(r1.runners.map((r) => r.number)).toEqual([1, 3, 6]);
      const trueLine = r1.runners[0];
      expect(trueLine).toMatchObject({ number: 1, name: 'True Line', barrier: 4, jockey: 'Jamie Kah', trainer: 'Ciaron Maher', weight: 58, scratched: false, last5: '11', age: 2, sex: 'Colt', colour: 'bay', sire: 'Snitzel', dam: 'Straight Line', damSire: "Redoute's Choice" });
      expect(trueLine.claim).toBeUndefined();
      expect(trueLine.gearChanges).toEqual(['Blinkers first time']);
      expect(trueLine.career).toEqual({ starts: 4, wins: 3, seconds: 1, thirds: 0, prizeMoney: 212400 });
      expect(trueLine.ratings).toEqual({ 'racingaustralia.hcpRating': 92 });
      expect(trueLine.silk).toBe('https://racingaustralia.horse/JockeySilks/64092.png');
      // The barrier trial row ("T 1 of 6") is not race form.
      expect(trueLine.form).toHaveLength(3);
      expect(trueLine.form![0]).toEqual({
        date: '2026-10-10',
        venue: 'Caulfield',
        distance: 1000,
        trackCondition: 'Good 4',
        trackRating: 4,
        position: 1,
        starters: 9,
        margin: 0,
        weight: 57,
        barrier: 2,
        jockey: 'Jamie Kah',
        raceClass: '2YO SW',
        prize: 150000,
        startingPrice: 2.1,
        time: '0:57.45',
        sectional600: '33.80',
        winner: 'True Line',
        second: 'Rail Runner',
        inRunning: '3-1',
        source: 'racingaustralia',
      });
      expect(trueLine.form![2]).toMatchObject({ date: '2026-08-29', venue: 'Moonee Valley', trackCondition: 'Soft 5', trackRating: 5, position: 2, starters: 8, margin: 0.3, jockey: 'Mark Zahra', startingPrice: 4, winner: 'Quick Start', second: 'True Line', inRunning: '4-3' });
      expect(trueLine.daysSinceLastRun).toBe(14);
      const golden = r1.runners[1];
      expect(golden).toMatchObject({ number: 3, name: 'Golden Straight', sex: 'Filly', colour: 'chestnut', sire: 'I Am Invincible', dam: 'Golden Mile', damSire: 'Lonhro', last5: 'x21' });
      expect(golden.gearChanges).toBeUndefined(); // "Gear Changes: Nil"
      const scratched = r1.runners[2];
      expect(scratched).toMatchObject({ number: 6, name: 'Missing Entry', scratched: true, jockey: 'Blake Shinn' });

      const r2 = m.races[1];
      expect(r2).toMatchObject({ number: 2, name: 'Ascot Vale Plate', distance: 1200, startTime: '2026-10-24T02:15:00.000Z', prize: 150000, raceClass: 'BM78, Handicap' });
      expect(r2.group).toBeUndefined();
      const vale = r2.runners.find((r) => r.name === 'Vale View')!;
      expect(vale).toMatchObject({ number: 2, barrier: 11, jockey: 'Celine Gaudray', claim: 2, trainer: 'Phillip Stokes', weight: 59.5, scratched: false, last5: 'x5631', age: 4, sex: 'Mare', colour: 'grey', sire: 'Toorak Toff', dam: 'Valley Vista', damSire: 'Galileo' });
      expect(vale.career).toEqual({ starts: 13, wins: 4, seconds: 3, thirds: 1, prizeMoney: 241900 });
      expect(vale.splits).toMatchObject({
        firstUp: { starts: 3, wins: 1, seconds: 1, thirds: 0 },
        secondUp: { starts: 3, wins: 1, seconds: 0, thirds: 1 },
        track: { starts: 2, wins: 0, seconds: 1, thirds: 0 },
        distance: { starts: 6, wins: 2, seconds: 1, thirds: 1 },
        trackDistance: { starts: 1, wins: 0, seconds: 1, thirds: 0 },
        firm: { starts: 0, wins: 0, seconds: 0, thirds: 0 },
        good: { starts: 9, wins: 3, seconds: 2, thirds: 1 },
        soft: { starts: 4, wins: 1, seconds: 1, thirds: 0 },
        heavy: { starts: 0, wins: 0, seconds: 0, thirds: 0 },
        synthetic: { starts: 0, wins: 0, seconds: 0, thirds: 0 },
      });
      expect(vale.gearChanges).toEqual(['Cross-over nose band first time']);
      expect(vale.ratings).toEqual({ 'racingaustralia.hcpRating': 81 });
      expect(vale.form).toHaveLength(1);
      expect(vale.form![0]).toMatchObject({ date: '2026-10-08', venue: 'Pakenham', distance: 1200, position: 1, starters: 9, margin: 0, weight: 58, barrier: 3, jockey: 'Celine Gaudray', raceClass: 'BM70', prize: 50000, startingPrice: 2.8, time: '1:10.90', sectional600: '34.20', winner: 'Vale View', second: 'Pakenham Pride', inRunning: '1-1' });
      expect(vale.daysSinceLastRun).toBe(16);
      const river = r2.runners.find((r) => r.number === 4)!;
      expect(river).toMatchObject({ name: 'River Bend', country: 'NZ', trainer: "Danny O'Brien", jockey: 'Harry Coffey', last5: 'x4421', sire: 'Savabeel', damSire: 'Zabeel' });
      expect(river.form!.map((f) => f.venue)).toEqual(['Bendigo', 'Geelong']);
      expect(river.form![1]).toMatchObject({ trackCondition: 'Soft 7', trackRating: 7, position: 2, margin: 0.2, startingPrice: 5.5 });
    });

    it('serves fetchForm / fetchRace from the cached Form page without refetching', async () => {
      const { ctx, hits } = harness([FORM_ROUTE]);
      const adapter = new RacingAustraliaAdapter(0);
      await adapter.fetchMeeting(FLEM, ctx);
      const runners = await adapter.fetchForm(FLEM, 2, ctx);
      expect(runners).toHaveLength(3);
      expect(runners.every((r) => r.form && r.form.length > 0)).toBe(true);
      const race = await adapter.fetchRace(FLEM, 1, ctx);
      expect(race.number).toBe(1);
      expect(hits).toHaveLength(1);
      await expect(adapter.fetchForm(FLEM, 9, ctx)).rejects.toThrow(/race 9 not found/);
    });

    it('refetches once the page cache has expired', async () => {
      let now = new Date('2026-10-24T00:00:00.000Z');
      const { ctx, hits } = harness([FORM_ROUTE]);
      ctx.now = () => now;
      const adapter = new RacingAustraliaAdapter({ delayMs: 0, pageCacheMs: 5 * 60_000 });
      await adapter.fetchMeeting(FLEM, ctx);
      now = new Date('2026-10-24T00:04:00.000Z');
      await adapter.fetchMeeting(FLEM, ctx);
      expect(hits).toHaveLength(1);
      now = new Date('2026-10-24T00:06:00.000Z');
      await adapter.fetchMeeting(FLEM, ctx);
      expect(hits).toHaveLength(2);
    });
  });

  describe('identity checks', () => {
    it('refuses a page for a different venue', async () => {
      const wrong = meeting({ date: '2026-10-24', venue: 'Caulfield', state: 'VIC', sourceRefs: { racingaustralia: '2026Oct24,VIC,Caulfield' } });
      const { ctx } = harness([[/Form\.aspx/, fx('form_flemington_2026-10-24.html')]]);
      await expect(new RacingAustraliaAdapter(0).fetchMeeting(wrong, ctx)).rejects.toThrow(/returned "Flemington: Victoria Racing Club" when Caulfield/);
    });

    it('refuses a page for a different date', async () => {
      const wrong = meeting({ date: '2026-10-25', venue: 'Flemington', state: 'VIC', sourceRefs: { racingaustralia: '2026Oct25,VIC,Flemington' } });
      const { ctx } = harness([[/Form\.aspx/, fx('form_flemington_2026-10-24.html')]]);
      await expect(new RacingAustraliaAdapter(0).fetchMeeting(wrong, ctx)).rejects.toThrow(/returned 2026-10-24 .* when 2026-10-25/);
    });

    it('accepts a sponsored header for a canonical venue request', async () => {
      const header = fx('form_flemington_2026-10-24.html').replace('Flemington: Victoria Racing Club', 'Sportsbet-Flemington: Victoria Racing Club');
      const { ctx } = harness([[/Form\.aspx/, header]]);
      const m = await new RacingAustraliaAdapter(0).fetchMeeting(FLEM, ctx);
      expect(m.races).toHaveLength(2);
    });
  });

  describe('host fallback', () => {
    it('moves to the Racing NSW mirror when the primary host serves a bot wall', async () => {
      const { ctx, hits } = harness([
        [/^https:\/\/www\.racingaustralia\.horse\/FreeFields\/Form\.aspx/, fx('botwall.html')],
        [/^https:\/\/racing\.racingnsw\.com\.au\/FreeFields\/Form\.aspx\?Key=2026Oct24%2CVIC%2CFlemington$/, fx('form_flemington_2026-10-24.html')],
      ]);
      const m = await new RacingAustraliaAdapter(0).fetchMeeting(FLEM, ctx);
      expect(m.races).toHaveLength(2);
      expect(hits).toHaveLength(2);
      expect(hits[0]).toMatch(PRIMARY);
      expect(hits[1]).toMatch(NSW_MIRROR);
    });

    it('falls through to the mdata mirror on transport errors', async () => {
      const { ctx, hits } = harness([[/^https:\/\/mdata\.racingnsw\.com\.au\/FreeFields\/Results\.aspx/, fx('results_REAL_caulfield_2025-10-18.html')]]);
      const res = await new RacingAustraliaAdapter(0).fetchResults(CAULFIELD, 7, ctx);
      expect(res!.placings[0]).toEqual([3]);
      expect(hits).toHaveLength(3);
      expect(hits[2]).toMatch(/^https:\/\/mdata\.racingnsw\.com\.au\//);
    });

    it('throws when every host serves a bot wall so the outage is recorded', async () => {
      const { ctx, hits } = harness([[/Form\.aspx/, fx('botwall.html')]]);
      await expect(new RacingAustraliaAdapter(0).fetchMeeting(FLEM, ctx)).rejects.toThrow(/Form\.aspx unavailable on all hosts .*bot wall/);
      expect(hits).toHaveLength(3);
    });

    it('throws when every host is down', async () => {
      const { ctx, hits } = harness([]);
      await expect(new RacingAustraliaAdapter(0).fetchResults(CAULFIELD, 7, ctx)).rejects.toThrow(/unavailable on all hosts .*HTTP 404/);
      expect(hits).toHaveLength(3);
    });

    it('respects a custom host list', async () => {
      const { ctx, hits } = harness([[/^https:\/\/m\.racingaustralia\.horse\/FreeFields\/Form\.aspx/, fx('form_flemington_2026-10-24.html')]]);
      const adapter = new RacingAustraliaAdapter({ delayMs: 0, hosts: ['https://m.racingaustralia.horse/FreeFields'] });
      expect((await adapter.fetchMeeting(FLEM, ctx)).races).toHaveLength(2);
      expect(hits).toEqual(['https://m.racingaustralia.horse/FreeFields/Form.aspx?Key=2026Oct24%2CVIC%2CFlemington']);
    });
  });

  describe('stage fallbacks when Form.aspx is unpublished', () => {
    it('uses the styled Acceptances.aspx table (constructed fixture)', async () => {
      const { ctx, hits } = harness([
        [/\/FreeFields\/Form\.aspx/, fx('not_available.html')],
        [/^https:\/\/www\.racingaustralia\.horse\/FreeFields\/Acceptances\.aspx\?Key=2026Oct24%2CVIC%2CFlemington$/, fx('acceptances_flemington_2026-10-24.html')],
      ]);
      const m = await new RacingAustraliaAdapter(0).fetchMeeting(FLEM, ctx);
      expect(hits).toHaveLength(4); // 3 × Form (not available on each mirror) + 1 × Acceptances
      expect(m.meeting).toMatchObject({ trackCondition: 'Good 4', rail: 'True Entire Circuit', raceCount: 2 });
      expect(m.races).toHaveLength(2);
      const r1 = m.races[0];
      expect(r1).toMatchObject({ number: 1, name: 'Maribyrnong Trial Stakes', distance: 1000, startTime: '2026-10-24T01:40:00.000Z', prize: 200000, group: 'Listed' });
      expect(r1.runners.map((r) => r.number)).toEqual([1, 3, 6, 9]);
      expect(r1.runners[0]).toMatchObject({ name: 'True Line', barrier: 4, jockey: 'Jamie Kah', trainer: 'Ciaron Maher', weight: 58, last5: '11', scratched: false });
      expect(r1.runners[0].form).toBeUndefined();
      expect(r1.runners[2]).toMatchObject({ number: 6, name: 'Missing Entry', scratched: true });
      expect(r1.runners[3]).toMatchObject({ number: 9, name: 'First Emergency', emergency: true, jockey: 'Ms Jamie Melham', last5: '3528x' });
      const vale = m.races[1].runners.find((r) => r.number === 2)!;
      expect(vale).toMatchObject({ name: 'Vale View', jockey: 'Celine Gaudray', claim: 2, weight: 59.5, barrier: 11, last5: 'x5631' });
      expect(vale.ratings).toEqual({ 'racingaustralia.hcpRating': 81 });
    });

    it('uses the bare /ozracing/Acceptances.aspx page as a last resort (developer transcription fixture)', async () => {
      const { ctx, hits } = harness([
        [/\/FreeFields\/(?:Form|Acceptances)\.aspx/, fx('not_available.html')],
        [/^https:\/\/www\.racingaustralia\.horse\/ozracing\/Acceptances\.aspx\?key=2026Jul21%2CNSW%2CTaree$/, fx('ozracing_acceptances_taree_2026-07-21.html')],
      ]);
      const m = await new RacingAustraliaAdapter(0).fetchMeeting(TAREE, ctx);
      expect(hits).toHaveLength(7);
      expect(m.meeting.rail).toBe('+3m Entire');
      expect(m.races).toHaveLength(2);
      const r1 = m.races[0];
      // "1-12.55" is a 12-hour clock without AM/PM: 12:55 is PM; Taree in July is AEST (+10:00).
      expect(r1).toMatchObject({ number: 1, name: 'Congratulations Taree Trainers Class 1 & Maiden Plate', distance: 2018, startTime: '2026-07-21T02:55:00.000Z', prize: 27000 });
      expect(r1.raceClass).toMatch(/CLASS 1/);
      expect(r1.runners).toHaveLength(2);
      expect(r1.runners[0]).toMatchObject({ number: 1, name: 'Hardash', trainer: 'Peter Cheers', jockey: 'Raymond Spokes', barrier: 7, weight: 59, scratched: false });
      expect(r1.runners[0].ratings).toEqual({ 'racingaustralia.hcpRating': 41 });
      expect(r1.runners[1]).toMatchObject({ number: 2, name: 'Lone Star Dream', weight: 58.5, barrier: 6 });
      expect(m.races[1]).toMatchObject({ number: 2, name: 'Second Race', distance: 1200, startTime: '2026-07-21T03:30:00.000Z' });
      expect(m.races[1].runners[0]).toMatchObject({ number: 1, name: 'Rebel One' });
    });

    it('throws when no stage is published anywhere', async () => {
      const { ctx, hits } = harness([[/Acceptances\.aspx|Form\.aspx/, fx('not_available.html')]]);
      await expect(new RacingAustraliaAdapter(0).fetchMeeting(FLEM, ctx)).rejects.toThrow(/not currently available/);
      expect(hits).toHaveLength(9);
    });
  });

  describe('calendar', () => {
    it('lists the meetings of a date from the by-date calendar (constructed fixture)', async () => {
      const { ctx, hits } = harness([[/\/FreeFields\/Calendar\.aspx\?Date=2026Oct24$/, fx('calendar_VIC.html')]]);
      const list = await ra.listMeetings('2026-10-24', ctx);
      expect(hits).toHaveLength(1);
      expect(list).toHaveLength(2); // the Cranbourne barrier trials are not a race meeting
      expect(list[0]).toMatchObject({ id: '2026-10-24:flemington', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', state: 'VIC', country: 'AUS', raceType: 'thoroughbred', sources: ['racingaustralia'] });
      expect(list[0].sourceRefs).toEqual({ racingaustralia: '2026Oct24,VIC,Flemington', 'racingaustralia.stage': 'Form' });
      expect(list[1]).toMatchObject({ venue: 'Ballarat', venueSlug: 'ballarat' });
      expect(list[1].sourceRefs.racingaustralia).toBe('2026Oct24,VIC,Sportsbet-Ballarat');
    });

    it('keeps RA spelling in the key while canonicalising the venue', async () => {
      const { ctx } = harness([[/Calendar\.aspx\?Date=2026Oct25$/, fx('calendar_VIC.html')]]);
      const list = await ra.listMeetings('2026-10-25', ctx);
      expect(list.map((m) => m.venue)).toEqual(['Bendigo', 'Sandown']);
      expect(list[1].sourceRefs).toEqual({ racingaustralia: '2026Oct25,VIC,Sportsbet Sandown Hillside', 'racingaustralia.stage': 'Weights' });
      expect(list[0].sourceRefs['racingaustralia.stage']).toBe('Acceptances');
    });

    it('falls back to the per-state calendars and returns [] when the date has no meetings', async () => {
      const { ctx, hits } = harness([[/Calendar\.aspx/, fx('calendar_VIC.html')]]);
      expect(await ra.listMeetings('2026-12-25', ctx)).toEqual([]);
      expect(hits).toHaveLength(9); // Date page + 8 states
      expect(hits.slice(1).map((u) => new URL(u).searchParams.get('State'))).toEqual(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']);
    });

    it('throws only when every calendar request failed', async () => {
      const { ctx } = harness([]);
      await expect(ra.listMeetings('2026-10-24', ctx)).rejects.toThrow(/calendar unavailable/);
      expect(await ra.listMeetings('not-a-date', ctx)).toEqual([]);
    });

    it('parses the stage links and prefers the most advanced stage per meeting', () => {
      const entries = parseCalendar(fx('calendar_VIC.html'));
      expect(entries.map((e) => e.key)).toContain('2026Nov01,VIC,Hanging Rock,Picnic');
      expect(entries.find((e) => e.venue === 'Flemington' && e.date === '2026-10-24')!.stage).toBe('Form');
      expect(entries.find((e) => e.venue === 'Ladbrokes Geelong')!.stage).toBe('Results');
      expect(entries.find((e) => e.variant === 'Trial')!.venue).toBe('Southside Cranbourne');
    });

    it('looks a venue up on the calendar to get RA spelling when the meeting carries no key', async () => {
      const { ctx, hits } = harness([
        [/Calendar\.aspx\?Date=2026Oct24$/, fx('calendar_VIC.html')],
        [/Form\.aspx/, fx('botwall.html')],
      ]);
      const ballarat = meeting({ date: '2026-10-24', venue: 'Ballarat', state: 'VIC' });
      await expect(new RacingAustraliaAdapter(0).fetchMeeting(ballarat, ctx)).rejects.toThrow(/unavailable on all hosts/);
      expect(hits.filter((u) => u.includes('Form.aspx?Key=2026Oct24%2CVIC%2CSportsbet-Ballarat'))).toHaveLength(3);
    });
  });

  describe('results overlay', () => {
    it('marks a race final when a fresh Results page is already cached for the meeting', async () => {
      // The REAL results capture doubles as the "form" page here: same race-title / race-strip-fields grammar.
      const { ctx } = harness([RESULTS_ROUTE, [/Form\.aspx\?Key=2025Oct18%2CVIC%2CCaulfield$/, fx('results_REAL_caulfield_2025-10-18.html')]]);
      const adapter = new RacingAustraliaAdapter(0);
      await adapter.fetchResults(CAULFIELD, 7, ctx);
      const m = await adapter.fetchMeeting(CAULFIELD, ctx);
      const r7 = m.races.find((r) => r.number === 7)!;
      expect(r7.status).toBe('final');
      expect(r7.results![0]).toEqual([3]);
      expect(r7.group).toBe('G1');
      expect(r7).toMatchObject({ ageRestriction: '3YO', sexRestriction: 'Fillies', prize: 1500000 });
      const winner = r7.runners.find((r) => r.number === 3)!;
      expect(winner).toMatchObject({ name: 'Ole Dancer', finishingPosition: 1, margin: 0 });
      expect(r7.runners.find((r) => r.number === 1)).toMatchObject({ finishingPosition: 2, margin: 0.35 });
    });
  });
});
