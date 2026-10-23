import { describe, expect, it } from 'vitest';
import type { FieldAgreement, JobProgress, MeetingPack, MeetingSummary, Race, RaceResult, Runner } from '../../shared/types.js';
import type { FetchContext } from '../adapters/types.js';
import { AdapterRegistry } from '../adapters/registry.js';
import { silentLogger } from '../core/logger.js';
import { DEFAULT_SETTINGS } from '../store/store.js';
import { JobHandle } from './manager.js';
import { buildNewsQueries, collectAndRerate, confirmationChecks, isResultSettled, mergeMeetingSummaries, predictAll, type ResearchDeps } from './research.js';

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

function deps(sources: Record<string, Reporter>, now: Date): ResearchDeps {
  const registry = new AdapterRegistry();
  for (const [id, fn] of Object.entries(sources)) registry.register({ id, name: id, kind: 'official', capabilities: ['results'], fetchResults: async (_m, n) => fn(n) });
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
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(3), attempts: 1, note: 'Confirmed by 2 sources' });
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
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(8), attempts: 4, note: 'One source only' });
    expect(isResultSettled(pack, 1)).toBe(true);
    expect(pack.predictions[2].generatedAt).toBe(rated);
    // The three "no change" checks collapsed into a single history line.
    expect(pack.history.map((h) => h.summary)).toEqual(['Automatic results check: R1 result in - Bravo (2) won; R2 re-rated', 'Automatic results check R1: still from one source (3 checks so far)']);
  });

  it('a second source arriving later confirms the result and settles the watch', async () => {
    const pack = makePack();
    await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]), b: nothing }, at(3)), pack, job(), [1], { automatic: true });
    const rated = pack.predictions[2].generatedAt;
    const out = await collectAndRerate(deps({ a: report('a', [[2], [1], [3]]), b: report('b', [[2], [1], [3]]) }, at(5)), pack, job(), [1], { automatic: true });
    expect(out.newly).toEqual([1]);
    expect(pack.results[1].confirmedBy).toEqual(['a', 'b']);
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(5), attempts: 2, note: 'Confirmed by 2 sources' });
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
    expect(pack.resultWatch?.[1]).toEqual({ lastCheckedAt: iso(9), attempts: 2, note: 'Confirmed by 2 sources' });
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
    const out = await collectAndRerate(deps({ a: report('a', [[3], [4], [1]]), b: report('b', [[3], [4], [1]]) }, at(45)), pack, job(), undefined, { automatic: true });
    expect(out).toEqual({ newly: [1], checked: [1, 2] }); // R2 jumped five minutes ago, no result yet
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check: R1 result in - Charlie (3) won; R2 re-rated');
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
