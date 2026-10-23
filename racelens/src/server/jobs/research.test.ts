import { describe, expect, it } from 'vitest';
import type { FieldAgreement, JobProgress, MeetingPack, MeetingSummary, Race, RaceRaw, RaceResult, RaceStatus, Runner, WeatherHour } from '../../shared/types.js';
import type { FetchContext, SourceAdapter } from '../adapters/types.js';
import { AdapterRegistry } from '../adapters/registry.js';
import { silentLogger } from '../core/logger.js';
import { forecastDrift } from '../core/model.js';
import { summariseWeather } from '../core/weather.js';
import { DEFAULT_SETTINGS } from '../store/store.js';
import { JobHandle } from './manager.js';
import { buildNewsQueries, chooseResult, collectAndRerate, confirmationChecks, dueResultChecks, isResultSettled, keepJumpedPredictions, mergeMeetingSummaries, predictAll, raceJumped, recheckMeeting, recordResult, researchMeeting, type ResearchDeps } from './research.js';

const meeting: MeetingSummary = { id: '2026-10-24:flemington', date: '2026-10-24', venue: 'Flemington', venueSlug: 'flemington', raceType: 'thoroughbred', sourceRefs: {}, sources: [] };

describe('buildNewsQueries', () => {
  it('groups runners into OR queries and adds feature races', () => {
    const races = [
      { name: 'R1 Maiden Plate', group: undefined, runners: Array.from({ length: 8 }, (_, i) => ({ name: `Horse ${i + 1}`, scratched: i === 7 })) },
      { name: 'Ladbrokes Cox Plate', group: 'G1', runners: [{ name: 'Aeliana', scratched: false }, { name: 'Horse 1', scratched: false }] },
    ];
    const qs = buildNewsQueries(meeting, races as never, 6);
    expect(qs[0]).toBe('Flemington races 2026-10-24');
    expect(qs).toContain('Ladbrokes Cox Plate');
    expect(qs).not.toContain('R1 Maiden Plate');
    const groups = qs.filter((q) => q.includes(' OR '));
    expect(groups).toHaveLength(2); // 8 unique names (7 + Aeliana) → 6 + 2
    expect(groups[0].split(' OR ')).toHaveLength(6);
    expect(qs.join(' ')).not.toContain('Horse 8'); // scratched runner excluded
    expect(qs.join(' ').match(/"Horse 1"/g)).toHaveLength(1); // deduped across races
  });
});

describe('mergeMeetingSummaries', () => {
  it('merges the same venue from several sources and keeps the richest fields', () => {
    const merged = mergeMeetingSummaries([
      { source: 'tab', meetings: [{ ...meeting, trackCondition: 'Good 4', trackRating: 4, sourceRefs: { tab: 'R/FLM' } }] },
      { source: 'sportsbet', meetings: [{ ...meeting, id: 'x', venue: 'Flemington', venueSlug: 'flemington', rail: '+3m', sourceRefs: { sportsbet: '356|1|' } }] },
      { source: 'tab', meetings: [{ ...meeting, id: 'y', venue: 'Flemington', raceType: 'greyhound', sourceRefs: {} }] },
    ]);
    expect(merged).toHaveLength(2);
    const flem = merged.find((m) => m.raceType === 'thoroughbred')!;
    expect(flem.sources).toEqual(['tab', 'sportsbet']);
    expect(flem.sourceRefs).toEqual({ tab: 'R/FLM', sportsbet: '356|1|' });
    expect(flem.trackRating).toBe(4);
    expect(flem.rail).toBe('+3m');
    expect(flem.id).toBe('2026-10-24:flemington');
  });

  it('merges what the live feeds actually send: slug names, sponsor prefixes, dates with a time, AU vs AUS', () => {
    // Shapes seen from the real Racing.com, Racing Australia and Entain feeds on 17 and 24 Oct 2026.
    const rc = (venue: string, state: string) => ({ ...meeting, id: `x:${venue}`, venue, venueSlug: venue, state, date: '2026-10-17T00:00:00+11:00', country: 'Australia', firstRaceTime: undefined, sourceRefs: { racingcom: venue } });
    const en = (venue: string, state: string) => ({ ...meeting, id: `y:${venue}`, venue, venueSlug: venue.toLowerCase().replace(/ /g, '-'), state, date: '2026-10-17', country: 'AUS', firstRaceTime: '2026-10-17T01:15:00.000Z', sourceRefs: { entain: venue } });
    const merged = mergeMeetingSummaries(
      [
        { source: 'racingcom', meetings: [rc('caulfield', 'VIC'), rc('royal-randwick', 'NSW'), rc('sportsbet-port-lincoln', 'SA'), rc('aquis-park-gold-coast', 'QLD'), rc('picklebet-park-wodonga', 'VIC'), rc('port-macquarie', 'NSW')] },
        { source: 'entain', meetings: [en('Caulfield', 'VIC'), en('Randwick', 'NSW'), en('Port Lincoln', 'SA'), en('Gold Coast', 'QLD'), en('Wodonga', 'VIC'), en('Port Macquarie', 'NSW')] },
      ],
      '2026-10-17',
    );
    expect(merged.map((m) => m.venue)).toEqual(['Caulfield', 'Gold Coast', 'Port Lincoln', 'Port Macquarie', 'Randwick', 'Wodonga']);
    for (const m of merged) {
      expect(m.sources).toEqual(['racingcom', 'entain']);
      expect(m.date).toBe('2026-10-17');
      expect(m.firstRaceTime).toBe('2026-10-17T01:15:00.000Z');
      expect(m.id).toBe(`2026-10-17:${m.venueSlug}`);
    }
    expect(merged.find((m) => m.venue === 'Randwick')!.venueSlug).toBe('randwick');
  });

  it('folds a meeting one feed lists under its old venue into the meeting the other feeds agree on (Doomben / Eagle Farm, 24 Oct 2026)', () => {
    const at = (venue: string, source: string) => ({ source, meetings: [{ ...meeting, venue, venueSlug: venue.toLowerCase().replace(/ /g, '-'), state: 'QLD', raceCount: 10, firstRaceTime: '2026-10-24T01:18:00.000Z', sourceRefs: { [source]: venue } }] });
    const merged = mergeMeetingSummaries([at('Eagle Farm', 'racingaustralia'), at('Eagle Farm', 'racingcom'), { source: 'entain', meetings: [...at('Eagle Farm', 'entain').meetings, ...at('Doomben', 'entain').meetings] }], '2026-10-24');
    expect(merged.map((m) => m.venue)).toEqual(['Eagle Farm']);
    // Two meetings several feeds agree on are never folded together, even at the same time (Gold Coast turf and Poly).
    const both = mergeMeetingSummaries([
      { source: 'a', meetings: [...at('Gold Coast', 'a').meetings, ...at('Gold Coast Poly', 'a').meetings] },
      { source: 'b', meetings: [...at('Gold Coast', 'b').meetings, ...at('Gold Coast Poly', 'b').meetings] },
    ]);
    expect(both).toHaveLength(2);
  });

  it('never merges two real tracks: different states, or names that only share a word', () => {
    const one = (venue: string, state: string, source = 'a') => ({ source, meetings: [{ ...meeting, venue, venueSlug: venue.toLowerCase(), state, sourceRefs: {} }] });
    const merged = mergeMeetingSummaries([one('Sandown Hillside', 'VIC'), one('Sandown Lakeside', 'VIC', 'b'), one('Park', 'NSW'), one('Royal Park', 'SA', 'b')]);
    expect(merged).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// collectAndRerate – the results check behind the automatic watcher
// ---------------------------------------------------------------------------

const START = Date.parse('2026-10-24T02:00:00.000Z');
const at = (min: number) => new Date(START + min * 60_000);
const iso = (min: number) => at(min).toISOString();

function agree<T>(value: T): FieldAgreement<T> {
  return { value, agree: ['a'], disagree: [], confidence: 1 };
}

function runner(number: number, name: string): Runner {
  return {
    id: `r${number}`,
    number,
    name,
    barrier: number,
    jockey: `Rider ${number}`,
    trainer: 'T Trainer',
    weight: 56,
    scratched: false,
    form: [],
    gearChanges: [],
    comments: [],
    ratings: {},
    odds: [],
    fields: { barrier: agree(number), jockey: agree(`Rider ${number}`), trainer: agree('T Trainer'), weight: agree(56), scratched: agree(false), number: agree(number) },
    sources: ['a'],
    verification: { score: 1, sourceCount: 1, conflicts: [], checkedFields: 6, agreedFields: 6 },
    news: [],
  };
}

function race(number: number, startMin: number, over: Partial<Race> = {}): Race {
  return {
    number,
    name: `R${number}`,
    distance: 1200,
    startTime: iso(startMin),
    status: 'open',
    sourceRefs: {},
    runners: [runner(1, 'Alpha'), runner(2, 'Bravo'), runner(3, 'Charlie'), runner(4, 'Delta')],
    sources: ['a'],
    verification: { score: 1, sourceCount: 1, conflicts: [], checkedFields: 0, agreedFields: 0 },
    fieldSize: 4,
    fetchedAt: iso(-60),
    ...over,
  };
}

/** Two races: R1 jumps at START, R2 forty minutes later. Predictions made an hour before. */
function makePack(): MeetingPack {
  const pack: MeetingPack = { id: meeting.id, createdAt: iso(-60), updatedAt: iso(-60), meeting, races: [race(1, 0), race(2, 40)], predictions: {}, news: [], sourceStatuses: [], dayPatterns: [], results: {}, history: [], verificationScore: 1, settings: DEFAULT_SETTINGS };
  predictAll(pack, DEFAULT_SETTINGS, at(-60));
  return pack;
}

type Reporter = (raceNumber: number) => RaceResult | null;

function deps(sources: Record<string, Reporter>, now: Date, extra: SourceAdapter[] = []): ResearchDeps {
  const registry = new AdapterRegistry();
  for (const [id, fn] of Object.entries(sources)) registry.register({ id, name: id, kind: 'official', capabilities: ['results'], fetchResults: async (_m, n) => fn(n) });
  for (const a of extra) registry.register(a);
  const ctx = { http: { bound: () => ({}) }, log: silentLogger, now: () => now, jurisdiction: 'VIC' } as unknown as FetchContext;
  return { registry, ctx, settings: DEFAULT_SETTINGS, now: () => now };
}

function job(): JobHandle {
  const progress: JobProgress = { id: 'j', type: 'results', status: 'running', steps: [], startedAt: iso(0), percent: 0, message: '' };
  return new JobHandle(progress, () => undefined);
}

const report =
  (source: string, placings: number[][], status?: RaceResult['status']): Reporter =>
  (raceNumber) =>
    raceNumber === 1 ? { raceNumber, placings, recordedAt: iso(3), source, status } : null;
const nothing: Reporter = () => null;
const steps = (j: JobHandle) => j.progress.steps.map((s) => `${s.key}:${s.status}`);
const ON = { autoResults: true };

describe('collectAndRerate', () => {
  it('records a result two sources agree on, settles the watch, re-rates only the remaining races and writes one history line', async () => {
    const pack = makePack();
    const before = structuredClone(pack.predictions);
    const j = job();
    const out = await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]), b: report('b', [[2], [1], [3]]) }, at(3)), pack, j);
    expect(out).toEqual({ newly: [1], checked: [1] });
    expect(pack.results[1]).toMatchObject({ status: 'final', confirmedBy: ['a', 'b'], placings: [[2], [1], [3]] });
    expect(pack.results[1].scorecard).toBeDefined();
    expect(pack.races[0].status).toBe('final');
    // Settled; one late look at +30 min is booked for a correction (protest).
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(3), attempts: 1, note: 'Confirmed by 2 sources', correctionCheckAt: iso(30) });
    expect(isResultSettled(pack, 1)).toBe(true);
    // Re-rated the race still to run, not the one just resulted.
    expect(pack.predictions[2].generatedAt).toBe(iso(3));
    expect(pack.predictions[1]).toEqual(before[1]);
    expect(steps(j)).toEqual(['results:done', 'patterns:done', 'repredict:done']);
    expect(pack.history).toHaveLength(1);
    expect(pack.history[0]).toMatchObject({ at: iso(3), type: 'results', raceNumber: 1, summary: 'Results check: R1 result in - Bravo (2) won; R2 re-rated' });
    expect(pack.history[0].changes?.[0]).toMatch(/^R1: winner was/);
    expect(j.progress.message).toBe('Results recorded for R1');
  });

  it('with one source only it books three extra looks for a second source, then accepts the result; nothing is re-rated meanwhile', async () => {
    const pack = makePack();
    const src = { a: report('a', [[2], [1], [3]]) };
    await collectAndRerate(deps(src, at(3)), pack, job(), [1], { automatic: true });
    expect(pack.results[1]).toMatchObject({ status: 'final', confirmedBy: ['a'] });
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(3), attempts: 1, nextCheckAt: iso(4), note: 'Result from a only - waiting for a second source (extra check 0 of 3)' });
    expect(isResultSettled(pack, 1)).toBe(false);
    expect(pack.history.map((h) => h.summary)).toEqual(['Automatic results check: R1 result in - Bravo (2) won; R2 re-rated']);
    const rated = pack.predictions[2].generatedAt;

    for (const [min, k] of [
      [4, 1],
      [6, 2],
    ] as const) {
      const j = job();
      const out = await collectAndRerate(deps(src, at(min)), pack, j, [1], { automatic: true });
      expect(out).toEqual({ newly: [], checked: [1] });
      expect(pack.resultWatch?.[1]).toMatchObject({ lastCheckedAt: iso(min), attempts: k + 1, nextCheckAt: iso(min + 2) });
      expect(confirmationChecks(pack.resultWatch?.[1])).toBe(k);
      expect(steps(j)).toEqual(['results:done', 'patterns:skipped', 'repredict:skipped']);
    }
    await collectAndRerate(deps(src, at(8)), pack, job(), [1], { automatic: true });
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(8), attempts: 4, note: 'One source only', correctionCheckAt: iso(30) });
    expect(isResultSettled(pack, 1)).toBe(true);
    expect(pack.predictions[2].generatedAt).toBe(rated);
    // The three "no change" checks collapsed into a single history line.
    expect(pack.history.map((h) => h.summary)).toEqual(['Automatic results check: R1 result in - Bravo (2) won; R2 re-rated', 'Automatic results check R1: still from one source (3 checks so far)']);

    // Its late-correction look at +30 finds nothing new: it stays accepted (the confirmation phase does not restart) and is never polled again.
    expect(dueResultChecks(pack, at(29), ON)).toEqual([]);
    expect(dueResultChecks(pack, at(30), ON)).toEqual([1]);
    await collectAndRerate(deps(src, at(30)), pack, job(), dueResultChecks(pack, at(30), ON), { automatic: true });
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(30), attempts: 5, note: 'One source only' });
    expect(isResultSettled(pack, 1)).toBe(true);
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check R1: no change (4 checks so far)');
    expect(dueResultChecks(pack, at(60), ON)).not.toContain(1);
  });

  it('a second source arriving later confirms the result and settles the watch', async () => {
    const pack = makePack();
    await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]), b: nothing }, at(3)), pack, job(), [1], { automatic: true });
    const rated = pack.predictions[2].generatedAt;
    const out = await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]), b: report('b', [[2], [1], [3]]) }, at(5)), pack, job(), [1], { automatic: true });
    expect(out.newly).toEqual([1]);
    expect(pack.results[1].confirmedBy).toEqual(['a', 'b']);
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(5), attempts: 2, note: 'Confirmed by 2 sources', correctionCheckAt: iso(30) });
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check: R1 result confirmed by 2 sources - Bravo (2) won; R2 re-rated');
    expect(pack.predictions[2].generatedAt).not.toBe(rated); // firmed-up result: patterns and ratings refreshed
  });

  it('keeps polling an interim result and re-rates once it is declared final', async () => {
    const pack = makePack();
    await collectAndRerate(deps({ a: report('a', [[2], [1], [3]], 'interim') }, at(3)), pack, job(), [1], { automatic: true });
    expect(pack.results[1].status).toBe('interim');
    expect(pack.races[0].status).toBe('interim');
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(3), attempts: 1, nextCheckAt: iso(4), note: 'Interim result - waiting for it to be declared final' });
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check: R1 interim result in - Bravo (2) won; R2 re-rated');
    expect(isResultSettled(pack, 1)).toBe(false);

    await collectAndRerate(deps({ a: report('a', [[2], [1], [3]], 'interim') }, at(4)), pack, job(), [1], { automatic: true });
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check R1: still interim'); // a fresh line after a news line, not collapsed into it
    expect(pack.resultWatch?.[1]?.nextCheckAt).toBe(iso(6));

    const out = await collectAndRerate(deps({ a: report('a', [[2], [1], [3]], 'final') }, at(6)), pack, job(), [1], { automatic: true });
    expect(out.newly).toEqual([1]);
    expect(pack.results[1].status).toBe('final');
    expect(pack.races[0].status).toBe('final');
    expect(pack.predictions[2].generatedAt).toBe(iso(6));
  });

  it('a corrected result (protest upheld) is recorded as such and re-rates', async () => {
    const pack = makePack();
    await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]), b: nothing }, at(3)), pack, job(), [1]);
    const out = await collectAndRerate(deps({ a: report('a', [[1], [2], [3]]), b: report('b', [[1], [2], [3]]) }, at(9)), pack, job(), [1]);
    expect(out.newly).toEqual([1]);
    expect(pack.results[1].placings[0]).toEqual([1]);
    expect(pack.results[1].confirmedBy).toEqual(['a', 'b']);
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(9), attempts: 2, note: 'Confirmed by 2 sources', correctionCheckAt: iso(30) });
    expect(pack.history.at(-1)?.summary).toBe('Results check: R1 result corrected - Alpha (1) won; R2 re-rated');
  });

  it('a result two sources agreed on is final: a later request for that race does not re-fetch it', async () => {
    const pack = makePack();
    await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]), b: report('b', [[2], [1], [3]]) }, at(3)), pack, job(), [1]);
    const out = await collectAndRerate(deps({ a: report('a', [[1], [2], [3]]), b: report('b', [[1], [2], [3]]) }, at(9)), pack, job(), [1]);
    expect(out).toEqual({ newly: [], checked: [] });
    expect(pack.results[1].placings[0]).toEqual([2]);
    expect(pack.resultWatch?.[1].attempts).toBe(1);
  });

  it('with nothing published it books the next slot, and gives up with a clear note four hours after the jump', async () => {
    const pack = makePack();
    const j = job();
    const out = await collectAndRerate(deps({ a: nothing, b: nothing }, at(2)), pack, j, [1], { automatic: true });
    expect(out).toEqual({ newly: [], checked: [1] });
    expect(pack.results[1]).toBeUndefined();
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(2), attempts: 1, nextCheckAt: iso(4), note: 'Nothing published yet' });
    expect(steps(j)).toEqual(['results:done', 'patterns:skipped', 'repredict:skipped']);
    expect(pack.history.map((h) => h.summary)).toEqual(['Automatic results check R1: nothing published yet']);
    expect(j.progress.message).toBe('No new results yet');

    await collectAndRerate(deps({ a: nothing, b: nothing }, at(4)), pack, job(), [1], { automatic: true });
    expect(pack.history.map((h) => h.summary)).toEqual(['Automatic results check R1: nothing published yet (2 checks so far)']);

    await collectAndRerate(deps({ a: nothing, b: nothing }, at(241)), pack, job(), [1], { automatic: true });
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(241), attempts: 3, gaveUp: true, note: 'No result published after 4 hours - enter it manually or press Fetch results' });
  });

  it('without a race list it checks every race that has jumped and describes mixed outcomes per race', async () => {
    const pack = makePack();
    const r2 = structuredClone(pack.predictions[2]);
    const out = await collectAndRerate(deps({ a: report('a', [[3], [4], [1]]), b: report('b', [[3], [4], [1]]) }, at(45)), pack, job(), undefined, { automatic: true });
    expect(out).toEqual({ newly: [1], checked: [1, 2] }); // R2 jumped five minutes ago, no result yet
    // R2 has jumped: it keeps the picks it jumped with (they are what it will be scored on), so nothing is re-rated.
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check: R1 result in - Charlie (3) won');
    expect(pack.predictions[2]).toEqual(r2);
    expect(pack.resultWatch?.[2]).toMatchObject({ attempts: 1, note: 'Nothing published yet', nextCheckAt: iso(46) });
    const again = await collectAndRerate(deps({ a: report('a', [[3], [4], [1]]), b: report('b', [[3], [4], [1]]) }, at(46)), pack, job(), undefined, { automatic: true });
    expect(again).toEqual({ newly: [], checked: [2] }); // R1 is settled and left alone
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check R2: nothing published yet');
  });

  it('never re-fetches a manual result or one two sources already agreed on, and says so', async () => {
    const pack = makePack();
    pack.results[1] = { raceNumber: 1, placings: [[4], [3], [2]], recordedAt: iso(5), source: 'manual', status: 'final', confirmedBy: ['manual'] };
    let calls = 0;
    const out = await collectAndRerate(
      deps({
        a: (n) => {
          calls++;
          return report('a', [[2], [1], [3]])(n);
        },
      }, at(6)),
      pack,
      job(),
      [1],
    );
    expect(out).toEqual({ newly: [], checked: [] });
    expect(calls).toBe(0);
    expect(pack.results[1].source).toBe('manual');
    expect(pack.history.at(-1)?.summary).toBe('Results check: R1 already settled');
    expect(pack.resultWatch).toBeUndefined();
  });

  it('flags disagreement between sources in the history line details', async () => {
    const pack = makePack();
    await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]), b: report('b', [[1], [2], [3]]) }, at(3)), pack, job(), [1]);
    expect(pack.results[1]).toBeDefined();
    expect(pack.history.at(-1)?.changes?.some((c) => /disagree/.test(c))).toBe(true);
  });

  it('reports a missing results source instead of pretending to check', async () => {
    const pack = makePack();
    const j = job();
    const out = await collectAndRerate(deps({}, at(3)), pack, j, [1], { automatic: true });
    expect(out).toEqual({ newly: [], checked: [] });
    expect(j.progress.steps[0]).toMatchObject({ key: 'results', status: 'warn' });
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check: no results source available');
  });
});

// ---------------------------------------------------------------------------
// One set of rules for every results path (review fixes)
// ---------------------------------------------------------------------------

/** R1 at START, R2 forty minutes later, R3 eighty minutes later. */
function makePack3(): MeetingPack {
  const pack = makePack();
  pack.races.push(race(3, 80));
  predictAll(pack, DEFAULT_SETTINGS, at(-60));
  return pack;
}

const manualResult = (placings: number[][]): RaceResult => ({ raceNumber: 1, placings, recordedAt: iso(20), source: 'manual', status: 'final', confirmedBy: ['manual'] });

/** A race-card source that reports a race's status (used to learn of an abandonment). */
function card(id: string, status: () => RaceStatus, onCall?: () => void): SourceAdapter {
  return {
    id,
    name: id,
    kind: 'official',
    capabilities: ['racecard'],
    fetchRace: async (_m, n) => {
      onCall?.();
      const r = race(n, 0);
      return {
        number: n,
        name: r.name,
        distance: r.distance,
        startTime: r.startTime,
        status: status(),
        sourceRefs: {},
        runners: r.runners.map((x) => ({ number: x.number, name: x.name, barrier: x.barrier, jockey: x.jockey, trainer: x.trainer, weight: x.weight, scratched: false, form: [], gearChanges: [], comments: [], ratings: {}, odds: [] })),
        source: id,
        fetchedAt: iso(0),
      } as unknown as RaceRaw;
    },
  };
}

describe('chooseResult', () => {
  const r = (source: string, status?: RaceResult['status']): RaceResult => ({ raceNumber: 1, placings: [[2], [1], [3]], recordedAt: iso(3), source, status });
  it('keeps agreed placings interim while any agreeing source still calls them interim', () => {
    expect(chooseResult([r('tab', 'interim'), r('racingcom', 'final')])?.result).toMatchObject({ status: 'interim', confirmedBy: ['tab', 'racingcom'] });
    expect(chooseResult([r('tab', 'interim'), r('ra')])?.result.status).toBe('interim');
    expect(chooseResult([r('a', 'final'), r('b')])?.result.status).toBe('final');
    expect(chooseResult([r('a')])?.result.status).toBe('final');
    expect(chooseResult([r('a', 'interim')])?.result.status).toBe('interim');
  });
});

describe('results path rules', () => {
  it('a protest-pending result is not locked by a feed that calls it final; the late look picks up the correction, then the race is left alone', async () => {
    const pack = makePack();
    // +3: TAB says interim, racing.com labels the same placings final.
    await collectAndRerate(deps({ tab: report('tab', [[2], [1], [3]], 'interim'), rc: report('rc', [[2], [1], [3]], 'final') }, at(3)), pack, job(), [1], { automatic: true });
    expect(pack.results[1]).toMatchObject({ status: 'interim', confirmedBy: ['tab', 'rc'] });
    expect(isResultSettled(pack, 1)).toBe(false);
    expect(pack.resultWatch?.[1]).toMatchObject({ nextCheckAt: iso(4), note: 'Interim result - waiting for it to be declared final' });

    // +6: both final with the same placings: settled, one late look booked.
    const both = (placings: number[][]) => ({ tab: report('tab', placings, 'final'), rc: report('rc', placings, 'final') });
    await collectAndRerate(deps(both([[2], [1], [3]]), at(6)), pack, job(), [1], { automatic: true });
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(6), attempts: 2, note: 'Confirmed by 2 sources', correctionCheckAt: iso(30) });
    expect(isResultSettled(pack, 1)).toBe(true);
    expect(dueResultChecks(pack, at(29), ON)).toEqual([]);
    expect(dueResultChecks(pack, at(30), ON)).toEqual([1]);

    // +30: the protest was upheld and both sources now publish 1-2-3.
    const rated = pack.predictions[2].generatedAt;
    const out = await collectAndRerate(deps(both([[1], [2], [3]]), at(30)), pack, job(), dueResultChecks(pack, at(30), ON), { automatic: true });
    expect(out.newly).toEqual([1]);
    expect(pack.results[1].placings[0]).toEqual([1]);
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check: R1 result corrected - Alpha (1) won; R2 re-rated');
    expect(pack.predictions[2].generatedAt).not.toBe(rated);
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(30), attempts: 3, note: 'Confirmed by 2 sources' });
    // Bounded: never polled again.
    for (const min of [31, 60, 240, 300]) expect(dueResultChecks(pack, at(min), ON)).not.toContain(1);
  });

  it('the late look at a two-source result that has not changed is a quiet no-op, and a request before it does not re-fetch', async () => {
    const pack = makePack();
    let calls = 0;
    const counted: Reporter = (n) => {
      calls++;
      return report('b', [[2], [1], [3]])(n);
    };
    await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]), b: counted }, at(3)), pack, job(), [1], { automatic: true });
    calls = 0;
    expect(await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]), b: counted }, at(10)), pack, job(), [1])).toEqual({ newly: [], checked: [] });
    expect(calls).toBe(0);
    const out = await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]), b: counted }, at(30)), pack, job(), dueResultChecks(pack, at(30), ON), { automatic: true });
    expect(out).toEqual({ newly: [], checked: [1] });
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(30), attempts: 2, note: 'Confirmed by 2 sources' });
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check R1: no change');
    expect(dueResultChecks(pack, at(45), ON)).not.toContain(1);
  });

  it('a late look where only one of the two agreeing sources answers keeps the two-source result', async () => {
    const pack = makePack();
    await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]), b: report('b', [[2], [1], [3]]) }, at(3)), pack, job(), [1], { automatic: true });
    await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]), b: nothing }, at(30)), pack, job(), dueResultChecks(pack, at(30), ON), { automatic: true });
    expect(pack.results[1].confirmedBy).toEqual(['a', 'b']);
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(30), attempts: 2, note: 'Confirmed by 2 sources' });
    expect(isResultSettled(pack, 1)).toBe(true);
  });

  it('a pre-race check never re-fetches or replaces a result typed in by hand, whatever the sources say', async () => {
    const pack = makePack();
    let r1Calls = 0;
    for (const status of [undefined, 'interim'] as const) {
      pack.results[1] = manualResult([[1], [2], [3]]);
      pack.races[0].status = 'final';
      const src: Reporter = (n) => {
        if (n === 1) r1Calls++;
        return report('a', [[2], [1], [3]], status)(n);
      };
      // Pre-race check of R2 (and of the whole card) after R1 was corrected by hand.
      await recheckMeeting(deps({ a: src }, at(31)), pack, job(), 2);
      await recheckMeeting(deps({ a: src, b: src }, at(45)), pack, job());
      expect(pack.results[1]).toMatchObject({ source: 'manual', placings: [[1], [2], [3]], status: 'final' });
      expect(pack.races[0].status).toBe('final');
      expect(dueResultChecks(pack, at(46), ON)).not.toContain(1);
    }
    expect(r1Calls).toBe(0);
    expect(pack.history.some((h) => /R1 result corrected/.test(h.summary))).toBe(false);
  });

  it('a result that lands in a pre-race check keeps the watcher in step and re-rates every race still to run', async () => {
    const pack = makePack3();
    const two = (status: RaceResult['status']) => ({ a: report('a', [[2], [1], [3]], status), b: report('b', [[2], [1], [3]], status) });
    await collectAndRerate(deps(two('interim'), at(3)), pack, job(), [1], { automatic: true });
    expect(pack.resultWatch?.[1]?.nextCheckAt).toBe(iso(4));

    // R2's pre-race check at +31 finds R1 declared final by both sources.
    await recheckMeeting(deps(two('final'), at(31)), pack, job(), 2);
    expect(pack.results[1]).toMatchObject({ status: 'final', confirmedBy: ['a', 'b'] });
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(31), attempts: 2, note: 'Confirmed by 2 sources' });
    expect(pack.predictions[2].generatedAt).toBe(iso(31));
    expect(pack.predictions[3].generatedAt).toBe(iso(31)); // not only the race being checked
    expect(pack.history.at(-1)).toMatchObject({ type: 'recheck', raceNumber: 2 });
    expect(pack.history.at(-1)?.summary).toMatch(/^Pre-race check R2: .+, results in for R1$/);
    // Nothing left for the watcher to fetch again.
    expect(dueResultChecks(pack, at(31), ON)).toEqual([]);
  });

  it('a pre-race check does not re-fetch a result the watcher has already settled', async () => {
    const pack = makePack();
    let r1Calls = 0;
    const src = {
      a: (n: number) => {
        if (n === 1) r1Calls++;
        return report('a', [[2], [1], [3]])(n);
      },
    };
    for (const min of [3, 4, 6, 8]) await collectAndRerate(deps(src, at(min)), pack, job(), [1], { automatic: true });
    expect(pack.resultWatch?.[1].note).toBe('One source only');
    r1Calls = 0;
    await recheckMeeting(deps(src, at(25)), pack, job(), 2);
    await recheckMeeting(deps(src, at(28)), pack, job(), 2);
    expect(r1Calls).toBe(0);
  });

  it('a check nobody answers keeps a recorded result and its confirmation count instead of claiming nothing was published', async () => {
    const pack = makePack();
    let up = true;
    const src = { a: (n: number) => (up ? report('a', [[2], [1], [3]])(n) : null), b: nothing };
    await collectAndRerate(deps(src, at(3)), pack, job(), [1], { automatic: true });
    up = false;
    await collectAndRerate(deps(src, at(4)), pack, job(), [1], { automatic: true });
    expect(confirmationChecks(pack.resultWatch?.[1])).toBe(1);
    expect(pack.resultWatch?.[1].note).toContain('Result from a only');
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check R1: still from one source');
    up = true;
    await collectAndRerate(deps(src, at(6)), pack, job(), [1], { automatic: true });
    expect(confirmationChecks(pack.resultWatch?.[1])).toBe(2);
    up = false;
    await collectAndRerate(deps(src, at(8)), pack, job(), [1], { automatic: true });
    expect(pack.resultWatch?.[1]).toMatchObject({ note: 'One source only' });
    expect(pack.resultWatch?.[1].gaveUp).toBeUndefined();
    expect(isResultSettled(pack, 1)).toBe(true);
    expect(pack.history.some((h) => /nothing published/.test(h.summary))).toBe(false);

    // An interim result whose sources go quiet ends with the interim note, not "No result published".
    const interim = makePack();
    await collectAndRerate(deps({ a: report('a', [[2], [1], [3]], 'interim') }, at(3)), interim, job(), [1], { automatic: true });
    await collectAndRerate(deps({ a: nothing }, at(241)), interim, job(), [1], { automatic: true });
    expect(interim.resultWatch?.[1]).toMatchObject({ gaveUp: true, note: 'Result still interim 4 hours after the jump - check it manually' });
  });

  it('tells "no results source answered" apart from "nothing published" in the note, the job step, the history and the log', async () => {
    const pack = makePack();
    const warnings: string[] = [];
    const failing =
      (message: string): Reporter =>
      () => {
        throw new Error(message);
      };
    const d = deps({ tab: failing('HTTP 403 for https://api.beta.tab.com.au/v1/x'), ra: failing('bot wall') }, at(2));
    d.ctx = { ...d.ctx, log: { ...silentLogger, warn: (m: string) => warnings.push(m) } };
    const j = job();
    expect(await collectAndRerate(d, pack, j, [1], { automatic: true })).toEqual({ newly: [], checked: [1] });
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(2), attempts: 1, nextCheckAt: iso(4), note: 'No results source answered (tab: HTTP 403; ra: bot wall)' });
    expect(j.progress.steps[0]).toMatchObject({ key: 'results', status: 'warn', detail: 'No results source answered (tab: HTTP 403; ra: bot wall)' });
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check R1: no results source answered');
    expect(pack.history.at(-1)?.changes).toEqual(['R1: no results source answered (tab: HTTP 403; ra: bot wall)']);
    expect(warnings).toEqual(['tab results Flemington R1: HTTP 403 for https://api.beta.tab.com.au/v1/x', 'ra results Flemington R1: bot wall']);

    // Still unreachable four hours on: the give-up note points at the connection, not at the sources.
    const late = deps({ tab: failing('HTTP 403 for https://x'), ra: failing('bot wall') }, at(241));
    await collectAndRerate(late, pack, job(), [1], { automatic: true });
    expect(pack.resultWatch?.[1]).toMatchObject({ gaveUp: true, note: 'Could not reach the results sources for 4 hours - check the connection, then press Fetch results or enter it manually' });

    // One source failing while another answers "nothing yet" is the ordinary case: the failure is only mentioned in the step.
    const partial = makePack();
    const pj = job();
    await collectAndRerate(deps({ tab: failing('HTTP 403 for https://x'), b: nothing }, at(2)), partial, pj, [1], { automatic: true });
    expect(partial.resultWatch?.[1].note).toBe('Nothing published yet');
    expect(pj.progress.steps[0]).toMatchObject({ status: 'done', detail: 'No new results yet (tab: HTTP 403)' });
  });

  it('learns from the race card that a race was abandoned after the jump instead of polling it for four hours', async () => {
    const pack = makePack();
    let status: RaceStatus = 'open';
    let cardCalls = 0;
    const d = (min: number) => deps({ a: nothing, b: nothing }, at(min), [card('card', () => status, () => cardCalls++)]);
    await collectAndRerate(d(2), pack, job(), [1], { automatic: true });
    expect(cardCalls).toBe(0); // the first looks are results-only
    await collectAndRerate(d(20), pack, job(), [1], { automatic: true });
    expect(cardCalls).toBe(1); // 20 minutes and nothing: ask the race card once
    expect(pack.resultWatch?.[1].note).toBe('Nothing published yet');
    await collectAndRerate(d(22), pack, job(), [1], { automatic: true });
    expect(cardCalls).toBe(1); // not on every look

    status = 'abandoned';
    const rated = pack.predictions[2].generatedAt;
    const out = await collectAndRerate(d(30), pack, job(), [1], { automatic: true });
    expect(cardCalls).toBe(2);
    expect(out.newly).toEqual([]);
    expect(pack.races[0].status).toBe('abandoned');
    expect(pack.resultWatch?.[1]).toBeUndefined();
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check: R1 abandoned');
    expect(pack.predictions[2].generatedAt).toBe(rated); // nothing to re-rate
    expect(dueResultChecks(pack, at(35), ON)).toEqual([]); // R2 has not jumped yet

    // A server that was off all afternoon learns it on its first look instead of giving up.
    const late = makePack();
    await collectAndRerate(deps({ a: nothing }, at(300), [card('card', () => 'abandoned')]), late, job(), [1], { automatic: true });
    expect(late.races[0].status).toBe('abandoned');
    expect(late.resultWatch?.[1]).toBeUndefined();
  });

  it('a pre-race check that finds the race abandoned says so and stops watching it', async () => {
    const pack = makePack();
    pack.resultWatch = { 1: { lastCheckedAt: iso(-1), attempts: 0, note: 'Nothing published yet', nextCheckAt: iso(2) } };
    const { changes } = await recheckMeeting(deps({}, at(-5), [card('card', () => 'abandoned')]), pack, job(), 1);
    expect(pack.races[0].status).toBe('abandoned');
    expect(changes).toContain('R1: race abandoned');
    expect(pack.resultWatch?.[1]).toBeUndefined();
    expect(pack.history.at(-1)?.summary).toMatch(/^Pre-race check R1: \d+ changes?/);
  });
});

// ---------------------------------------------------------------------------
// Pre-race weather refresh and the sources' own meeting keys (review fixes)
// ---------------------------------------------------------------------------

/** Friday night's forecast for Flemington: 7mm on race morning between 10:00 and 13:00 AEDT, then dry. */
const RAIN_10_TO_13: WeatherHour[] = [10, 11, 12, 13].map((h, i) => ({ time: `2026-10-24T${h}:00`, rainMm: i < 3 ? 2 : 1 }));

/** A weather source that forecasts RAIN_10_TO_13 as of its clock (or fails). */
function weatherSource(onCall: () => void, fail = false): SourceAdapter {
  return {
    id: 'wx',
    name: 'wx',
    kind: 'weather',
    capabilities: ['weather'],
    fetchWeather: async (venue, date, c) => {
      onCall();
      if (fail) throw new Error('HTTP 503');
      return summariseWeather({ venue, source: 'wx', fetchedAt: c.now().toISOString(), hourly: RAIN_10_TO_13, raceDayDate: date, timezone: 'Australia/Melbourne' });
    },
  };
}

/** R1 at 16:00 and R2 at 16:40 AEDT on a track declared Good 4, rated on Friday night's forecast. */
function rainPack(id: string): MeetingPack {
  const pack = makePack();
  pack.id = id;
  pack.races = [race(1, 180, { trackRating: 4 }), race(2, 220, { trackRating: 4 })];
  pack.weather = summariseWeather({ venue: 'Flemington', source: 'wx', fetchedAt: '2026-10-23T09:00:00.000Z', hourly: RAIN_10_TO_13, raceDayDate: meeting.date, timezone: 'Australia/Melbourne' });
  pack.predictions = {};
  predictAll(pack, DEFAULT_SETTINGS, at(-60));
  return pack;
}

describe('pre-race weather refresh', () => {
  it('refreshes a forecast older than 30 minutes, so rain that has already fallen stops softening the expected going', async () => {
    const pack = rainPack('wx-refresh');
    expect(pack.weather?.rainRaceDayMm).toBe(7);
    expect(forecastDrift(pack.weather)).toBe(1); // Good 4 rated as a Soft 5
    let calls = 0;
    const wx = weatherSource(() => calls++);

    // 15:30 AEDT, R1's check: the morning rain has been and gone.
    await recheckMeeting(deps({}, at(150), [wx]), pack, job(), 1);
    expect(calls).toBe(1);
    expect(pack.weather).toMatchObject({ fetchedAt: iso(150), rainRaceDayMm: 0 });
    expect(forecastDrift(pack.weather)).toBe(0);
    expect(pack.predictions[1].generatedAt).toBe(iso(150));

    // Less than 30 minutes old: left alone. Older: refreshed again.
    await recheckMeeting(deps({}, at(170), [wx]), pack, job(), 1);
    expect(calls).toBe(1);
    await recheckMeeting(deps({}, at(185), [wx]), pack, job(), 2);
    expect(calls).toBe(2);
    expect(pack.weather?.fetchedAt).toBe(iso(185));
  });

  it('a weather source that fails keeps the earlier forecast, never fails the check and is not asked again within 30 minutes', async () => {
    const pack = rainPack('wx-down');
    const before = pack.weather;
    let calls = 0;
    const wx = weatherSource(() => calls++, true);
    const j = job();
    await recheckMeeting(deps({}, at(150), [wx]), pack, j, 1);
    expect(calls).toBe(1);
    expect(pack.weather).toBe(before);
    expect(j.progress.steps.find((s) => s.key === 'weather')).toMatchObject({ status: 'warn' });
    expect(pack.sourceStatuses.find((s) => s.source === 'wx')).toMatchObject({ ok: false, error: 'HTTP 503' });
    expect(steps(j)).toContain('repredict:done');
    expect(pack.history.at(-1)).toMatchObject({ type: 'recheck', raceNumber: 1 });

    await recheckMeeting(deps({}, at(160), [wx]), pack, job(), 1);
    expect(calls).toBe(1);
    await recheckMeeting(deps({}, at(181), [wx]), pack, job(), 2);
    expect(calls).toBe(2);
  });
});

describe('meeting keys resolved by the sources', () => {
  it('are saved with the pack (an empty one never replaces a known one) and handed back on the next pre-race check and results poll', async () => {
    const seen: string[] = [];
    const base = card('fake', () => 'open');
    const fake: SourceAdapter = {
      ...base,
      capabilities: ['racecard', 'results'],
      fetchMeeting: async (m, c) => ({
        meeting: { ...m, sourceRefs: { ...m.sourceRefs, tab: '', 'fake.key': 'X' }, sources: ['fake'] },
        races: [await base.fetchRace!(m, 1, c), await base.fetchRace!(m, 2, c)],
        source: 'fake',
        fetchedAt: iso(-120),
      }),
      fetchRace: async (m, n, c) => {
        seen.push(`race:${m.sourceRefs['fake.key']}`);
        return base.fetchRace!(m, n, c);
      },
      fetchResults: async (m) => {
        seen.push(`results:${m.sourceRefs['fake.key']}`);
        return null;
      },
    };
    const pack = await researchMeeting(deps({}, at(-120), [fake]), { ...meeting, sourceRefs: { tab: 'R/FLM' } }, job());
    expect(pack.meeting.sourceRefs).toEqual({ tab: 'R/FLM', 'fake.key': 'X' });

    await recheckMeeting(deps({}, at(-30), [fake]), pack, job(), 1);
    await collectAndRerate(deps({}, at(3), [fake]), pack, job(), [1]);
    expect(seen).toEqual(['race:X', 'results:X']);
  });
});

// ---------------------------------------------------------------------------
// A race is scored on the picks it jumped with (review fixes)
// ---------------------------------------------------------------------------

/** A race-card source that answers with the pack's own race (true start time), optionally changed. */
function sameCard(pack: MeetingPack, onCall: (n: number) => void, change: (raw: RaceRaw) => void = () => undefined): SourceAdapter {
  return {
    id: 'card',
    name: 'card',
    kind: 'official',
    capabilities: ['racecard'],
    fetchRace: async (_m, n, c) => {
      onCall(n);
      const r = pack.races.find((x) => x.number === n)!;
      const raw = {
        number: n,
        name: r.name,
        distance: r.distance,
        startTime: r.startTime,
        status: 'open',
        sourceRefs: {},
        runners: r.runners.map((x) => ({ number: x.number, name: x.name, barrier: x.barrier, jockey: x.jockey, trainer: x.trainer, weight: x.weight, scratched: x.scratched })),
        source: 'card',
        fetchedAt: c.now().toISOString(),
      } as RaceRaw;
      change(raw);
      return raw;
    },
  };
}

describe('the picks a race jumped with', () => {
  it('raceJumped: the scheduled start has passed or a feed says run or abandoned; "closed" alone only counts without a start time', () => {
    expect(raceJumped(race(1, 0), at(-0.5))).toBe(false);
    expect(raceJumped(race(1, 0), at(0))).toBe(true);
    for (const status of ['interim', 'final', 'abandoned'] as const) expect(raceJumped(race(1, 10, { status }), at(0))).toBe(true);
    // TAB calls a market suspended minutes before the jump (a late scratching) "closed": still to be re-rated.
    expect(raceJumped(race(1, 10, { status: 'closed' }), at(0))).toBe(false);
    expect(raceJumped(race(1, 0, { status: 'closed', startTime: undefined }), at(0))).toBe(true);
    expect(raceJumped(race(1, 0, { status: 'open', startTime: undefined }), at(0))).toBe(false);
  });

  it('predictAll never re-rates a race that has jumped; one never rated before is rated for display, flagged and never scored', () => {
    const pack = makePack3();
    const r1 = structuredClone(pack.predictions[1]);
    delete pack.predictions[2]; // say R2 was never rated
    predictAll(pack, DEFAULT_SETTINGS, at(45)); // R1 jumped at 0, R2 at 40; R3 is still to run
    expect(pack.predictions[1]).toEqual(r1);
    expect(pack.predictions[2]).toMatchObject({ postJump: true, generatedAt: iso(45) });
    expect(pack.predictions[2].confidence.notes[0]).toBe('Rated after this race had started - shown for reference only, not scored');
    expect(pack.predictions[2].betting.notes[0]).toBe('Rated after this race had started - shown for reference only, not scored');
    expect(pack.predictions[3].generatedAt).toBe(iso(45));
    expect(pack.predictions[3].postJump).toBeUndefined();

    recordResult(pack, 1, { raceNumber: 1, placings: [[2], [1], [3]], recordedAt: iso(46), source: 'a' });
    recordResult(pack, 2, { raceNumber: 2, placings: [[2], [1], [3]], recordedAt: iso(46), source: 'a' });
    expect(pack.results[1].scorecard).toBeDefined();
    expect(pack.results[2].scorecard).toBeUndefined();
    expect(pack.history.find((h) => h.raceNumber === 1)?.summary).toMatch(/our pick ranked \d/);
    expect(pack.history.find((h) => h.raceNumber === 2)?.summary).not.toMatch(/our pick ranked/);
  });

  it('a pre-race check of a race that has jumped refreshes and re-rates nothing, and says so; a whole-card check only touches races still to run', async () => {
    const pack = makePack3();
    const before = structuredClone(pack.predictions);
    const calls: number[] = [];
    const src = () => [sameCard(pack, (n) => calls.push(n))];
    const { changes } = await recheckMeeting(deps({}, at(45), src()), pack, job(), 2);
    expect(calls).toEqual([]);
    expect(changes).toEqual([]);
    expect(pack.predictions).toEqual(before);
    expect(pack.history.at(-1)?.summary).toBe('Pre-race check R2: the race has started - picks left as they were at the jump');

    await recheckMeeting(deps({}, at(46), src()), pack, job());
    expect(calls).toEqual([3]);
    expect(pack.predictions[1]).toEqual(before[1]);
    expect(pack.predictions[2]).toEqual(before[2]);
    expect(pack.predictions[3].generatedAt).toBe(iso(46));
    expect(pack.races[2].fetchedAt).toBe(iso(46));
    expect(pack.races[1].fetchedAt).toBe(iso(-60));
  });

  it('a result that lands after a later race jumped re-rates only the races still to run', async () => {
    const pack = makePack3();
    const before = structuredClone(pack.predictions);
    await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]) }, at(41)), pack, job(), [1], { automatic: true });
    expect(pack.predictions[2]).toEqual(before[2]); // R2 jumped a minute ago
    expect(pack.predictions[3].generatedAt).toBe(iso(41));
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check: R1 result in - Bravo (2) won; R3 re-rated');
  });

  it('keepJumpedPredictions carries the picks of races that have run or jumped, but not over a fresh rating made before the jump', () => {
    const old = makePack3(); // rated at -60
    old.results[1] = { raceNumber: 1, placings: [[2], [1], [3]], recordedAt: iso(5), source: 'a' };
    const fresh = makePack3();
    predictAll(fresh, DEFAULT_SETTINGS, at(39)); // R2 and R3 rated afresh a minute before R2's jump (research ran across it)
    const r2 = structuredClone(fresh.predictions[2]);
    fresh.predictions[1] = { ...fresh.predictions[1], generatedAt: iso(50) }; // R1 rated after it ran
    expect(keepJumpedPredictions(old, fresh, at(50))).toEqual([1]);
    expect(fresh.predictions[1]).toEqual(old.predictions[1]);
    expect(fresh.predictions[2]).toEqual(r2);
    expect(keepJumpedPredictions(undefined, fresh, at(50))).toEqual([]);
  });

  it('dead heats: a horse finishes one place behind the number of horses ahead of it', () => {
    const pack = makePack();
    recordResult(pack, 1, { raceNumber: 1, placings: [[4], [2, 3], [1]], recordedAt: iso(3), source: 'a' });
    const pos = Object.fromEntries(pack.races[0].runners.map((r) => [r.number, r.finishingPosition]));
    expect(pos).toEqual({ 4: 1, 2: 2, 3: 2, 1: 4 });
  });
});
