/**
 * Day-pattern detection.
 *
 * Looks at the races already run at a meeting and surfaces biases that the
 * remaining races can be adjusted for: pace (on-pace vs backmarkers), barrier
 * (inside vs outside third), market (favourites vs roughies), wet-track form
 * and track-rating drift across the day.
 *
 * Every pattern carries a `strength` in 0..1 which is the raw evidence scaled
 * by sample size (`sampleFactor = min(1, races / 4)`), so a single result is
 * always reported as weak and four or more results can reach full weight.
 *
 * Pure functions: no I/O, no clock.
 */
import type { CareerStats, DayPattern, FormLine, Race, RaceResult, Runner, SpeedMapPosition } from '../../shared/types.js';
import { clamp, parseTrackRating, round, trackRatingLabel } from '../../shared/util.js';

export interface DayPatternOptions {
  /** Minimum number of races with results before any pattern is reported (default 1). */
  minRaces?: number;
}

/** Number of completed races at which a pattern reaches full strength. */
export const FULL_SAMPLE_RACES = 4;

/** Largest additive bonus/penalty `patternBias` will return. */
export const MAX_PATTERN_BIAS = 0.35;

/** Sample-size scaling applied to raw evidence: min(1, n / 4). */
export function sampleFactor(races: number): number {
  return clamp(races / FULL_SAMPLE_RACES, 0, 1);
}

// ---------------------------------------------------------------------------
// Joining results to runners
// ---------------------------------------------------------------------------

interface CompletedRace {
  race: Race;
  result: RaceResult;
  /** Horses sharing the first placing slot (more than one on a dead heat). */
  winners: Runner[];
  /** Horses in the second and third placing slots (winners excluded). */
  minorPlacegetters: Runner[];
  fieldSize: number;
}

function effectiveFieldSize(race: Race): number {
  if (race.fieldSize && race.fieldSize > 0) return race.fieldSize;
  const active = race.runners.filter((r) => !r.scratched).length;
  return active || race.runners.length;
}

function completedRaces(races: Race[], results: Record<number, RaceResult>): CompletedRace[] {
  const out: CompletedRace[] = [];
  const sorted = [...races].sort((a, b) => a.number - b.number);
  for (const race of sorted) {
    const result = results[race.number];
    if (!result || !Array.isArray(result.placings) || result.placings.length === 0) continue;
    const byNumber = new Map(race.runners.map((r) => [r.number, r] as const));
    const lookup = (nums: number[]): Runner[] =>
      nums.map((n) => byNumber.get(n)).filter((r): r is Runner => r !== undefined);
    const winners = lookup(result.placings[0] ?? []);
    if (winners.length === 0) continue;
    const minorPlacegetters = lookup(result.placings.slice(1, 3).flat()).filter((r) => !winners.includes(r));
    out.push({ race, result, winners, minorPlacegetters, fieldSize: effectiveFieldSize(race) });
  }
  return out;
}

function pushUnique(list: number[], n: number): void {
  if (!list.includes(n)) list.push(n);
}

function formatRaces(nums: number[]): string {
  return nums.map((n) => `R${n}`).join(', ');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function raceRating(race: Pick<Race, 'trackRating' | 'trackCondition'>): number | undefined {
  return race.trackRating ?? parseTrackRating(race.trackCondition);
}

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

function mostRecentForm(form: FormLine[] | undefined): FormLine | undefined {
  if (!form || form.length === 0) return undefined;
  let best = form[0];
  let bestTime = Date.parse(best.date);
  for (const line of form) {
    const t = Date.parse(line.date);
    if (!Number.isNaN(t) && (Number.isNaN(bestTime) || t > bestTime)) {
      best = line;
      bestTime = t;
    }
  }
  return best;
}

/**
 * Settling position for a runner: the speed-map position when supplied, else
 * the first settling position of the most recent form line's `inRunning`
 * string ("4-3-2" -> 4th at settling) mapped by field size.
 */
export function settlingPosition(runner: Runner): SpeedMapPosition | undefined {
  if (runner.speedMapPosition) return runner.speedMapPosition;
  const line = mostRecentForm(runner.form);
  if (!line?.inRunning) return undefined;
  const m = line.inRunning.match(/\d+/);
  if (!m) return undefined;
  const settle = Number(m[0]);
  if (!Number.isFinite(settle) || settle < 1) return undefined;
  const starters = line.starters && line.starters > 0 ? line.starters : 10;
  if (settle === 1) return 'leader';
  if (settle <= Math.max(3, Math.ceil(starters * 0.3))) return 'on-pace';
  if (settle <= Math.max(4, Math.ceil(starters * 0.65))) return 'midfield';
  return 'backmarker';
}

type PaceBucket = 'front' | 'back';

function paceBucket(runner: Runner): PaceBucket | undefined {
  const pos = settlingPosition(runner);
  if (!pos) return undefined;
  return pos === 'leader' || pos === 'on-pace' ? 'front' : 'back';
}

function detectPacePattern(completed: CompletedRace[]): DayPattern | undefined {
  let front = 0;
  let known = 0;
  let placeFront = 0;
  let placeKnown = 0;
  const usedRaces: number[] = [];
  const frontRaces: number[] = [];
  const backRaces: number[] = [];

  for (const c of completed) {
    let used = false;
    for (const w of c.winners) {
      const bucket = paceBucket(w);
      if (!bucket) continue;
      used = true;
      known++;
      if (bucket === 'front') {
        front++;
        pushUnique(frontRaces, c.race.number);
      } else {
        pushUnique(backRaces, c.race.number);
      }
    }
    for (const p of c.minorPlacegetters) {
      const bucket = paceBucket(p);
      if (!bucket) continue;
      placeKnown++;
      if (bucket === 'front') placeFront++;
    }
    if (used) usedRaces.push(c.race.number);
  }

  if (known === 0) return undefined;
  const share = front / known;
  // -1 (every winner from the back) .. +1 (every winner on the pace). Needs a 2:1 split to register.
  const signal = (share - 0.5) * 2;
  if (Math.abs(signal) < 1 / 3 - 1e-9) return undefined;
  const strength = round(Math.abs(signal) * sampleFactor(usedRaces.length), 2);
  if (strength <= 0) return undefined;

  const placeNote = placeKnown >= 2 ? `; ${placeFront} of ${placeKnown} other placegetters raced on-pace` : '';
  if (signal > 0) {
    return {
      key: 'on-pace-bias',
      label: 'On-pace bias',
      detail: `${front} of ${plural(known, 'winner')} led or raced on-pace (${formatRaces(frontRaces)})${placeNote}`,
      strength,
      basedOnRaces: usedRaces,
      adjust: { factorKey: 'pace', multiplier: round(1 + 0.8 * strength, 3) },
    };
  }
  return {
    key: 'backmarker-bias',
    label: 'Backmarkers getting home',
    detail: `${known - front} of ${plural(known, 'winner')} came from midfield or worse (${formatRaces(backRaces)})${placeNote}`,
    strength,
    basedOnRaces: usedRaces,
    adjust: { factorKey: 'pace', multiplier: round(1 - 0.5 * strength, 3) },
  };
}

// ---------------------------------------------------------------------------
// Barriers
// ---------------------------------------------------------------------------

type BarrierThird = 'inside' | 'middle' | 'outside';

/** Which third of the gates a barrier sits in, relative to field size. */
export function barrierThird(barrier: number, fieldSize: number): BarrierThird {
  const span = Math.max(fieldSize, barrier) - 1;
  if (span <= 0) return 'middle';
  const rel = (barrier - 1) / span;
  if (rel <= 1 / 3 + 1e-9) return 'inside';
  if (rel >= 2 / 3 - 1e-9) return 'outside';
  return 'middle';
}

function detectBarrierPattern(completed: CompletedRace[]): DayPattern | undefined {
  let inside = 0;
  let outside = 0;
  let known = 0;
  const usedRaces: number[] = [];
  const insideRaces: number[] = [];
  const outsideRaces: number[] = [];

  for (const c of completed) {
    if (c.fieldSize < 6) continue; // too small for thirds to mean anything
    let used = false;
    for (const w of c.winners) {
      if (!w.barrier || w.barrier < 1) continue;
      used = true;
      known++;
      const third = barrierThird(w.barrier, c.fieldSize);
      if (third === 'inside') {
        inside++;
        pushUnique(insideRaces, c.race.number);
      } else if (third === 'outside') {
        outside++;
        pushUnique(outsideRaces, c.race.number);
      }
    }
    if (used) usedRaces.push(c.race.number);
  }

  if (known === 0) return undefined;
  const insideShare = inside / known;
  const outsideShare = outside / known;
  const pick: 'inside' | 'outside' | undefined =
    insideShare >= 0.6 && inside > outside ? 'inside' : outsideShare >= 0.6 && outside > inside ? 'outside' : undefined;
  if (!pick) return undefined;

  const count = pick === 'inside' ? inside : outside;
  const share = count / known;
  // A third of winners from each third is the null expectation; scale the excess.
  const evidence = clamp((share - 1 / 3) / (2 / 3), 0, 1);
  const strength = round(evidence * sampleFactor(usedRaces.length), 2);
  if (strength <= 0) return undefined;

  return {
    key: `${pick}-barrier-bias`,
    label: pick === 'inside' ? 'Inside barriers favoured' : 'Outside barriers favoured',
    detail: `${count} of ${plural(known, 'winner')} jumped from the ${pick} third of the gates (${formatRaces(pick === 'inside' ? insideRaces : outsideRaces)})`,
    strength,
    basedOnRaces: usedRaces,
    adjust: { bias: pick, weight: strength },
  };
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

/** Best guess at a runner's pre-race win price. */
export function winPrice(runner: Runner): number | undefined {
  const m = runner.market;
  if (m?.bestWin && m.bestWin > 1) return m.bestWin;
  if (m?.impliedWinProb && m.impliedWinProb > 0 && m.impliedWinProb <= 1) return round(1 / m.impliedWinProb, 2);
  let best: number | undefined;
  for (const q of runner.odds ?? []) {
    if (q.win && q.win > 1 && (best === undefined || q.win < best)) best = q.win;
  }
  return best;
}

/** Runner numbers of the pre-race favourite(s) (several on a tied price). */
export function favouriteNumbers(race: Race): number[] {
  let best: number | undefined;
  const favs: number[] = [];
  for (const r of race.runners) {
    if (r.scratched) continue;
    const price = winPrice(r);
    if (price === undefined) continue;
    if (best === undefined || price < best - 1e-9) {
      best = price;
      favs.length = 0;
      favs.push(r.number);
    } else if (Math.abs(price - best) <= 1e-9) {
      favs.push(r.number);
    }
  }
  return favs;
}

const ROUGHIE_PRICE = 10;

function detectMarketPatterns(completed: CompletedRace[]): DayPattern[] {
  let favWon = 0;
  let roughWon = 0;
  let known = 0;
  const usedRaces: number[] = [];
  const favRaces: number[] = [];
  const roughRaces: number[] = [];

  for (const c of completed) {
    const favs = favouriteNumbers(c.race);
    if (favs.length === 0) continue; // no market to compare against
    usedRaces.push(c.race.number);
    for (const w of c.winners) {
      known++;
      if (favs.includes(w.number)) {
        favWon++;
        pushUnique(favRaces, c.race.number);
      }
      const price = winPrice(w);
      if (price !== undefined && price >= ROUGHIE_PRICE) {
        roughWon++;
        pushUnique(roughRaces, c.race.number);
      }
    }
  }
  if (known === 0) return [];

  const out: DayPattern[] = [];
  const favShare = favWon / known;
  const roughShare = roughWon / known;
  const sf = sampleFactor(usedRaces.length);

  // Favourites win roughly a third of races; 60%+ is a favourites' day.
  if (favShare >= 0.6) {
    const strength = round(clamp((favShare - 0.35) / 0.65, 0, 1) * sf, 2);
    if (strength > 0) {
      out.push({
        key: 'favourites-day',
        label: 'Favourites dominating',
        detail: `${favWon} of ${plural(known, 'winner')} ${favWon === 1 && known === 1 ? 'was' : 'were'} the pre-race favourite (${formatRaces(favRaces)})`,
        strength,
        basedOnRaces: usedRaces,
        adjust: { bias: 'favourites', weight: strength },
      });
    }
  }
  // $10+ winners land roughly one race in six or seven; half the card is a roughies' day.
  if (roughShare >= 0.5) {
    const strength = round(clamp((roughShare - 0.15) / 0.85, 0, 1) * sf, 2);
    if (strength > 0) {
      out.push({
        key: 'roughies-day',
        label: "Roughies' day",
        detail: `${roughWon} of ${plural(known, 'winner')} started at $${ROUGHIE_PRICE} or longer (${formatRaces(roughRaces)})`,
        strength,
        basedOnRaces: usedRaces,
        adjust: { bias: 'roughies', weight: strength },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wet-track form
// ---------------------------------------------------------------------------

function addStats(a: CareerStats | undefined, b: CareerStats | undefined): CareerStats | undefined {
  if (!a && !b) return undefined;
  return {
    starts: (a?.starts ?? 0) + (b?.starts ?? 0),
    wins: (a?.wins ?? 0) + (b?.wins ?? 0),
    seconds: (a?.seconds ?? 0) + (b?.seconds ?? 0),
    thirds: (a?.thirds ?? 0) + (b?.thirds ?? 0),
  };
}

/** Combined soft + heavy record, or undefined when the splits are not supplied at all. */
export function wetStats(runner: Runner): CareerStats | undefined {
  if (!runner.splits) return undefined;
  return addStats(runner.splits.soft, runner.splits.heavy);
}

/** "Proven" wet form: a 25%+ win rate with at least one win, or a 50%+ place rate from 2+ starts. */
export function isProvenWet(stats: CareerStats | undefined): boolean {
  if (!stats || stats.starts <= 0) return false;
  const winRate = stats.wins / stats.starts;
  const placeRate = (stats.wins + stats.seconds + stats.thirds) / stats.starts;
  return (stats.wins >= 1 && winRate >= 0.25) || (stats.starts >= 2 && placeRate >= 0.5);
}

function detectWetFormPattern(completed: CompletedRace[]): DayPattern | undefined {
  let proven = 0;
  let known = 0;
  const usedRaces: number[] = [];
  const provenRaces: number[] = [];
  let ratingSeen: number | undefined;

  for (const c of completed) {
    const rating = raceRating(c.race);
    if (rating === undefined || rating < 6) continue;
    let used = false;
    for (const w of c.winners) {
      const stats = wetStats(w);
      if (!stats) continue;
      used = true;
      known++;
      if (isProvenWet(stats)) {
        proven++;
        pushUnique(provenRaces, c.race.number);
      }
    }
    if (used) {
      usedRaces.push(c.race.number);
      ratingSeen = rating;
    }
  }
  if (known === 0) return undefined;
  const share = proven / known;
  if (share < 0.6) return undefined;
  const strength = round(clamp((share - 0.4) / 0.6, 0, 1) * sampleFactor(usedRaces.length), 2);
  if (strength <= 0) return undefined;

  return {
    key: 'wet-track-form',
    label: 'Wet-trackers winning',
    detail: `${proven} of ${plural(known, 'winner')} on the ${trackRatingLabel(ratingSeen)} track had proven soft/heavy form (${formatRaces(provenRaces)})`,
    strength,
    basedOnRaces: usedRaces,
    adjust: { factorKey: 'wetForm', multiplier: round(1 + 0.8 * strength, 3) },
  };
}

// ---------------------------------------------------------------------------
// Track drift (informational)
// ---------------------------------------------------------------------------

function detectTrackDrift(races: Race[]): DayPattern | undefined {
  const rated = [...races]
    .sort((a, b) => a.number - b.number)
    .map((r) => ({ number: r.number, rating: raceRating(r) }))
    .filter((r): r is { number: number; rating: number } => r.rating !== undefined);
  if (rated.length < 2) return undefined;

  const changedAt: number[] = [];
  for (let i = 1; i < rated.length; i++) {
    if (rated[i].rating !== rated[i - 1].rating) changedAt.push(rated[i].number);
  }
  if (changedAt.length === 0) return undefined;

  const first = rated[0];
  const last = rated[rated.length - 1];
  const delta = last.rating - first.rating;
  const label = delta > 0 ? 'Track getting softer' : delta < 0 ? 'Track drying out' : 'Track rating fluctuating';
  const detail =
    delta === 0
      ? `Track rating changed during the day but is back to ${trackRatingLabel(last.rating)} by R${last.number}`
      : `Track rating moved from ${trackRatingLabel(first.rating)} (R${first.number}) to ${trackRatingLabel(last.rating)} (R${last.number})`;

  return {
    key: 'track-drift',
    label,
    detail,
    strength: round(clamp(Math.abs(delta) / 3, 0.2, 1), 2),
    basedOnRaces: changedAt,
    adjust: undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect day patterns from the races run so far. Returns [] until at least
 * `opts.minRaces` (default 1) races have results joined to runners.
 */
export function detectDayPatterns(
  races: Race[],
  results: Record<number, RaceResult>,
  opts: DayPatternOptions = {},
): DayPattern[] {
  const minRaces = Math.max(1, Math.floor(opts.minRaces ?? 1));
  const completed = completedRaces(races, results ?? {});
  if (completed.length < minRaces) return [];

  const patterns: DayPattern[] = [];
  const add = (p: DayPattern | undefined): void => {
    if (p) patterns.push(p);
  };
  add(detectPacePattern(completed));
  add(detectBarrierPattern(completed));
  patterns.push(...detectMarketPatterns(completed));
  add(detectWetFormPattern(completed));
  add(detectTrackDrift(races));

  return patterns.sort((a, b) => b.strength - a.strength || a.key.localeCompare(b.key));
}

const MULTIPLIER_MIN = 0.5;
const MULTIPLIER_MAX = 1.8;

/**
 * Multiply factor weights by the multipliers of any factor-key patterns.
 * Each multiplier, and the combined multiplier per key, is clamped to 0.5..1.8.
 * Keys absent from the base weights are ignored.
 */
export function applyDayPatterns(
  baseFactorWeights: Record<string, number>,
  patterns: DayPattern[],
): Record<string, number> {
  const out: Record<string, number> = { ...baseFactorWeights };
  const combined: Record<string, number> = {};
  for (const p of patterns) {
    const adj = p.adjust;
    if (!adj || !('factorKey' in adj)) continue;
    if (!(adj.factorKey in out)) continue;
    const m = Number.isFinite(adj.multiplier) ? clamp(adj.multiplier, MULTIPLIER_MIN, MULTIPLIER_MAX) : 1;
    combined[adj.factorKey] = (combined[adj.factorKey] ?? 1) * m;
  }
  for (const [key, m] of Object.entries(combined)) {
    out[key] = round(out[key] * clamp(m, MULTIPLIER_MIN, MULTIPLIER_MAX), 4);
  }
  return out;
}

function impliedProb(runner: Runner): number | undefined {
  const p = runner.market?.impliedWinProb;
  if (p !== undefined && p > 0 && p <= 1) return p;
  const price = winPrice(runner);
  return price ? 1 / price : undefined;
}

/**
 * Small additive strength bonus/penalty in [-0.35, 0.35] for a runner given
 * the bias-type patterns (barrier position, favourite/roughie, leaders/backmarkers).
 */
export function patternBias(patterns: DayPattern[], runner: Runner, fieldSize: number): number {
  let total = 0;
  for (const p of patterns) {
    const adj = p.adjust;
    if (!adj || !('bias' in adj)) continue;
    const w = clamp(Number.isFinite(adj.weight) ? adj.weight : 0, 0, 1);
    if (w === 0) continue;

    switch (adj.bias) {
      case 'inside':
      case 'outside': {
        if (!runner.barrier || runner.barrier < 1) break;
        const span = Math.max(fieldSize, runner.barrier) - 1;
        if (span <= 0) break;
        const rel = (runner.barrier - 1) / span; // 0 = rail, 1 = widest gate
        const insideSignal = 1 - 2 * rel; // +1 rail .. -1 widest
        total += MAX_PATTERN_BIAS * w * (adj.bias === 'inside' ? insideSignal : -insideSignal);
        break;
      }
      case 'favourites':
      case 'roughies': {
        const prob = impliedProb(runner);
        if (prob === undefined) break;
        // Symmetric in log-price around $6: $3 or shorter -> +1, $12 or longer -> -1.
        const price = 1 / prob;
        const favSignal = clamp(-(Math.log(price) - Math.log(6)) / Math.log(2), -1, 1);
        total += MAX_PATTERN_BIAS * w * (adj.bias === 'favourites' ? favSignal : -favSignal);
        break;
      }
      case 'leaders':
      case 'backmarkers': {
        const pos = settlingPosition(runner);
        if (!pos) break;
        const frontSignal = pos === 'leader' ? 1 : pos === 'on-pace' ? 0.6 : pos === 'midfield' ? -0.3 : -1;
        total += MAX_PATTERN_BIAS * w * (adj.bias === 'leaders' ? frontSignal : -frontSignal);
        break;
      }
      default:
        break;
    }
  }
  return round(clamp(total, -MAX_PATTERN_BIAS, MAX_PATTERN_BIAS), 3);
}
