import { describe, expect, it } from 'vitest';
import type { DayPattern, Race, RaceResult, Runner, SpeedMapPosition, SplitStats } from '@shared/types';
import {
  applyDayPatterns,
  barrierThird,
  detectDayPatterns,
  favouriteNumbers,
  patternBias,
  sampleFactor,
  settlingPosition,
} from './daypatterns.js';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function agree<T>(value: T) {
  return { value, agree: ['test'], disagree: [], confidence: 1 };
}

function runner(number: number, partial: Partial<Runner> = {}): Runner {
  return {
    id: `r${number}`,
    number,
    name: `Horse ${number}`,
    barrier: number,
    scratched: false,
    form: [],
    gearChanges: [],
    comments: [],
    ratings: {},
    odds: [],
    fields: {
      barrier: agree(number),
      jockey: agree(''),
      trainer: agree(''),
      weight: agree(55),
      scratched: agree(false),
      number: agree(number),
    },
    sources: ['test'],
    verification: { score: 1, sourceCount: 1, conflicts: [], checkedFields: 0, agreedFields: 0 },
    news: [],
    ...partial,
  };
}

function field(size: number, make: (n: number) => Partial<Runner> = () => ({})): Runner[] {
  return Array.from({ length: size }, (_, i) => runner(i + 1, make(i + 1)));
}

function race(number: number, runners: Runner[], partial: Partial<Race> = {}): Race {
  return {
    number,
    name: `Race ${number}`,
    distance: 1200,
    status: 'final',
    sourceRefs: {},
    runners,
    sources: ['test'],
    verification: { score: 1, sourceCount: 1, conflicts: [], checkedFields: 0, agreedFields: 0 },
    fieldSize: runners.filter((r) => !r.scratched).length,
    fetchedAt: '2026-10-23T00:00:00Z',
    ...partial,
  };
}

function result(raceNumber: number, placings: number[][]): RaceResult {
  return { raceNumber, placings, recordedAt: '2026-10-23T05:00:00Z', source: 'test' };
}

function resultsFor(races: Race[], winner: (race: Race) => number[]): Record<number, RaceResult> {
  const out: Record<number, RaceResult> = {};
  for (const r of races) {
    const w = winner(r);
    const others = r.runners.map((x) => x.number).filter((n) => !w.includes(n));
    out[r.number] = result(r.number, [w, [others[0]], [others[1]]]);
  }
  return out;
}

function byKey(patterns: DayPattern[], key: string): DayPattern | undefined {
  return patterns.find((p) => p.key === key);
}

/** 10-runner race where runner 1 carries the given speed-map position; everyone else has no pace info. */
function paceRace(number: number, winnerPos: SpeedMapPosition, extra: Partial<Race> = {}): Race {
  return race(
    number,
    field(10, (n) => (n === 1 ? { speedMapPosition: winnerPos, barrier: 6 } : { barrier: n === 1 ? 6 : n })),
    extra,
  );
}

/** Pricing: #1 $2.50 fav, #2 $4, #3 $12, #4 $20, rest $8. */
function marketRace(number: number): Race {
  const price = (n: number) => (n === 1 ? 2.5 : n === 2 ? 4 : n === 3 ? 12 : n === 4 ? 20 : 8);
  return race(
    number,
    field(8, (n) => ({ barrier: 5, market: { bestWin: price(n), quoteCount: 2 } })),
  );
}

const PROVEN_WET: SplitStats = { soft: { starts: 4, wins: 2, seconds: 1, thirds: 0 }, heavy: { starts: 1, wins: 0, seconds: 1, thirds: 0 } };
const UNPROVEN_WET: SplitStats = { soft: { starts: 0, wins: 0, seconds: 0, thirds: 0 }, good: { starts: 6, wins: 2, seconds: 1, thirds: 1 } };

function wetRace(number: number, winnerSplits: SplitStats, trackRating = 7): Race {
  return race(number, field(8, (n) => ({ barrier: 5, splits: n === 1 ? winnerSplits : undefined })), { trackRating });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('sampleFactor', () => {
  it('scales linearly to full weight at four races', () => {
    expect(sampleFactor(0)).toBe(0);
    expect(sampleFactor(1)).toBe(0.25);
    expect(sampleFactor(2)).toBe(0.5);
    expect(sampleFactor(4)).toBe(1);
    expect(sampleFactor(9)).toBe(1);
  });
});

describe('settlingPosition', () => {
  it('prefers the speed map, else the most recent in-running string', () => {
    expect(settlingPosition(runner(1, { speedMapPosition: 'backmarker' }))).toBe('backmarker');
    const form = (date: string, inRunning: string) => ({ date, venue: 'X', distance: 1200, position: 3, starters: 10, inRunning });
    expect(settlingPosition(runner(1, { form: [form('2026-01-01', '9-9-8'), form('2026-03-01', '1-1-1')] }))).toBe('leader');
    expect(settlingPosition(runner(1, { form: [form('2026-03-01', '3-3-2')] }))).toBe('on-pace');
    expect(settlingPosition(runner(1, { form: [form('2026-03-01', '6-5-4')] }))).toBe('midfield');
    expect(settlingPosition(runner(1, { form: [form('2026-03-01', '9-9-8')] }))).toBe('backmarker');
    expect(settlingPosition(runner(1))).toBeUndefined();
  });
});

describe('barrierThird', () => {
  it('splits gates into thirds relative to field size', () => {
    expect(barrierThird(1, 12)).toBe('inside');
    expect(barrierThird(4, 12)).toBe('inside');
    expect(barrierThird(5, 12)).toBe('middle');
    expect(barrierThird(8, 12)).toBe('middle');
    expect(barrierThird(9, 12)).toBe('outside');
    expect(barrierThird(12, 12)).toBe('outside');
    expect(barrierThird(14, 10)).toBe('outside'); // barrier wider than field after scratchings
  });
});

describe('favouriteNumbers', () => {
  it('picks the shortest price and ignores scratchings', () => {
    const r = marketRace(1);
    expect(favouriteNumbers(r)).toEqual([1]);
    r.runners[0].scratched = true;
    expect(favouriteNumbers(r)).toEqual([2]);
  });

  it('falls back to implied probability and returns ties', () => {
    const r = race(1, field(4, (n) => ({ market: { impliedWinProb: n <= 2 ? 0.3 : 0.2, quoteCount: 1 } })));
    expect(favouriteNumbers(r)).toEqual([1, 2]);
    expect(favouriteNumbers(race(2, field(3)))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// detectDayPatterns
// ---------------------------------------------------------------------------

describe('detectDayPatterns', () => {
  it('returns [] with no results, or fewer than minRaces', () => {
    const races = [paceRace(1, 'leader'), paceRace(2, 'leader')];
    expect(detectDayPatterns(races, {})).toEqual([]);
    expect(detectDayPatterns(races, { 1: result(1, [[1], [2], [3]]) }, { minRaces: 2 })).toEqual([]);
    expect(detectDayPatterns(races, { 1: result(1, [[1], [2], [3]]) }, { minRaces: 1 }).length).toBeGreaterThan(0);
  });

  it('ignores results whose race or winner cannot be joined', () => {
    const races = [paceRace(1, 'leader')];
    expect(detectDayPatterns(races, { 7: result(7, [[1]]) })).toEqual([]);
    expect(detectDayPatterns(races, { 1: result(1, [[99]]) })).toEqual([]);
    expect(detectDayPatterns(races, { 1: result(1, []) })).toEqual([]);
  });

  describe('pace', () => {
    it('reports a weak on-pace bias from a single race and a strong one from four', () => {
      const one = detectDayPatterns([paceRace(1, 'leader')], resultsFor([paceRace(1, 'leader')], () => [1]));
      const p1 = byKey(one, 'on-pace-bias');
      expect(p1).toBeDefined();
      expect(p1!.strength).toBe(0.25);
      expect(p1!.basedOnRaces).toEqual([1]);
      expect(p1!.detail).toBe('1 of 1 winner led or raced on-pace (R1)');
      expect(p1!.adjust).toEqual({ factorKey: 'pace', multiplier: 1.2 });

      const races = [paceRace(1, 'leader'), paceRace(2, 'on-pace'), paceRace(3, 'leader'), paceRace(4, 'on-pace')];
      const four = detectDayPatterns(races, resultsFor(races, () => [1]));
      const p4 = byKey(four, 'on-pace-bias');
      expect(p4!.strength).toBe(1);
      expect(p4!.adjust).toEqual({ factorKey: 'pace', multiplier: 1.8 });
      expect(p4!.detail).toBe('4 of 4 winners led or raced on-pace (R1, R2, R3, R4)');
      expect(p4!.strength).toBeGreaterThan(p1!.strength);
    });

    it('scales with the share of winners: 3 of 4 is half strength', () => {
      const races = [paceRace(1, 'leader'), paceRace(2, 'leader'), paceRace(3, 'backmarker'), paceRace(4, 'on-pace')];
      const p = byKey(detectDayPatterns(races, resultsFor(races, () => [1])), 'on-pace-bias');
      expect(p!.strength).toBe(0.5);
      expect(p!.detail).toBe('3 of 4 winners led or raced on-pace (R1, R2, R4)');
      expect(p!.adjust).toEqual({ factorKey: 'pace', multiplier: 1.4 });
    });

    it('reports a backmarker bias with a multiplier below 1', () => {
      const races = [paceRace(1, 'backmarker'), paceRace(2, 'midfield'), paceRace(3, 'backmarker'), paceRace(4, 'backmarker')];
      const patterns = detectDayPatterns(races, resultsFor(races, () => [1]));
      const p = byKey(patterns, 'backmarker-bias');
      expect(p).toBeDefined();
      expect(p!.strength).toBe(1);
      expect(p!.adjust).toEqual({ factorKey: 'pace', multiplier: 0.5 });
      expect(p!.detail).toContain('4 of 4 winners came from midfield or worse');
      expect(byKey(patterns, 'on-pace-bias')).toBeUndefined();
    });

    it('reports nothing when the signal is mixed', () => {
      const races = [paceRace(1, 'leader'), paceRace(2, 'backmarker'), paceRace(3, 'on-pace'), paceRace(4, 'midfield')];
      const patterns = detectDayPatterns(races, resultsFor(races, () => [1]));
      expect(byKey(patterns, 'on-pace-bias')).toBeUndefined();
      expect(byKey(patterns, 'backmarker-bias')).toBeUndefined();
    });

    it('uses the in-running proxy when no speed map is supplied, and skips runners with neither', () => {
      const withForm = race(
        1,
        field(10, (n) =>
          n === 1
            ? { form: [{ date: '2026-09-01', venue: 'X', distance: 1200, position: 1, starters: 12, inRunning: '1-1-1' }] }
            : {},
        ),
      );
      const p = byKey(detectDayPatterns([withForm], resultsFor([withForm], () => [1])), 'on-pace-bias');
      expect(p?.strength).toBe(0.25);

      const noInfo = race(2, field(10));
      const none = detectDayPatterns([noInfo], resultsFor([noInfo], () => [1]));
      expect(byKey(none, 'on-pace-bias')).toBeUndefined();
      expect(byKey(none, 'backmarker-bias')).toBeUndefined();
    });

    it('mentions placegetters when their positions are known', () => {
      const r = race(1, field(10, (n) => ({ speedMapPosition: n <= 3 ? 'leader' : 'backmarker', barrier: 5 })));
      const p = byKey(detectDayPatterns([r], resultsFor([r], () => [1])), 'on-pace-bias');
      expect(p!.detail).toBe('1 of 1 winner led or raced on-pace (R1); 2 of 2 other placegetters raced on-pace');
    });
  });

  describe('barriers', () => {
    const twelve = (number: number) => race(number, field(12, (n) => ({ barrier: n })));

    it('detects an inside bias that strengthens with more races', () => {
      const one = byKey(detectDayPatterns([twelve(1)], resultsFor([twelve(1)], () => [1])), 'inside-barrier-bias');
      expect(one!.strength).toBe(0.25);
      expect(one!.adjust).toEqual({ bias: 'inside', weight: 0.25 });

      const races = [twelve(1), twelve(2), twelve(3), twelve(4)];
      const winners: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4 };
      const four = byKey(detectDayPatterns(races, resultsFor(races, (r) => [winners[r.number]])), 'inside-barrier-bias');
      expect(four!.strength).toBe(1);
      expect(four!.detail).toBe('4 of 4 winners jumped from the inside third of the gates (R1, R2, R3, R4)');
      expect(four!.basedOnRaces).toEqual([1, 2, 3, 4]);
    });

    it('detects an outside bias and gives 3 of 4 a partial strength', () => {
      const races = [twelve(1), twelve(2), twelve(3), twelve(4)];
      const winners: Record<number, number> = { 1: 12, 2: 10, 3: 6, 4: 9 };
      const patterns = detectDayPatterns(races, resultsFor(races, (r) => [winners[r.number]]));
      const p = byKey(patterns, 'outside-barrier-bias');
      expect(p).toBeDefined();
      expect(p!.strength).toBe(0.63); // ((0.75 - 1/3) / (2/3)) * 1
      expect(p!.adjust).toEqual({ bias: 'outside', weight: 0.63 });
      expect(byKey(patterns, 'inside-barrier-bias')).toBeUndefined();
    });

    it('reports nothing for a mixed spread or a tiny field', () => {
      const races = [twelve(1), twelve(2), twelve(3), twelve(4)];
      const winners: Record<number, number> = { 1: 1, 2: 12, 3: 6, 4: 7 };
      const mixed = detectDayPatterns(races, resultsFor(races, (r) => [winners[r.number]]));
      expect(byKey(mixed, 'inside-barrier-bias')).toBeUndefined();
      expect(byKey(mixed, 'outside-barrier-bias')).toBeUndefined();

      const small = race(1, field(5));
      expect(byKey(detectDayPatterns([small], resultsFor([small], () => [1])), 'inside-barrier-bias')).toBeUndefined();
    });
  });

  describe('market', () => {
    it("flags a favourites' day with sample scaling", () => {
      const one = byKey(detectDayPatterns([marketRace(1)], resultsFor([marketRace(1)], () => [1])), 'favourites-day');
      expect(one!.strength).toBe(0.25);
      expect(one!.detail).toBe('1 of 1 winner was the pre-race favourite (R1)');

      const races = [marketRace(1), marketRace(2), marketRace(3), marketRace(4)];
      const four = byKey(detectDayPatterns(races, resultsFor(races, () => [1])), 'favourites-day');
      expect(four!.strength).toBe(1);
      expect(four!.adjust).toEqual({ bias: 'favourites', weight: 1 });
      expect(four!.detail).toBe('4 of 4 winners were the pre-race favourite (R1, R2, R3, R4)');
    });

    it("flags a roughies' day when $10+ winners dominate", () => {
      const races = [marketRace(1), marketRace(2), marketRace(3), marketRace(4)];
      const winners: Record<number, number> = { 1: 3, 2: 4, 3: 3, 4: 1 };
      const patterns = detectDayPatterns(races, resultsFor(races, (r) => [winners[r.number]]));
      const p = byKey(patterns, 'roughies-day');
      expect(p).toBeDefined();
      expect(p!.strength).toBe(0.71); // (0.75 - 0.15) / 0.85
      expect(p!.adjust).toEqual({ bias: 'roughies', weight: 0.71 });
      expect(p!.detail).toBe('3 of 4 winners started at $10 or longer (R1, R2, R3)');
      expect(byKey(patterns, 'favourites-day')).toBeUndefined();
    });

    it('reports nothing for a mixed market, or without any prices', () => {
      const races = [marketRace(1), marketRace(2), marketRace(3), marketRace(4)];
      const winners: Record<number, number> = { 1: 1, 2: 1, 3: 3, 4: 5 }; // 2 favs, 1 roughie, 1 mid-price
      const patterns = detectDayPatterns(races, resultsFor(races, (r) => [winners[r.number]]));
      expect(byKey(patterns, 'favourites-day')).toBeUndefined();
      expect(byKey(patterns, 'roughies-day')).toBeUndefined();

      const unpriced = race(1, field(8));
      const none = detectDayPatterns([unpriced], resultsFor([unpriced], () => [1]));
      expect(byKey(none, 'favourites-day')).toBeUndefined();
    });
  });

  describe('wet-track form', () => {
    it('rewards proven wet-trackers winning on a soft track', () => {
      const one = byKey(detectDayPatterns([wetRace(1, PROVEN_WET)], resultsFor([wetRace(1, PROVEN_WET)], () => [1])), 'wet-track-form');
      expect(one).toBeDefined();
      expect(one!.strength).toBe(0.25);
      expect(one!.adjust).toEqual({ factorKey: 'wetForm', multiplier: 1.2 });

      const races = [1, 2, 3, 4].map((n) => wetRace(n, PROVEN_WET));
      const four = byKey(detectDayPatterns(races, resultsFor(races, () => [1])), 'wet-track-form');
      expect(four!.strength).toBe(1);
      expect(four!.adjust).toEqual({ factorKey: 'wetForm', multiplier: 1.8 });
      expect(four!.detail).toBe('4 of 4 winners on the Soft 7 track had proven soft/heavy form (R1, R2, R3, R4)');
    });

    it('does not fire on a good track, with unproven winners, or without split data', () => {
      const dry = wetRace(1, PROVEN_WET, 4);
      expect(byKey(detectDayPatterns([dry], resultsFor([dry], () => [1])), 'wet-track-form')).toBeUndefined();

      const races = [wetRace(1, UNPROVEN_WET), wetRace(2, UNPROVEN_WET), wetRace(3, PROVEN_WET), wetRace(4, UNPROVEN_WET)];
      expect(byKey(detectDayPatterns(races, resultsFor(races, () => [1])), 'wet-track-form')).toBeUndefined();

      const noSplits = race(1, field(8), { trackRating: 8 });
      expect(byKey(detectDayPatterns([noSplits], resultsFor([noSplits], () => [1])), 'wet-track-form')).toBeUndefined();
    });

    it('parses the track condition string when no numeric rating is given', () => {
      const r = wetRace(1, PROVEN_WET);
      r.trackRating = undefined;
      r.trackCondition = 'Soft 6';
      expect(byKey(detectDayPatterns([r], resultsFor([r], () => [1])), 'wet-track-form')).toBeDefined();
    });
  });

  describe('track drift', () => {
    it('is informational, with no adjust, listing where the rating changed', () => {
      const races = [
        race(1, field(8), { trackRating: 4 }),
        race(2, field(8), { trackRating: 4 }),
        race(3, field(8), { trackRating: 5 }),
        race(4, field(8), { trackRating: 6 }),
      ];
      const patterns = detectDayPatterns(races, { 1: result(1, [[1], [2], [3]]) });
      const p = byKey(patterns, 'track-drift');
      expect(p).toBeDefined();
      expect(p!.adjust).toBeUndefined();
      expect(p!.label).toBe('Track getting softer');
      expect(p!.detail).toBe('Track rating moved from Good 4 (R1) to Soft 6 (R4)');
      expect(p!.basedOnRaces).toEqual([3, 4]);
      expect(p!.strength).toBe(0.67);
    });

    it('reports drying out and stays silent for a constant rating', () => {
      const drying = [race(1, field(8), { trackRating: 8 }), race(2, field(8), { trackRating: 6 })];
      expect(byKey(detectDayPatterns(drying, { 1: result(1, [[1]]) }), 'track-drift')!.label).toBe('Track drying out');

      const constant = [race(1, field(8), { trackRating: 4 }), race(2, field(8), { trackRating: 4 })];
      expect(byKey(detectDayPatterns(constant, { 1: result(1, [[1]]) }), 'track-drift')).toBeUndefined();
    });

    it('is still gated by the results requirement', () => {
      const races = [race(1, field(8), { trackRating: 4 }), race(2, field(8), { trackRating: 7 })];
      expect(detectDayPatterns(races, {})).toEqual([]);
    });
  });

  it('returns nothing at all for a thoroughly mixed card', () => {
    const races = [1, 2, 3, 4].map((n) =>
      race(
        n,
        field(12, (k) => ({
          barrier: k, // winners 6 and 7 sit in the middle third
          speedMapPosition: k === 6 ? 'leader' : k === 7 ? 'backmarker' : undefined,
          market: { bestWin: k === 6 || k === 7 ? 6 : 5, quoteCount: 1 }, // #1-#5 share favouritism at $5
        })),
        { trackRating: 4 },
      ),
    );
    const results = resultsFor(races, (r) => [r.number % 2 === 0 ? 6 : 7]);
    expect(detectDayPatterns(races, results)).toEqual([]);
  });

  it('sorts patterns by strength, strongest first', () => {
    const races = [1, 2, 3, 4].map((n) => paceRace(n, 'leader', { trackRating: n === 4 ? 5 : 4 }));
    const patterns = detectDayPatterns(races, resultsFor(races, () => [1]));
    expect(patterns.length).toBeGreaterThan(1);
    for (let i = 1; i < patterns.length; i++) expect(patterns[i - 1].strength).toBeGreaterThanOrEqual(patterns[i].strength);
    expect(patterns[0].key).toBe('on-pace-bias');
  });

  it('handles dead-heat winners by counting both horses', () => {
    const r = race(1, field(10, (n) => ({ speedMapPosition: n === 1 ? 'leader' : n === 2 ? 'leader' : undefined, barrier: 5 })));
    const p = byKey(detectDayPatterns([r], { 1: result(1, [[1, 2], [3]]) }), 'on-pace-bias');
    expect(p!.detail).toBe('2 of 2 winners led or raced on-pace (R1)');
    expect(p!.strength).toBe(0.25);
  });
});

// ---------------------------------------------------------------------------
// applyDayPatterns
// ---------------------------------------------------------------------------

describe('applyDayPatterns', () => {
  const pattern = (adjust: DayPattern['adjust'], key = 'x'): DayPattern => ({ key, label: key, detail: '', strength: 0.5, basedOnRaces: [1], adjust });

  it('multiplies matching factor weights and leaves the rest alone', () => {
    const base = { pace: 1, wetForm: 0.8, form: 1 };
    const out = applyDayPatterns(base, [
      pattern({ factorKey: 'pace', multiplier: 1.4 }),
      pattern({ factorKey: 'wetForm', multiplier: 2.5 }), // clamped to 1.8
      pattern({ factorKey: 'speed', multiplier: 1.5 }), // not in base: ignored
      pattern({ bias: 'inside', weight: 1 }), // bias patterns do not touch weights
    ]);
    expect(out).toEqual({ pace: 1.4, wetForm: 1.44, form: 1 });
    expect(base).toEqual({ pace: 1, wetForm: 0.8, form: 1 }); // not mutated
  });

  it('clamps the combined multiplier per key to 0.5..1.8', () => {
    const up = applyDayPatterns({ pace: 1 }, [pattern({ factorKey: 'pace', multiplier: 1.5 }), pattern({ factorKey: 'pace', multiplier: 1.5 })]);
    expect(up.pace).toBe(1.8);
    const down = applyDayPatterns({ pace: 2 }, [pattern({ factorKey: 'pace', multiplier: 0.1 })]);
    expect(down.pace).toBe(1);
  });

  it('is the identity with no patterns', () => {
    expect(applyDayPatterns({ pace: 1.2 }, [])).toEqual({ pace: 1.2 });
  });
});

// ---------------------------------------------------------------------------
// patternBias
// ---------------------------------------------------------------------------

describe('patternBias', () => {
  const bias = (b: 'inside' | 'outside' | 'leaders' | 'backmarkers' | 'favourites' | 'roughies', weight: number): DayPattern => ({
    key: b,
    label: b,
    detail: '',
    strength: weight,
    basedOnRaces: [1],
    adjust: { bias: b, weight },
  });

  it('favours the rail under an inside bias and penalises wide gates', () => {
    expect(patternBias([bias('inside', 1)], runner(1, { barrier: 1 }), 12)).toBe(0.35);
    expect(patternBias([bias('inside', 1)], runner(1, { barrier: 12 }), 12)).toBe(-0.35);
    expect(Math.abs(patternBias([bias('inside', 1)], runner(1, { barrier: 6 }), 12))).toBeLessThan(0.05);
    expect(patternBias([bias('inside', 0.5)], runner(1, { barrier: 1 }), 12)).toBe(0.175);
    expect(patternBias([bias('outside', 1)], runner(1, { barrier: 12 }), 12)).toBe(0.35);
    expect(patternBias([bias('inside', 1)], runner(1, { barrier: undefined }), 12)).toBe(0);
  });

  it("rewards short-priced runners on a favourites' day and long-priced ones on a roughies' day", () => {
    const fav = runner(1, { market: { impliedWinProb: 0.4, quoteCount: 1 } });
    const rough = runner(2, { market: { impliedWinProb: 0.05, quoteCount: 1 } });
    const mid = runner(3, { market: { bestWin: 6, quoteCount: 1 } });
    expect(patternBias([bias('favourites', 1)], fav, 10)).toBe(0.35);
    expect(patternBias([bias('favourites', 1)], rough, 10)).toBe(-0.35);
    expect(patternBias([bias('favourites', 1)], mid, 10)).toBe(0);
    expect(patternBias([bias('roughies', 1)], rough, 10)).toBe(0.35);
    expect(patternBias([bias('roughies', 1)], fav, 10)).toBe(-0.35);
    expect(patternBias([bias('favourites', 1)], runner(4), 10)).toBe(0);
  });

  it('handles leader/backmarker biases through the settling position', () => {
    expect(patternBias([bias('leaders', 1)], runner(1, { speedMapPosition: 'leader' }), 10)).toBe(0.35);
    expect(patternBias([bias('backmarkers', 1)], runner(1, { speedMapPosition: 'leader' }), 10)).toBe(-0.35);
    expect(patternBias([bias('leaders', 1)], runner(1), 10)).toBe(0);
  });

  it('clamps the combined bias to +/-0.35 and ignores factor-key patterns', () => {
    const r = runner(1, { barrier: 1, market: { impliedWinProb: 0.4, quoteCount: 1 } });
    expect(patternBias([bias('inside', 1), bias('favourites', 1)], r, 12)).toBe(0.35);
    const factorOnly: DayPattern = { key: 'p', label: '', detail: '', strength: 1, basedOnRaces: [], adjust: { factorKey: 'pace', multiplier: 1.8 } };
    expect(patternBias([factorOnly], r, 12)).toBe(0);
    expect(patternBias([], r, 12)).toBe(0);
  });
});
