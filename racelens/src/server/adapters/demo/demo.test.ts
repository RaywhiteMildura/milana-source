import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MeetingRaw, MeetingSummary, RunnerRaw } from '../../../shared/types.js';
import { normaliseName } from '../../../shared/util.js';
import type { HttpClient } from '../../core/http.js';
import { AdapterRegistry } from '../registry.js';
import type { FetchContext, SourceAdapter } from '../types.js';
import {
  createDemoAdapters,
  DEMO_ADAPTER_IDS,
  DEMO_DATE,
  DEMO_MEETING_ID,
  DEMO_VENUE_SLUG,
  demoFormAdapter,
  demoNewsAdapter,
  demoOddsAAdapter,
  demoOddsBAdapter,
  demoOfficialAdapter,
  DemoTransportError,
  demoWeatherAdapter,
  loadDemoNews,
  loadDemoPack,
  loadDemoResults,
  loadDemoWeather,
  registerDemoAdapters,
} from './index.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function ctxAt(iso = '2026-10-24T11:00:00+11:00'): FetchContext {
  return { http: {} as unknown as HttpClient, log: silent, now: () => new Date(iso), jurisdiction: 'VIC' };
}

function meetingFor(adapter: SourceAdapter): MeetingSummary {
  const pack = loadDemoPack();
  return { ...pack.meeting, sourceRefs: { [adapter.id]: 'x' }, sources: [adapter.id] };
}

async function fetchAll(adapter: SourceAdapter, ctx = ctxAt()): Promise<MeetingRaw> {
  return adapter.fetchMeeting!(meetingFor(adapter), ctx);
}

function runner(m: MeetingRaw, race: number, number: number): RunnerRaw {
  const r = m.races.find((x) => x.number === race)?.runners.find((x) => x.number === number);
  if (!r) throw new Error(`R${race} #${number} not found in ${m.source}`);
  return r;
}

const ENV_KEYS = ['RACELENS_DEMO_FAIL', 'RACELENS_DEMO_LATENCY_MS', 'RACELENS_DEMO_RESULTS_READY'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ---------------------------------------------------------------------------

describe('demo fixtures', () => {
  it('loads a 9-race Flemington pack with valid runners', () => {
    const pack = loadDemoPack();
    expect(pack.meeting.id).toBe(DEMO_MEETING_ID);
    expect(pack.meeting.date).toBe(DEMO_DATE);
    expect(pack.meeting.venueSlug).toBe(DEMO_VENUE_SLUG);
    expect(pack.meeting.state).toBe('VIC');
    expect(pack.meeting.raceType).toBe('thoroughbred');
    expect(pack.meeting.trackCondition).toBe('Good 4');
    expect(pack.meeting.rail).toBe('+3m entire');
    expect(pack.meeting.weather).toBe('Fine');
    expect(pack.races).toHaveLength(9);
    expect(pack.races.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    for (const race of pack.races) {
      expect(race.distance).toBeGreaterThan(0);
      expect(race.startTime).toMatch(/^2026-10-24T\d\d:\d\d:00\+11:00$/);
      expect(race.runners.length).toBeGreaterThanOrEqual(6);
      expect(race.runners.length).toBeLessThanOrEqual(17);
      const numbers = new Set<number>();
      const barriers = new Set<number>();
      for (const r of race.runners) {
        expect(typeof r.number).toBe('number');
        expect(r.name.length).toBeGreaterThan(0);
        expect(numbers.has(r.number)).toBe(false);
        numbers.add(r.number);
        expect(r.weight).toBeGreaterThanOrEqual(52);
        expect(r.weight).toBeLessThanOrEqual(60.5);
        expect(r.form.length).toBeGreaterThanOrEqual(5);
        expect(r.form.length).toBeLessThanOrEqual(10);
        expect(r.last5.length).toBeGreaterThan(0);
        expect(r.career?.starts).toBeGreaterThanOrEqual(r.form.filter((f) => f.raceClass !== 'Barrier Trial').length);
        expect(['leader', 'on-pace', 'midfield', 'backmarker']).toContain(r.speedMapPosition);
        expect(typeof r.ratings.demoRating).toBe('number');
        for (const f of r.form) {
          expect(f.distance).toBeGreaterThan(0);
          expect(f.position).toBeGreaterThanOrEqual(1);
          expect(f.position).toBeLessThanOrEqual(f.starters);
        }
        if (!r.scratched) {
          expect(barriers.has(r.barrier)).toBe(false);
          barriers.add(r.barrier);
          expect(r.odds.tote?.win).toBeGreaterThan(1);
          expect(r.odds.alpha?.win).toBeGreaterThan(1);
          expect(r.odds.bravo?.win).toBeGreaterThan(1);
          expect(r.odds.alpha?.flucs.length).toBeGreaterThanOrEqual(2);
        }
      }
    }

    // Programme shape: a 6-runner race, a capacity field, ~35 minute gaps.
    expect(pack.races.some((r) => r.runners.length === 6)).toBe(true);
    expect(pack.races.some((r) => r.runners.length >= 16)).toBe(true);
    const starts = pack.races.map((r) => Date.parse(r.startTime));
    for (let i = 1; i < starts.length; i++) expect((starts[i] - starts[i - 1]) / 60000).toBe(35);
    expect(pack.meeting.firstRaceTime).toBe(pack.races[0].startTime);

    // Scratchings / emergency / gear / movers.
    const all = pack.races.flatMap((r) => r.runners);
    const scratched = all.filter((r) => r.scratched);
    expect(scratched.length).toBeGreaterThanOrEqual(1);
    expect(scratched.length).toBeLessThanOrEqual(2);
    expect(all.filter((r) => r.emergency)).toHaveLength(1);
    expect(all.filter((r) => r.gearChanges?.length).length).toBeGreaterThan(3);
    const live = all.filter((r) => !r.scratched);
    expect(live.some((r) => r.odds.alpha!.win < r.odds.alpha!.opening)).toBe(true); // firmers
    expect(live.some((r) => r.odds.alpha!.win > r.odds.alpha!.opening)).toBe(true); // drifters
  });

  it('declares the deliberate source variants', () => {
    const v = loadDemoPack().variants;
    const fields = v['demo-form'].runnerOverrides.map((o) => o.field).sort();
    expect(fields).toEqual(['jockey', 'name', 'name', 'scratched', 'weight']);
    expect(v['demo-odds-b'].runnerOverrides.map((o) => o.field)).toEqual(['barrier']);
    expect(v['demo-odds-b'].omitRunners).toHaveLength(1);
  });

  it('results cover races 1-3 with an on-pace, inside-barrier bias and favourites 2/3', () => {
    const pack = loadDemoPack();
    const { results, meetingId } = loadDemoResults();
    expect(meetingId).toBe(DEMO_MEETING_ID);
    expect(results.map((r) => r.raceNumber)).toEqual([1, 2, 3]);
    let favWins = 0;
    for (const res of results) {
      const race = pack.races.find((r) => r.number === res.raceNumber)!;
      const live = race.runners.filter((r) => !r.scratched);
      expect([...res.finishingOrder].sort((a, b) => a - b)).toEqual(live.map((r) => r.number).sort((a, b) => a - b));
      expect(res.placings.map((p) => p[0])).toEqual(res.finishingOrder.slice(0, 4));
      expect(res.margins[0]).toBe(0);
      expect(res.time).toMatch(/^\d:\d\d\.\d\d$/);
      expect(res.dividends.win).toBeGreaterThan(1);
      const winner = live.find((r) => r.number === res.placings[0][0])!;
      expect(winner.barrier).toBeLessThanOrEqual(5);
      expect(['leader', 'on-pace']).toContain(winner.speedMapPosition);
      expect(res.inRunning[String(winner.number)]).toMatch(/^[12]-/);
      const fav = live.reduce((b, r) => (r.odds.alpha!.win < b.odds.alpha!.win ? r : b), live[0]);
      if (fav.number === winner.number) favWins++;
      expect(res.favouriteWon).toBe(fav.number === winner.number);
    }
    expect(favWins).toBe(2);
  });

  it('news and weather fixtures are well formed', () => {
    const news = loadDemoNews().items;
    expect(news.length).toBeGreaterThanOrEqual(20);
    for (const n of news) {
      expect(n.title).toBeTruthy();
      expect(n.url).toMatch(/^https:\/\//);
      expect(n.outlet).toBeTruthy();
      expect(n.publishedAt).toMatch(/^2026-10-/);
    }
    expect(news.some((n) => (n.sentiment ?? 0) < -0.4)).toBe(true);
    expect(news.some((n) => (n.sentiment ?? 0) > 0.4)).toBe(true);
    const w = loadDemoWeather();
    expect(w.hourly.time).toHaveLength(96);
    expect(w.hourly.time[0]).toBe('2026-10-21T00:00');
    expect(w.hourly.precipitation).toHaveLength(96);
  });
});

// ---------------------------------------------------------------------------

describe('demo adapters: meetings and racecards', () => {
  const listers = () => createDemoAdapters().filter((a) => a.listMeetings);

  it('registers six adapters with the expected kinds and capabilities', () => {
    const reg = new AdapterRegistry();
    registerDemoAdapters(reg);
    expect(reg.all().map((a) => a.id)).toEqual([...DEMO_ADAPTER_IDS]);
    expect(reg.withCapability('results').map((a) => a.id)).toEqual(['demo-official']);
    expect(reg.withCapability('form').map((a) => a.id)).toEqual(['demo-form']);
    expect(reg.withCapability('odds').map((a) => a.id).sort()).toEqual(['demo-form', 'demo-odds-a', 'demo-odds-b']);
    expect(reg.withCapability('news').map((a) => a.id)).toEqual(['demo-news']);
    expect(reg.withCapability('weather').map((a) => a.id)).toEqual(['demo-weather']);
    expect(reg.get('demo-official')?.kind).toBe('official');
    expect(reg.get('demo-odds-b')?.kind).toBe('odds');
  });

  it('lists the demo meeting only for the demo date', async () => {
    expect(listers()).toHaveLength(4);
    for (const a of listers()) {
      const hit = await a.listMeetings!(DEMO_DATE, ctxAt());
      expect(hit).toHaveLength(1);
      expect(hit[0].id).toBe(DEMO_MEETING_ID);
      expect(hit[0].sources).toEqual([a.id]);
      expect(Object.keys(hit[0].sourceRefs)).toEqual([a.id]);
      expect(await a.listMeetings!('2026-10-25', ctxAt())).toEqual([]);
      expect(await a.listMeetings!('2026-10-23', ctxAt())).toEqual([]);
    }
  });

  it('fetchMeeting returns 9 races from every card source, empty for other meetings', async () => {
    for (const a of listers()) {
      const m = await fetchAll(a);
      expect(m.source).toBe(a.id);
      expect(m.races).toHaveLength(9);
      expect(m.races.every((r) => r.source === a.id && r.runners.length >= 6)).toBe(true);
      const other = await a.fetchMeeting!({ ...meetingFor(a), id: '2026-10-25:caulfield', date: '2026-10-25', venueSlug: 'caulfield' }, ctxAt());
      expect(other.races).toEqual([]);
    }
  });

  it('fetchRace returns one race, and an empty unknown race for bad numbers', async () => {
    const r = await demoOfficialAdapter.fetchRace!(meetingFor(demoOfficialAdapter), 6, ctxAt());
    expect(r.number).toBe(6);
    expect(r.runners).toHaveLength(6);
    expect(r.group).toBe('G3');
    const bad = await demoOfficialAdapter.fetchRace!(meetingFor(demoOfficialAdapter), 42, ctxAt());
    expect(bad.status).toBe('unknown');
    expect(bad.runners).toEqual([]);
  });

  it('official card is authoritative: scratchings, emergency, claims, no form/odds', async () => {
    const m = await fetchAll(demoOfficialAdapter);
    const all = m.races.flatMap((r) => r.runners);
    expect(all.filter((r) => r.scratched)).toHaveLength(2);
    expect(runner(m, 4, 9).scratched).toBe(true);
    expect(runner(m, 7, 3).scratched).toBe(true);
    expect(runner(m, 4, 17).emergency).toBe(true);
    expect(runner(m, 4, 17).claim).toBe(2);
    expect(all.every((r) => !r.form && !r.odds)).toBe(true);
    expect(all.every((r) => r.jockey && r.trainer && r.barrier && r.weight)).toBe(true);
  });

  it('form source carries rich form, splits, ratings, speed map and tote odds', async () => {
    const m = await fetchAll(demoFormAdapter);
    const r = runner(m, 9, 1);
    expect(r.form!.length).toBeGreaterThanOrEqual(5);
    expect(r.form![0].source).toBe('demo-form');
    expect(r.form![0]).toMatchObject({ venue: expect.any(String), distance: expect.any(Number), position: expect.any(Number) });
    expect(r.splits?.good || r.splits?.soft || r.splits?.heavy).toBeTruthy();
    expect(r.career?.starts).toBeGreaterThan(0);
    expect(r.ratings?.demoRating).toBeGreaterThan(0);
    expect(r.speedMapPosition).toBeTruthy();
    expect(r.last5).toBeTruthy();
    expect(r.daysSinceLastRun).toBeGreaterThan(0);
    expect(r.odds![0]).toMatchObject({ source: 'demo-form', type: 'tote', bookmaker: 'Demo Tote' });
    const runners = await demoFormAdapter.fetchForm!(meetingFor(demoFormAdapter), 3, ctxAt());
    expect(runners).toHaveLength(14);
    expect(runners.every((x) => (x.form?.length ?? 0) >= 5)).toBe(true);
  });

  it('bookmakers publish fixed odds with flucs and omit prices for scratched runners', async () => {
    const a = await fetchAll(demoOddsAAdapter);
    const b = await fetchAll(demoOddsBAdapter);
    const qa = runner(a, 5, 1).odds![0];
    const qb = runner(b, 5, 1).odds![0];
    expect(qa).toMatchObject({ source: 'demo-odds-a', type: 'fixed', bookmaker: 'AlphaBet' });
    expect(qb).toMatchObject({ source: 'demo-odds-b', type: 'fixed', bookmaker: 'BravoBet' });
    expect(qa.flucs!.length).toBe(4);
    expect(qa.flucs![qa.flucs!.length - 1].price).toBe(qa.win);
    expect(qa.flucs![0].price).toBe(qa.opening);
    expect(runner(a, 4, 9).scratched).toBe(true);
    expect(runner(a, 4, 9).odds).toEqual([]);
    expect(runner(a, 4, 17).odds!.length).toBe(1); // emergency gained a start
  });
});

// ---------------------------------------------------------------------------

describe('demo adapters: deliberate disagreements', () => {
  it('form has an older jockey booking on R5 #4', async () => {
    const official = await fetchAll(demoOfficialAdapter);
    const form = await fetchAll(demoFormAdapter);
    expect(runner(official, 5, 4).jockey).toBe('T. Marchetti');
    expect(runner(form, 5, 4).jockey).toBe('C. Whitlam');
  });

  it('form has R2 #7 weight 0.5kg heavier than official', async () => {
    const official = await fetchAll(demoOfficialAdapter);
    const form = await fetchAll(demoFormAdapter);
    expect(runner(form, 2, 7).weight! - runner(official, 2, 7).weight!).toBeCloseTo(0.5, 5);
  });

  it('form spells two names differently but they normalise to the same horse', async () => {
    const official = await fetchAll(demoOfficialAdapter);
    const form = await fetchAll(demoFormAdapter);
    expect(runner(official, 3, 6).name).toBe("Nellie's Lantern");
    expect(runner(form, 3, 6).name).toBe('Nellies Lantern');
    expect(normaliseName(runner(form, 3, 6).name)).toBe(normaliseName(runner(official, 3, 6).name));
    expect(runner(official, 9, 2).name).toBe('Tauranga Mist');
    expect(runner(form, 9, 2).name).toBe('Tauranga Mist (NZ)');
    expect(normaliseName(runner(form, 9, 2).name)).toBe(normaliseName(runner(official, 9, 2).name));
  });

  it('form has not applied the R7 #3 scratching', async () => {
    const official = await fetchAll(demoOfficialAdapter);
    const form = await fetchAll(demoFormAdapter);
    expect(runner(official, 7, 3).scratched).toBe(true);
    expect(runner(form, 7, 3).scratched).toBe(false);
  });

  it('bookmaker B has a barrier typo on R1 #5 (colliding with another runner) and is missing R8 #12', async () => {
    const official = await fetchAll(demoOfficialAdapter);
    const a = await fetchAll(demoOddsAAdapter);
    const b = await fetchAll(demoOddsBAdapter);
    expect(runner(a, 1, 5).barrier).toBe(runner(official, 1, 5).barrier);
    expect(runner(b, 1, 5).barrier).not.toBe(runner(official, 1, 5).barrier);
    const bRace1 = b.races.find((r) => r.number === 1)!;
    expect(bRace1.runners.filter((r) => r.barrier === runner(b, 1, 5).barrier).length).toBe(2);
    expect(runner(a, 8, 12).name).toBe('Moorabool Meadow');
    expect(b.races.find((r) => r.number === 8)!.runners.some((r) => r.number === 12)).toBe(false);
    expect(b.races.find((r) => r.number === 8)!.runners).toHaveLength(13);
  });

  it('bookmakers price the card slightly differently but agree on the favourite in races 1-3', async () => {
    const a = await fetchAll(demoOddsAAdapter);
    const b = await fetchAll(demoOddsBAdapter);
    const form = await fetchAll(demoFormAdapter);
    let differ = 0;
    let compared = 0;
    for (const ra of a.races) {
      const rb = b.races.find((r) => r.number === ra.number)!;
      for (const x of ra.runners) {
        const y = rb.runners.find((r) => r.number === x.number);
        if (!y || !x.odds?.length || !y.odds?.length) continue;
        compared++;
        if (x.odds[0].win !== y.odds[0].win) differ++;
      }
    }
    expect(compared).toBeGreaterThan(90);
    expect(differ).toBeGreaterThan(20);
    expect(differ).toBeLessThan(compared);
    const fav = (m: MeetingRaw, race: number) =>
      m.races.find((r) => r.number === race)!.runners.filter((r) => r.odds?.length).reduce((best, r) => (r.odds![0].win! < best.odds![0].win! ? r : best)).number;
    for (const n of [1, 2, 3]) {
      expect(fav(a, n)).toBe(fav(b, n));
      expect(fav(a, n)).toBe(fav(form, n));
    }
    expect(fav(a, 1)).toBe(6);
    expect(fav(a, 2)).toBe(1);
    expect(fav(a, 3)).toBe(2);
  });

  it('everything else agrees with the official card', async () => {
    const official = await fetchAll(demoOfficialAdapter);
    const others = [await fetchAll(demoFormAdapter), await fetchAll(demoOddsAAdapter), await fetchAll(demoOddsBAdapter)];
    const expected: Record<string, number> = { 'demo-form': 5, 'demo-odds-a': 0, 'demo-odds-b': 1 };
    for (const m of others) {
      let diffs = 0;
      for (const ro of official.races) {
        for (const x of ro.runners) {
          const y = m.races.find((r) => r.number === ro.number)!.runners.find((r) => r.number === x.number);
          if (!y) continue;
          if (y.name !== x.name) diffs++;
          if (y.barrier !== x.barrier) diffs++;
          if (y.jockey !== undefined && y.jockey !== x.jockey) diffs++;
          if (y.trainer !== undefined && y.trainer !== x.trainer) diffs++;
          if (y.weight !== undefined && y.weight !== x.weight) diffs++;
          if (Boolean(y.scratched) !== Boolean(x.scratched)) diffs++;
        }
      }
      expect(diffs, m.source).toBe(expected[m.source]);
    }
  });
});

// ---------------------------------------------------------------------------

describe('demo-official results gating', () => {
  const meeting = () => meetingFor(demoOfficialAdapter);

  it('returns null before a race has been run', async () => {
    const ctx = ctxAt('2026-10-24T12:00:00+11:00');
    expect(await demoOfficialAdapter.fetchResults!(meeting(), 1, ctx)).toBeNull();
    const m = await fetchAll(demoOfficialAdapter, ctx);
    expect(m.races.every((r) => r.status === 'open' && !r.results)).toBe(true);
  });

  it('publishes results once ctx.now() is past the scheduled start', async () => {
    const ctx = ctxAt('2026-10-24T13:20:00+11:00'); // R1 12:25 and R2 13:00 run; R3 13:35 not yet
    const r1 = await demoOfficialAdapter.fetchResults!(meeting(), 1, ctx);
    const r2 = await demoOfficialAdapter.fetchResults!(meeting(), 2, ctx);
    expect(r1).toMatchObject({ raceNumber: 1, source: 'demo-official', placings: [[6], [2], [9], [1]] });
    expect(r1!.recordedAt).toBe(ctx.now().toISOString());
    expect(r1!.dividends?.win).toBeGreaterThan(1);
    expect(r1!.margins![0]).toBe(0);
    expect(r2!.placings[0]).toEqual([8]);
    expect(await demoOfficialAdapter.fetchResults!(meeting(), 3, ctx)).toBeNull();
    expect(await demoOfficialAdapter.fetchResults!(meeting(), 4, ctx)).toBeNull();

    const m = await fetchAll(demoOfficialAdapter, ctx);
    expect(m.races.map((r) => r.status)).toEqual(['final', 'final', 'open', 'open', 'open', 'open', 'open', 'open', 'open']);
    expect(m.races[0].results).toEqual([[6], [2], [9], [1]]);
    expect(runner(m, 1, 6).finishingPosition).toBe(1);
    expect(runner(m, 1, 6).margin).toBe(0);
    expect(runner(m, 1, 2).finishingPosition).toBe(2);
    expect(runner(m, 1, 5).finishingPosition).toBe(10);
    expect(runner(m, 3, 2).finishingPosition).toBeUndefined();
  });

  it('RACELENS_DEMO_RESULTS_READY=all publishes races 1-3 regardless of the clock, never 4-9', async () => {
    process.env.RACELENS_DEMO_RESULTS_READY = 'all';
    const ctx = ctxAt('2026-10-24T09:00:00+11:00');
    for (const n of [1, 2, 3]) expect((await demoOfficialAdapter.fetchResults!(meeting(), n, ctx))?.raceNumber).toBe(n);
    for (const n of [4, 5, 9]) expect(await demoOfficialAdapter.fetchResults!(meeting(), n, ctx)).toBeNull();
    const race = await demoOfficialAdapter.fetchRace!(meeting(), 3, ctx);
    expect(race.status).toBe('final');
    expect(race.results).toEqual([[2], [11], [6], [4]]);
    // Long after the meeting, still only three results exist.
    const late = ctxAt('2026-12-01T09:00:00+11:00');
    delete process.env.RACELENS_DEMO_RESULTS_READY;
    expect(await demoOfficialAdapter.fetchResults!(meeting(), 9, late)).toBeNull();
    expect((await demoOfficialAdapter.fetchResults!(meeting(), 3, late))?.placings[0]).toEqual([2]);
  });

  it('returns null for a different meeting', async () => {
    process.env.RACELENS_DEMO_RESULTS_READY = 'all';
    const other = { ...meeting(), id: '2026-10-24:caulfield', venueSlug: 'caulfield' };
    expect(await demoOfficialAdapter.fetchResults!(other, 1, ctxAt())).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('demo-news', () => {
  it('matches title/snippet tokens case-insensitively and tags mentions and sentiment', async () => {
    const hits = await demoNewsAdapter.searchNews!('demo dynasty', ctxAt());
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const top = hits[0];
    expect(top.source).toBe('demo-news');
    expect(top.id).toBeTruthy();
    expect(top.url).toMatch(/^https:\/\//);
    expect(top.title).toMatch(/Demo Dynasty/);
    expect(top.mentions).toContain('Demo Dynasty');
    expect(top.mentions).toContain('Linda Okafor');
    expect(top.mentions).toContain('B. Kowalski');
    expect(top.sentiment).toBeLessThan(-0.4);
    expect(top.relevance).toBeGreaterThan(0.5);
  });

  it('ignores initials, apostrophes and country suffixes in the query', async () => {
    const byInitial = await demoNewsAdapter.searchNews!('T. Marchetti', ctxAt());
    expect(byInitial.length).toBeGreaterThanOrEqual(2);
    expect(byInitial.every((h) => /marchetti/i.test(`${h.title} ${h.snippet}`))).toBe(true);
    const nellie = await demoNewsAdapter.searchNews!("NELLIE'S LANTERN", ctxAt());
    expect(nellie.map((h) => h.id)).toContain('dn-007');
    expect(nellie[0].sentiment).toBeGreaterThan(0.4);
    const nz = await demoNewsAdapter.searchNews!('Tauranga Mist (NZ)', ctxAt());
    expect(nz.map((h) => h.id)).toContain('dn-008');
  });

  it('requires every token, returns nothing for unknown names or empty queries', async () => {
    expect(await demoNewsAdapter.searchNews!('Zebra Quasar Nonsense', ctxAt())).toEqual([]);
    expect(await demoNewsAdapter.searchNews!('', ctxAt())).toEqual([]);
    expect(await demoNewsAdapter.searchNews!('T.', ctxAt())).toEqual([]);
    const lantern = await demoNewsAdapter.searchNews!('lantern', ctxAt());
    expect(lantern.every((h) => /lantern/i.test(`${h.title} ${h.snippet}`))).toBe(true);
  });

  it('surfaces the jockey change and scratching stories', async () => {
    const yyy = await demoNewsAdapter.searchNews!('Yarra Yarra Yonder', ctxAt());
    expect(yyy[0].id).toBe('dn-002');
    expect(yyy[0].mentions).toEqual(expect.arrayContaining(['Yarra Yarra Yonder', 'C. Whitlam', 'T. Marchetti', 'Declan Murtagh']));
    const laser = await demoNewsAdapter.searchNews!('Laser Lane', ctxAt());
    expect(laser[0].sentiment).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('demo-weather', () => {
  it('builds a summary with hourly data, 72h rain and race-day figures', async () => {
    const w = await demoWeatherAdapter.fetchWeather!('Flemington', DEMO_DATE, ctxAt('2026-10-24T08:00:00+11:00'));
    expect(w).not.toBeNull();
    expect(w!.source).toBe('demo-weather');
    expect(w!.venue).toBe('Flemington');
    expect(w!.fetchedAt).toBe(new Date('2026-10-24T08:00:00+11:00').toISOString());
    expect(w!.hourly).toHaveLength(96);
    expect(w!.hourly[0].time).toBe('2026-10-21T00:00:00+11:00');
    expect(w!.hourly[0]).toMatchObject({ tempC: expect.any(Number), rainMm: expect.any(Number), windKmh: expect.any(Number) });
    expect(w!.rainLast72hMm).toBeCloseTo(7.4, 1);
    expect(w!.rainRaceDayMm).toBe(0);
    expect(w!.maxTempC).toBeGreaterThan(20);
    expect(w!.maxTempC).toBeLessThan(23);
    expect(w!.windKmhMax).toBeGreaterThan(15);
    expect(w!.conditionDrift).toBe(0);
    expect(typeof w!.summary).toBe('string');
    expect(w!.summary).toMatch(/Flemington/);
    expect(w!.summary).toMatch(/7\.4mm/);
  });

  it('matches the venue loosely and returns null for other venues or dates outside the series', async () => {
    expect(await demoWeatherAdapter.fetchWeather!('flemington', DEMO_DATE, ctxAt())).not.toBeNull();
    expect(await demoWeatherAdapter.fetchWeather!('Caulfield', DEMO_DATE, ctxAt())).toBeNull();
    expect(await demoWeatherAdapter.fetchWeather!('Flemington', '2026-11-07', ctxAt())).toBeNull();
    const thu = await demoWeatherAdapter.fetchWeather!('Flemington', '2026-10-22', ctxAt());
    expect(thu!.rainRaceDayMm).toBeCloseTo(7.4, 1);
  });
});

// ---------------------------------------------------------------------------

describe('demo env switches', () => {
  it('RACELENS_DEMO_FAIL makes demo-odds-b throw a transport error while others keep working', async () => {
    process.env.RACELENS_DEMO_FAIL = 'demo-odds-b';
    await expect(demoOddsBAdapter.listMeetings!(DEMO_DATE, ctxAt())).rejects.toBeInstanceOf(DemoTransportError);
    await expect(fetchAll(demoOddsBAdapter)).rejects.toThrow(/demo-odds-b/);
    await expect(demoOddsBAdapter.fetchRace!(meetingFor(demoOddsBAdapter), 1, ctxAt())).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(await demoOddsAAdapter.listMeetings!(DEMO_DATE, ctxAt())).toHaveLength(1);
    expect((await fetchAll(demoOfficialAdapter)).races).toHaveLength(9);

    process.env.RACELENS_DEMO_FAIL = 'demo-odds-a,demo-odds-b';
    await expect(demoOddsAAdapter.listMeetings!(DEMO_DATE, ctxAt())).rejects.toBeInstanceOf(DemoTransportError);

    delete process.env.RACELENS_DEMO_FAIL;
    expect(await demoOddsBAdapter.listMeetings!(DEMO_DATE, ctxAt())).toHaveLength(1);
  });

  it('RACELENS_DEMO_LATENCY_MS adds a small delay', async () => {
    process.env.RACELENS_DEMO_LATENCY_MS = '30';
    const t0 = performance.now();
    await demoOfficialAdapter.listMeetings!(DEMO_DATE, ctxAt());
    expect(performance.now() - t0).toBeGreaterThanOrEqual(25);
    delete process.env.RACELENS_DEMO_LATENCY_MS;
    const t1 = performance.now();
    await demoOfficialAdapter.listMeetings!(DEMO_DATE, ctxAt());
    expect(performance.now() - t1).toBeLessThan(25);
  });

  it('fetched timestamps come from ctx.now()', async () => {
    const ctx = ctxAt('2026-10-24T10:10:10+11:00');
    const m = await fetchAll(demoFormAdapter, ctx);
    expect(m.fetchedAt).toBe(ctx.now().toISOString());
    expect(m.races[0].fetchedAt).toBe(ctx.now().toISOString());
    expect(m.races[0].runners[0].odds![0].fetchedAt).toBe(ctx.now().toISOString());
  });
});
