/**
 * Prediction scorecards.
 *
 * `scorePrediction` compares a race prediction with the official placings,
 * handling dead heats (a tied slot occupies every position it spans, so
 * `[[4],[2,7],[9]]` puts 2 and 7 both in 2nd/3rd and 9 in 4th).
 * `summariseScorecards` rolls the scorecards of a meeting up into counts.
 *
 * Pure functions: no I/O, no clock.
 */
import type { Prediction, RaceResult, RunnerAssessment } from '../../shared/types.js';
import { round } from '../../shared/util.js';

export type Scorecard = NonNullable<RaceResult['scorecard']>;

export interface ScorecardSummary {
  races: number;
  winnersInTop1: number;
  winnersInTop3: number;
  winnersInTop6: number;
  quinellas: number;
  trifectaBoxes: number;
  avgWinnerRank?: number;
  summary: string;
}

/** Runner numbers in predicted order (by `rank` when supplied, else array order). */
function rankedNumbers(ranked: RunnerAssessment[]): number[] {
  const list = [...(ranked ?? [])];
  if (list.every((r) => Number.isFinite(r.rank))) list.sort((a, b) => a.rank - b.rank);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const r of list) {
    if (seen.has(r.number)) continue;
    seen.add(r.number);
    out.push(r.number);
  }
  return out;
}

/**
 * Finishing positions each horse may claim. A slot starting at position p with
 * k tied horses gives each of them positions p..p+k-1.
 */
export function positionsByRunner(placings: number[][] | undefined): Map<number, number[]> {
  const map = new Map<number, number[]>();
  let next = 1;
  for (const slot of placings ?? []) {
    const horses = Array.from(new Set((slot ?? []).filter((n) => Number.isFinite(n))));
    if (horses.length === 0) continue;
    const span = horses.map((_, i) => next + i);
    for (const n of horses) {
      if (!map.has(n)) map.set(n, span);
    }
    next += horses.length;
  }
  return map;
}

/** Horses that may claim any of positions 1..3 (more than three on a dead heat). */
function placegetters(positions: Map<number, number[]>): number[] {
  const out: number[] = [];
  for (const [n, span] of positions) {
    if (span.some((p) => p <= 3)) out.push(n);
  }
  return out;
}

/** Can `horses[i]` be assigned finishing position i+1 for every i, using each horse once? */
function canFillInOrder(horses: number[], positions: Map<number, number[]>): boolean {
  return horses.every((n, i) => (positions.get(n) ?? []).includes(i + 1));
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutations(rest)) out.push([x, ...p]);
  });
  return out;
}

/** Can the set of horses fill positions 1..n in some order? */
function canFillAnyOrder(horses: number[], positions: Map<number, number[]>): boolean {
  if (horses.length === 0) return false;
  return permutations(horses).some((perm) => canFillInOrder(perm, positions));
}

/**
 * Score a prediction against a result.
 */
export function scorePrediction(prediction: Prediction, result: RaceResult): Scorecard {
  const order = rankedNumbers(prediction.ranked);
  const positions = positionsByRunner(result.placings);
  const winners = Array.from(positions.entries())
    .filter(([, span]) => span.includes(1))
    .map(([n]) => n);

  let winnerRank: number | undefined;
  for (const w of winners) {
    const idx = order.indexOf(w);
    if (idx >= 0 && (winnerRank === undefined || idx + 1 < winnerRank)) winnerRank = idx + 1;
  }

  const topNumbers =
    prediction.top && prediction.top.length > 0 ? rankedNumbers(prediction.top) : order.slice(0, 6);
  const topSet = new Set(topNumbers);
  const placegettersInTop6 = placegetters(positions).filter((n) => topSet.has(n)).length;

  const ourWinner = order[0];
  const ourWinnerSpan = ourWinner === undefined ? undefined : positions.get(ourWinner);
  const predictedWinnerPosition = ourWinnerSpan && ourWinnerSpan.length > 0 ? Math.min(...ourWinnerSpan) : undefined;

  const top2 = order.slice(0, 2);
  const top3 = order.slice(0, 3);
  const exactaHit = top2.length === 2 && canFillInOrder(top2, positions);
  const quinellaHit = top2.length === 2 && canFillAnyOrder(top2, positions);
  const trifectaBoxHit = top3.length === 3 && canFillAnyOrder(top3, positions);

  return {
    winnerRank,
    winnerInTop3: winnerRank !== undefined && winnerRank <= 3,
    winnerInTop6: winnerRank !== undefined && winnerRank <= 6,
    placegettersInTop6,
    predictedWinnerPosition,
    exactaHit,
    quinellaHit,
    trifectaBoxHit,
  };
}

/** Roll up the scorecards recorded against a meeting's results. */
export function summariseScorecards(results: Record<number, RaceResult>): ScorecardSummary {
  const cards = Object.values(results ?? {})
    .filter((r): r is RaceResult & { scorecard: Scorecard } => !!r && !!r.scorecard)
    .sort((a, b) => a.raceNumber - b.raceNumber)
    .map((r) => r.scorecard);

  const races = cards.length;
  const winnersInTop1 = cards.filter((c) => c.winnerRank === 1).length;
  const winnersInTop3 = cards.filter((c) => c.winnerInTop3).length;
  const winnersInTop6 = cards.filter((c) => c.winnerInTop6).length;
  const quinellas = cards.filter((c) => c.quinellaHit).length;
  const trifectaBoxes = cards.filter((c) => c.trifectaBoxHit).length;
  const ranks = cards.map((c) => c.winnerRank).filter((r): r is number => typeof r === 'number' && Number.isFinite(r));
  const avgWinnerRank = ranks.length ? round(ranks.reduce((a, b) => a + b, 0) / ranks.length, 2) : undefined;

  let summary: string;
  if (races === 0) {
    summary = 'No races scored yet';
  } else {
    const bits = [
      `${races} race${races === 1 ? '' : 's'} scored`,
      `${winnersInTop1} winner${winnersInTop1 === 1 ? '' : 's'} on top`,
      `${winnersInTop3} of ${races} in our top 3`,
      `${winnersInTop6} of ${races} in our top 6`,
      `${quinellas} quinella${quinellas === 1 ? '' : 's'}`,
      `${trifectaBoxes} trifecta box${trifectaBoxes === 1 ? '' : 'es'}`,
    ];
    if (avgWinnerRank !== undefined) bits.push(`average winner rank ${avgWinnerRank}`);
    summary = `${bits[0]}: ${bits.slice(1).join(', ')}`;
  }

  return { races, winnersInTop1, winnersInTop3, winnersInTop6, quinellas, trifectaBoxes, avgWinnerRank, summary };
}
