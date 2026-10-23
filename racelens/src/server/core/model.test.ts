import { describe, expect, it } from 'vitest';
import type { FormLine, Race, Runner, Settings } from '../../shared/types.js';
import { diffPredictions, predictRace, rng, simulateOrders, softmax, spearman, strengthFromFactors } from './model.js';
import { runQuality, classLevel, barrier as barrierFactor, computeFieldStats, inferPosition } from './factors.js';
import { buildBettingPlan, combinations, kellyFraction, permutations, placeSlots } from './betting.js';
import { DEFAULT_SETTINGS } from '../store/store.js';

const settings: Settings = { ...DEFAULT_SETTINGS, bankroll: 500, unitAmount: 10, riskProfile: 'balanced' };

function fa<T>(value: T | undefined, sources = ['official', 'form']) {
  return { value, agree: sources, disagree: [], confidence: sources.length >= 2 ? 0.8 : 0.55 };
}

function form(n: number, positions: number[], opts: Partial<FormLine> = {}): FormLine[] {
  return positions.map((p, i) => ({
    date: new Date(Date.UTC(2026, 9, 10 - i * 21)).toISOString().slice(0, 10),
    venue: i % 2 ? 'Caulfield' : 'Flemington',
    distance: 1400 + (i % 2) * 200,
    trackCondition: 'Good 4',
    trackRating: 4,
    position: p,
    starters: 12,
    margin: p === 1 ? 0 : p * 0.8,
    weight: 56 + (n % 3),
    barrier: 1 + ((n + i) % 12),
    jockey: 'J. Rider',
    raceClass: 'BM78',
    prize: 60000,
    startingPrice: 3 + p,
    inRunning: `${1 + ((n + i) % 6)}-${1 + ((n + i) % 6)}`,
    ...opts,
  }));
}

export function makeRunner(n: number, over: Partial<Runner> = {}): Runner {
  const base: Runner = {
    id: `horse-${n}`,
    number: n,
    name: `Horse ${n}`,
    barrier: n,
    jockey: 'Jockey ' + n,
    trainer: 'Trainer ' + n,
    weight: 56,
    scratched: false,
    age: 4,
    sex: 'G',
    form: form(n, [n, n + 1, Math.max(1, n - 1), n, n + 2].map((p) => Math.min(12, Math.max(1, p)))),
    career: { starts: 10, wins: Math.max(0, 5 - n), seconds: 2, thirds: 1 },
    splits: { good: { starts: 6, wins: Math.max(0, 3 - Math.floor(n / 2)), seconds: 1, thirds: 1 }, soft: { starts: 2, wins: n === 3 ? 2 : 0, seconds: 0, thirds: 0 } },
    daysSinceLastRun: 21,
    gearChanges: [],
    comments: [],
    ratings: { demoRating: 100 - n * 3 },
    speedMapPosition: n <= 2 ? 'leader' : n <= 5 ? 'on-pace' : n <= 8 ? 'midfield' : 'backmarker',
    odds: [
      { source: 'odds-a', bookmaker: 'BookieA', type: 'fixed', win: 2 + n * 1.5, place: 1.2 + n * 0.3, opening: 2.2 + n * 1.5, fetchedAt: 't' },
      { source: 'odds-b', bookmaker: 'BookieB', type: 'fixed', win: 2.1 + n * 1.5, place: 1.25 + n * 0.3, fetchedAt: 't' },
    ],
    fields: { barrier: fa(n), jockey: fa('Jockey ' + n), trainer: fa('Trainer ' + n), weight: fa(56), scratched: fa(false), number: fa(n) },
    sources: ['official', 'form', 'odds-a', 'odds-b'],
    verification: { score: 0.9, sourceCount: 4, conflicts: [], checkedFields: 6, agreedFields: 6 },
    news: [],
  };
  return { ...base, ...over };
}

export function makeRace(n = 10, over: Partial<Race> = {}): Race {
  const runners = Array.from({ length: n }, (_, i) => makeRunner(i + 1));
  return {
    number: 5,
    name: 'Test Handicap',
    distance: 1600,
    startTime: '2026-10-24T04:30:00.000Z',
    raceClass: 'BM78 Handicap',
    prize: 60000,
    status: 'open',
    sourceRefs: {},
    runners,
    sources: ['official', 'form', 'odds-a', 'odds-b'],
    verification: { score: 0.9, sourceCount: 4, conflicts: [], checkedFields: 60, agreedFields: 58 },
    fieldSize: runners.filter((r) => !r.scratched).length,
    fetchedAt: '2026-10-24T03:00:00.000Z',
    trackRating: 4,
    ...over,
  };
}

const NOW = new Date('2026-10-24T03:10:00.000Z');

describe('maths helpers', () => {
  it('softmax sums to 1 and is monotone', () => {
    const p = softmax([1, 2, 3]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(p[2]).toBeGreaterThan(p[1]);
    expect(softmax([])).toEqual([]);
  });
  it('rng is deterministic', () => {
    const a = rng(1);
    const b = rng(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('simulateOrders reproduces win probabilities and sensible place probabilities', () => {
    const probs = [0.5, 0.3, 0.15, 0.05];
    const s = simulateOrders(probs, 20000, 3);
    expect(s.win[0]).toBeCloseTo(0.5, 1);
    expect(s.win[3]).toBeCloseTo(0.05, 1);
    // 4 runners: place = top 1 only (fewer than 5 runners)
    expect(s.place[0]).toBeCloseTo(s.win[0], 2);
    expect(s.expectedFinish[0]).toBeLessThan(s.expectedFinish[3]);
    const s8 = simulateOrders([0.3, 0.2, 0.15, 0.1, 0.1, 0.05, 0.05, 0.05], 5000, 1);
    expect(s8.place[0]).toBeGreaterThan(s8.win[0]);
    expect(s8.place.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 1);
    expect(s8.top6.reduce((a, b) => a + b, 0)).toBeCloseTo(6, 1);
  });
  it('spearman handles perfect and reversed orderings', () => {
    expect(spearman([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });
  it('strengthFromFactors shrinks toward zero when little data backs the view', () => {
    const strong = strengthFromFactors([{ key: 'a', label: 'a', score: 0.8, weight: 1, contribution: 0.8, dataQuality: 1 }, { key: 'b', label: 'b', score: 0.8, weight: 1, contribution: 0.8, dataQuality: 1 }, { key: 'c', label: 'c', score: 0.8, weight: 1, contribution: 0.8, dataQuality: 1 }, { key: 'd', label: 'd', score: 0.8, weight: 1, contribution: 0.8, dataQuality: 1 }]);
    const weak = strengthFromFactors([{ key: 'a', label: 'a', score: 0.8, weight: 1, contribution: 0.8, dataQuality: 0.2 }]);
    expect(strong.strength).toBeGreaterThan(weak.strength);
    expect(strong.completeness).toBe(1);
    expect(weak.completeness).toBe(0);
  });
});

describe('factors', () => {
  it('runQuality rewards wins and close seconds, punishes thrashings', () => {
    expect(runQuality({ position: 1, starters: 12 })).toBe(1);
    expect(runQuality({ position: 2, starters: 12, margin: 0.5 })).toBeGreaterThan(runQuality({ position: 2, starters: 12, margin: 4 }));
    expect(runQuality({ position: 11, starters: 12, margin: 9 })).toBeLessThan(-0.4);
  });
  it('classLevel parses group races, benchmarks and maidens', () => {
    expect(classLevel('Group 1')).toBe(9);
    expect(classLevel('G3')).toBe(7);
    expect(classLevel('BM78 Handicap')).toBe(4.5);
    expect(classLevel('Maiden Plate')).toBe(1);
    expect(classLevel(undefined, 2_000_000)).toBe(9);
  });
  it('barrier factor favours inside draws in sprints and softens at Flemington straight', () => {
    const race = makeRace(14, { distance: 1200 });
    const ctx = { race, venueSlug: 'caulfield', news: [], now: NOW, fieldStats: computeFieldStats(race) };
    const inside = barrierFactor(makeRunner(1), ctx).score;
    const wide = barrierFactor(makeRunner(14, { barrier: 14 }), ctx).score;
    expect(inside).toBeGreaterThan(0);
    expect(wide).toBeLessThan(-0.3);
    const straight = barrierFactor(makeRunner(14, { barrier: 14 }), { ...ctx, venueSlug: 'flemington' }).score;
    expect(Math.abs(straight)).toBeLessThan(Math.abs(wide));
  });
  it('inferPosition reads settling positions', () => {
    expect(inferPosition(makeRunner(1, { form: form(1, [1, 1], { inRunning: '1-1' }) }))).toBe('leader');
    expect(inferPosition(makeRunner(1, { form: form(1, [1, 1], { inRunning: '11-10', starters: 12 }) }))).toBe('backmarker');
    expect(inferPosition(makeRunner(1, { form: [] }))).toBeUndefined();
  });
});

describe('predictRace', () => {
  it('produces a complete, consistent prediction', () => {
    const race = makeRace(12);
    const p = predictRace(race, { venueSlug: 'flemington', settings, now: NOW, simulations: 2000 });
    expect(p.ranked).toHaveLength(12);
    expect(p.top).toHaveLength(6);
    expect(p.ranked.reduce((a, r) => a + r.winProb, 0)).toBeCloseTo(1, 2);
    expect(p.ranked[0].rank).toBe(1);
    expect(p.ranked[0].winProb).toBeGreaterThanOrEqual(p.ranked[1].winProb);
    // Horse 1 has the best form, prices and ratings – it should be on top.
    expect(p.top[0].number).toBe(1);
    expect(p.confidence.overall).toBeGreaterThan(0);
    expect(p.confidence.overall).toBeLessThanOrEqual(100);
    expect(['Low', 'Fair', 'Good', 'High']).toContain(p.confidence.label);
    expect(p.betting.suggestions.length).toBeGreaterThan(0);
    expect(p.summary).toContain('Horse 1');
    for (const r of p.ranked) {
      expect(r.factors.length).toBe(16);
      expect(r.fairOdds).toBeGreaterThan(1);
      expect(r.placeProb).toBeGreaterThanOrEqual(r.winProb - 0.02);
    }
  });

  it('excludes scratched runners and still works without any market', () => {
    const race = makeRace(8);
    race.runners[0].scratched = true;
    race.runners.forEach((r) => (r.odds = []));
    race.fieldSize = 7;
    const p = predictRace(race, { venueSlug: 'flemington', settings, now: NOW, simulations: 1000 });
    expect(p.ranked.some((r) => r.number === 1)).toBe(false);
    expect(p.ranked).toHaveLength(7);
    expect(p.ranked.every((r) => r.marketWinProb === undefined)).toBe(true);
    expect(p.confidence.notes.join(' ')).toMatch(/market/i);
  });

  it('is deterministic for the same inputs', () => {
    const race = makeRace(10);
    const a = predictRace(race, { venueSlug: 'flemington', settings, now: NOW, simulations: 1500 });
    const b = predictRace(race, { venueSlug: 'flemington', settings, now: NOW, simulations: 1500 });
    expect(a.ranked.map((r) => [r.number, r.winProb, r.placeProb])).toEqual(b.ranked.map((r) => [r.number, r.winProb, r.placeProb]));
  });

  it('lowers confidence when sources disagree and data is thin', () => {
    const good = predictRace(makeRace(10), { venueSlug: 'flemington', settings, now: NOW, simulations: 1000 });
    const thin = makeRace(10, { verification: { score: 0.4, sourceCount: 1, conflicts: ['x'], checkedFields: 10, agreedFields: 4 } });
    thin.runners.forEach((r) => {
      r.form = [];
      r.career = undefined;
      r.splits = undefined;
      r.ratings = {};
      r.verification = { score: 0.4, sourceCount: 1, conflicts: [], checkedFields: 2, agreedFields: 2 };
    });
    const bad = predictRace(thin, { venueSlug: 'flemington', settings, now: NOW, simulations: 1000 });
    expect(bad.confidence.overall).toBeLessThan(good.confidence.overall);
    expect(bad.confidence.components.dataCompleteness).toBeLessThan(good.confidence.components.dataCompleteness);
  });

  it('reports changes versus a previous prediction', () => {
    const race = makeRace(10);
    const first = predictRace(race, { venueSlug: 'flemington', settings, now: NOW, simulations: 1000 });
    const changed = makeRace(10);
    changed.runners[0].scratched = true;
    changed.fieldSize = 9;
    const second = predictRace(changed, { venueSlug: 'flemington', settings, now: NOW, simulations: 1000, previous: first });
    expect(second.changes).toBeDefined();
    expect(second.changes!.some((c) => /scratched/.test(c))).toBe(true);
    expect(second.changes!.some((c) => /Top pick changed/.test(c))).toBe(true);
    expect(diffPredictions(first, first, race)).toEqual([]);
  });

  it('applies day patterns and records them', () => {
    const race = makeRace(10);
    const p = predictRace(race, {
      venueSlug: 'flemington',
      settings,
      now: NOW,
      simulations: 1000,
      dayPatterns: [{ key: 'on-pace-bias', label: 'On-pace bias', detail: '3 of 4 winners led', strength: 0.8, basedOnRaces: [1, 2, 3, 4], adjust: { factorKey: 'pace', multiplier: 1.5 } }],
    });
    expect(p.dayPatternsApplied).toHaveLength(1);
    const paceWeight = p.ranked[0].factors.find((f) => f.key === 'pace')!.weight;
    expect(paceWeight).toBeGreaterThan(0.55);
  });
});

describe('betting plan', () => {
  it('helpers', () => {
    expect(placeSlots(12)).toBe(3);
    expect(placeSlots(6)).toBe(2);
    expect(placeSlots(4)).toBe(0);
    expect(kellyFraction(0.5, 3)).toBeCloseTo(0.25);
    expect(kellyFraction(0.1, 3)).toBe(0);
    expect(combinations(4, 2)).toBe(6);
    expect(permutations(4, 3)).toBe(24);
  });

  it('skips when confidence is low and bets when high', () => {
    const race = makeRace(10);
    const p = predictRace(race, { venueSlug: 'flemington', settings, now: NOW, simulations: 1000 });
    const low = buildBettingPlan({ race, ranked: p.ranked, confidence: { ...p.confidence, overall: 20, label: 'Low' }, settings });
    expect(low.stance).toBe('skip');
    expect(low.suggestions).toHaveLength(0);
    const high = buildBettingPlan({ race, ranked: p.ranked, confidence: { ...p.confidence, overall: 80, label: 'High' }, settings });
    expect(high.stance).toBe('bet');
    expect(high.suggestions.some((s) => s.type === 'win' || s.type === 'each-way')).toBe(true);
    expect(high.totalAmount).toBeLessThanOrEqual(3 * 10 * 2 + 0.01); // never beyond profile cap (each-way doubles)
    expect(high.notes.join(' ')).toMatch(/Gambling Help/);
    const trifecta = high.suggestions.find((s) => s.type === 'trifecta');
    expect(trifecta?.combinations).toBe(24);
    expect(trifecta?.flexiPct).toBeGreaterThan(0);
  });

  it('respects risk profiles and small fields', () => {
    const race = makeRace(6);
    const p = predictRace(race, { venueSlug: 'flemington', settings, now: NOW, simulations: 1000 });
    const cons = buildBettingPlan({ race, ranked: p.ranked, confidence: { ...p.confidence, overall: 80, label: 'High' }, settings: { ...settings, riskProfile: 'conservative' } });
    const aggr = buildBettingPlan({ race, ranked: p.ranked, confidence: { ...p.confidence, overall: 80, label: 'High' }, settings: { ...settings, riskProfile: 'aggressive' } });
    expect(cons.totalAmount).toBeLessThan(aggr.totalAmount);
    expect(cons.suggestions.some((s) => s.type === 'trifecta')).toBe(false);
    expect(cons.notes.join(' ')).toMatch(/first two/);
    expect(aggr.suggestions.some((s) => s.type === 'first4')).toBe(false); // needs 8+ runners
  });
});

describe('honesty rules', () => {
  it('caps the confidence label when the top pick is weak and downgrades empty betting stances', () => {
    const race = makeRace(16, { distance: 1200 });
    // Flatten the field: identical form, odds and ratings so nobody stands out.
    race.runners.forEach((r, i) => {
      r.form = form(i + 1, [4, 5, 4, 6, 5]);
      r.career = { starts: 10, wins: 1, seconds: 2, thirds: 2 };
      r.ratings = { demoRating: 80 };
      r.odds = [{ source: 'a', bookmaker: 'A', type: 'fixed', win: 14, place: 4, fetchedAt: 't' }];
      r.speedMapPosition = 'midfield';
    });
    const p = predictRace(race, { venueSlug: 'flemington', settings, now: NOW, simulations: 1500 });
    expect(p.top[0].winProb).toBeLessThan(0.25);
    expect(p.confidence.overall).toBeLessThanOrEqual(61);
    expect(['Low', 'Fair']).toContain(p.confidence.label);
    expect(p.confidence.notes.join(' ')).toMatch(/open race/i);
    expect(['watch', 'skip']).toContain(p.betting.stance);
    expect(p.betting.suggestions).toHaveLength(0);
  });

  it('never reports a bet stance without at least one suggestion', () => {
    const race = makeRace(12);
    const p = predictRace(race, { venueSlug: 'flemington', settings, now: NOW, simulations: 1500 });
    const plan = buildBettingPlan({ race, ranked: p.ranked.map((r) => ({ ...r, winProb: 0.1, valueEdge: -0.1 })), confidence: { ...p.confidence, overall: 80, label: 'High' }, settings });
    if (!plan.suggestions.length) expect(plan.stance).toBe('watch');
    else expect(['bet', 'small']).toContain(plan.stance);
  });
});
