import { describe, expect, it } from 'vitest';
import type { Prediction, RaceResult, RunnerAssessment } from '../../shared/types.js';
import { positionsByRunner, scorePrediction, summariseScorecards } from './scorecard.js';

function assessment(number: number, rank: number): RunnerAssessment {
  return {
    runnerId: `r${number}`,
    number,
    name: `Horse ${number}`,
    strength: 0,
    winProb: 0.1,
    placeProb: 0.3,
    top6Prob: 0.6,
    expectedFinish: rank,
    rank,
    factors: [],
    reasons: [],
    concerns: [],
    fairOdds: 10,
    dataCompleteness: 1,
    verificationScore: 1,
  };
}

/** Prediction ranking the given runner numbers in order; `top` is the first 6. */
function prediction(order: number[], topCount = 6): Prediction {
  const ranked = order.map((n, i) => assessment(n, i + 1));
  return {
    raceNumber: 1,
    generatedAt: '2026-10-23T00:00:00Z',
    ranked,
    top: ranked.slice(0, topCount),
    confidence: {
      overall: 50,
      label: 'Fair',
      components: { dataCompleteness: 1, sourceAgreement: 1, separation: 1, marketAlignment: 1, fieldSize: 1, freshness: 1 },
      notes: [],
    },
    betting: { stance: 'watch', unitAmount: 10, totalUnits: 0, totalAmount: 0, suggestions: [], notes: [] },
    summary: '',
    dayPatternsApplied: [],
    modelVersion: 'test',
  };
}

function result(placings: number[][], raceNumber = 1): RaceResult {
  return { raceNumber, placings, recordedAt: '2026-10-23T05:00:00Z', source: 'test' };
}

describe('positionsByRunner', () => {
  it('gives each horse a single position without dead heats', () => {
    const m = positionsByRunner([[4], [2], [9]]);
    expect(m.get(4)).toEqual([1]);
    expect(m.get(2)).toEqual([2]);
    expect(m.get(9)).toEqual([3]);
  });

  it('lets a tied slot occupy every position it spans and pushes later slots back', () => {
    const m = positionsByRunner([[4], [2, 7], [9]]);
    expect(m.get(2)).toEqual([2, 3]);
    expect(m.get(7)).toEqual([2, 3]);
    expect(m.get(9)).toEqual([4]);
  });

  it('ignores empty slots and duplicate numbers', () => {
    const m = positionsByRunner([[4], [], [4, 2]]);
    expect(m.get(4)).toEqual([1]);
    expect(m.get(2)).toEqual([2, 3]);
  });
});

describe('scorePrediction', () => {
  it('scores a perfect trifecta', () => {
    const card = scorePrediction(prediction([4, 2, 9, 1, 5, 6, 7]), result([[4], [2], [9], [1]]));
    expect(card.winnerRank).toBe(1);
    expect(card.winnerInTop3).toBe(true);
    expect(card.winnerInTop6).toBe(true);
    expect(card.placegettersInTop6).toBe(3);
    expect(card.predictedWinnerPosition).toBe(1);
    expect(card.exactaHit).toBe(true);
    expect(card.quinellaHit).toBe(true);
    expect(card.trifectaBoxHit).toBe(true);
  });

  it('distinguishes quinella from exacta when the top two are reversed', () => {
    const card = scorePrediction(prediction([2, 4, 9, 1, 5, 6]), result([[4], [2], [9]]));
    expect(card.winnerRank).toBe(2);
    expect(card.winnerInTop3).toBe(true);
    expect(card.predictedWinnerPosition).toBe(2);
    expect(card.exactaHit).toBe(false);
    expect(card.quinellaHit).toBe(true);
    expect(card.trifectaBoxHit).toBe(true);
  });

  it('handles a winner we did not rate and an unplaced top pick', () => {
    const card = scorePrediction(prediction([1, 5, 6, 7, 8, 9, 2]), result([[4], [2], [3], [1]]));
    expect(card.winnerRank).toBeUndefined();
    expect(card.winnerInTop3).toBe(false);
    expect(card.winnerInTop6).toBe(false);
    expect(card.predictedWinnerPosition).toBe(4);
    expect(card.placegettersInTop6).toBe(0); // 2 is ranked 7th, outside our top 6
    expect(card.exactaHit).toBe(false);
    expect(card.quinellaHit).toBe(false);
    expect(card.trifectaBoxHit).toBe(false);
  });

  it('reports a top pick that did not finish in the placings as undefined position', () => {
    const card = scorePrediction(prediction([1, 2, 3]), result([[4], [2], [3]]));
    expect(card.predictedWinnerPosition).toBeUndefined();
    expect(card.winnerRank).toBeUndefined();
    expect(card.placegettersInTop6).toBe(2);
  });

  it('winner ranked 5th counts for top6 but not top3', () => {
    const card = scorePrediction(prediction([1, 2, 3, 5, 4, 6]), result([[4], [1], [2]]));
    expect(card.winnerRank).toBe(5);
    expect(card.winnerInTop3).toBe(false);
    expect(card.winnerInTop6).toBe(true);
    expect(card.placegettersInTop6).toBe(3);
    expect(card.exactaHit).toBe(false);
    expect(card.quinellaHit).toBe(false);
    expect(card.trifectaBoxHit).toBe(false);
  });

  describe('dead heats', () => {
    it('treats both dead-heat winners as the winner and uses the better rank', () => {
      const card = scorePrediction(prediction([2, 7, 4, 1, 5, 6]), result([[4, 2], [9]]));
      expect(card.winnerRank).toBe(1);
      expect(card.predictedWinnerPosition).toBe(1);
      // 4 and 2 can take 1st/2nd in either order -> exacta and quinella both hit for picks (2,4)
      const card2 = scorePrediction(prediction([2, 4, 9, 1, 5, 6]), result([[4, 2], [9]]));
      expect(card2.exactaHit).toBe(true);
      expect(card2.quinellaHit).toBe(true);
      expect(card2.trifectaBoxHit).toBe(true);
    });

    it('dead heat for second: either tied horse completes the exacta, both complete the trifecta', () => {
      const res = result([[4], [2, 7], [9]]);
      const a = scorePrediction(prediction([4, 7, 2, 1, 5, 6]), res);
      expect(a.exactaHit).toBe(true);
      expect(a.quinellaHit).toBe(true);
      expect(a.trifectaBoxHit).toBe(true);
      expect(a.placegettersInTop6).toBe(3); // 4, 2, 7 are the placegetters; 9 ran 4th

      const b = scorePrediction(prediction([4, 2, 9, 1, 5, 6]), res);
      expect(b.exactaHit).toBe(true);
      expect(b.quinellaHit).toBe(true);
      expect(b.trifectaBoxHit).toBe(false); // 9 ran 4th: the tied pair occupy 2nd and 3rd
      expect(b.placegettersInTop6).toBe(2); // 4 and 2 are in our top six; 7 is not
    });

    it('does not credit a quinella when neither pick can be first', () => {
      const card = scorePrediction(prediction([2, 7, 4]), result([[4], [2, 7], [9]]));
      expect(card.quinellaHit).toBe(false);
      expect(card.exactaHit).toBe(false);
      expect(card.trifectaBoxHit).toBe(true); // 2,7,4 fill 1..3 in some order
      expect(card.winnerRank).toBe(3);
    });

    it('a dead heat for third makes four placegetters available', () => {
      const card = scorePrediction(prediction([4, 2, 7, 9, 1, 5]), result([[4], [2], [7, 9], [1]]));
      expect(card.placegettersInTop6).toBe(4);
      expect(card.trifectaBoxHit).toBe(true);
    });
  });

  it('handles an empty result', () => {
    const card = scorePrediction(prediction([1, 2, 3]), result([]));
    expect(card).toEqual({
      winnerRank: undefined,
      winnerInTop3: false,
      winnerInTop6: false,
      placegettersInTop6: 0,
      predictedWinnerPosition: undefined,
      exactaHit: false,
      quinellaHit: false,
      trifectaBoxHit: false,
    });
  });

  it('orders by rank even when the ranked array is shuffled', () => {
    const p = prediction([1, 2, 3, 4]);
    p.ranked = [...p.ranked].reverse();
    const card = scorePrediction(p, result([[1], [2], [3]]));
    expect(card.winnerRank).toBe(1);
    expect(card.exactaHit).toBe(true);
  });

  it('falls back to the first six ranked when top is empty', () => {
    const p = prediction([4, 2, 9, 1, 5, 6, 7], 0);
    const card = scorePrediction(p, result([[4], [2], [7]]));
    expect(card.placegettersInTop6).toBe(2);
  });
});

describe('summariseScorecards', () => {
  it('reports no races when nothing is scored', () => {
    const s = summariseScorecards({});
    expect(s.races).toBe(0);
    expect(s.avgWinnerRank).toBeUndefined();
    expect(s.summary).toMatch(/No races scored/);
  });

  it('ignores results without scorecards and rolls up the rest', () => {
    const r1 = { ...result([[4], [2], [9]], 1), scorecard: scorePrediction(prediction([4, 2, 9, 1]), result([[4], [2], [9]])) };
    const r2 = { ...result([[1], [2], [3]], 2), scorecard: scorePrediction(prediction([5, 6, 1, 2, 3, 7]), result([[1], [2], [3]])) };
    const r3 = { ...result([[8], [2], [3]], 3), scorecard: scorePrediction(prediction([5, 6, 1, 2, 3, 7]), result([[8], [2], [3]])) };
    const r4 = result([[1]], 4); // no scorecard yet
    const s = summariseScorecards({ 1: r1, 2: r2, 3: r3, 4: r4 });
    expect(s.races).toBe(3);
    expect(s.winnersInTop1).toBe(1);
    expect(s.winnersInTop3).toBe(2);
    expect(s.winnersInTop6).toBe(2);
    expect(s.quinellas).toBe(1);
    expect(s.trifectaBoxes).toBe(1);
    expect(s.avgWinnerRank).toBe(2); // (1 + 3) / 2
    expect(s.summary).toContain('3 races scored');
    expect(s.summary).toContain('1 winner on top');
    expect(s.summary).toContain('2 of 3 in our top 3');
    expect(s.summary).toContain('1 quinella');
    expect(s.summary).toContain('average winner rank 2');
  });
});
