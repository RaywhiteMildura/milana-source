import { describe, expect, it } from 'vitest';
import type { Runner } from '../../shared/types.js';
import { favourite, overround, summariseRaceMarket, summariseRunnerMarket } from './market.js';

function runner(number: number, odds: Runner['odds'], scratched = false): Runner {
  return {
    id: `r${number}`,
    number,
    name: `Runner ${number}`,
    scratched,
    form: [],
    gearChanges: [],
    comments: [],
    ratings: {},
    odds,
    fields: {
      barrier: { value: undefined, agree: [], disagree: [], confidence: 0 },
      jockey: { value: undefined, agree: [], disagree: [], confidence: 0 },
      trainer: { value: undefined, agree: [], disagree: [], confidence: 0 },
      weight: { value: undefined, agree: [], disagree: [], confidence: 0 },
      scratched: { value: undefined, agree: [], disagree: [], confidence: 0 },
      number: { value: number, agree: [], disagree: [], confidence: 1 },
    },
    sources: ['a'],
    verification: { score: 0.8, sourceCount: 1, conflicts: [], checkedFields: 1, agreedFields: 1 },
    news: [],
  };
}

const q = (bookmaker: string, win: number, opening?: number, place?: number) => ({ source: bookmaker, bookmaker, type: 'fixed' as const, win, opening, place, fetchedAt: 't' });

describe('summariseRunnerMarket', () => {
  it('finds best price, mean, movers and dispersion', () => {
    const m = summariseRunnerMarket({ odds: [q('A', 4.0, 5.0), q('B', 4.4, 5.0), q('C', 4.2)] })!;
    expect(m.bestWin).toBe(4.4);
    expect(m.bestWinBookmaker).toBe('B');
    expect(m.meanWin).toBe(4.2);
    expect(m.movePct).toBeLessThan(-8);
    expect(m.mover).toBe('firming');
    expect(m.quoteCount).toBe(3);
    expect(m.dispersion).toBeGreaterThan(0);
  });

  it('returns undefined with no odds and handles place-only quotes', () => {
    expect(summariseRunnerMarket({ odds: [] })).toBeUndefined();
    const m = summariseRunnerMarket({ odds: [{ source: 'x', bookmaker: 'x', type: 'tote', place: 1.8, fetchedAt: 't' }] })!;
    expect(m.bestPlace).toBe(1.8);
    expect(m.quoteCount).toBe(0);
  });

  it('ignores junk prices', () => {
    const m = summariseRunnerMarket({ odds: [q('A', 0), q('B', NaN), q('C', 3.5)] })!;
    expect(m.meanWin).toBe(3.5);
  });
});

describe('summariseRaceMarket', () => {
  it('normalises implied probabilities across active runners only', () => {
    const rs = summariseRaceMarket([runner(1, [q('A', 2.0)]), runner(2, [q('A', 4.0)]), runner(3, [q('A', 4.0)]), runner(4, [q('A', 2.0)], true)]);
    const probs = rs.filter((r) => !r.scratched).map((r) => r.market!.impliedWinProb!);
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
    expect(probs[0]).toBeCloseTo(0.5, 2);
    expect(rs[3].market!.impliedWinProb).toBeUndefined();
    expect(overround(rs)).toBeCloseTo(1.0, 2);
    expect(favourite(rs)!.number).toBe(1);
  });
});
