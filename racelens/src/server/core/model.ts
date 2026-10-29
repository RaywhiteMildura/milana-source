import type {
  ConfidenceRating,
  DayPattern,
  FactorScore,
  NewsItem,
  Prediction,
  Race,
  Runner,
  RunnerAssessment,
  Settings,
  WeatherSummary,
} from '../../shared/types.js';
import { MODEL_VERSION } from '../../shared/types.js';
import { clamp, mean, round } from '../../shared/util.js';
import { BASE_WEIGHTS, computeFieldStats, evaluateRunner, type FactorContext } from './factors.js';
import { applyDayPatterns, patternBias } from './daypatterns.js';
import { expectedTrackRating } from './weather.js';
import { summariseRaceMarket } from './market.js';
import { buildBettingPlan, expectedReturn, VALUE_MARGIN } from './betting.js';
import { starters } from './field.js';

/**
 * The prediction model.
 *
 * 1. Score every active runner on 16 factors (factors.ts) → weighted strength.
 * 2. Softmax(β · strength) gives model win probabilities.
 * 3. Log-linear pool with the market's implied probabilities (markets are the
 *    best single predictor; we lean on them but keep our own view).
 * 4. Plackett–Luce simulation on the pooled probabilities gives place / top-6
 *    probabilities and expected finishing position.
 * 5. Confidence rating + betting plan.
 */

export interface PredictOptions {
  venueSlug: string;
  weather?: WeatherSummary;
  news?: NewsItem[];
  dayPatterns?: DayPattern[];
  settings: Settings;
  now?: Date;
  previous?: Prediction;
  /**
   * The meeting's date (YYYY-MM-DD, track time). Form from that day or later is left out, and news published after
   * the jump: a race rated after it has run must not see its own result.
   */
  raceDate?: string;
  /** Temperature on strengths → probabilities. */
  beta?: number;
  /** Weight of the market in the log-linear pool (0..1). */
  marketWeight?: number;
  simulations?: number;
  seed?: number;
}

/** Deterministic PRNG (mulberry32) so tests and reruns are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function softmax(xs: number[]): number[] {
  if (!xs.length) return [];
  const m = Math.max(...xs);
  const es = xs.map((x) => Math.exp(x - m));
  const s = es.reduce((a, b) => a + b, 0);
  return es.map((e) => e / s);
}

/**
 * Plackett–Luce simulation via the Gumbel-max trick: ordering by
 * log(p_i) + Gumbel noise is exactly a draw from the PL model with weights p.
 */
export function simulateOrders(probs: number[], sims: number, seed = 42): { place: number[]; top6: number[]; expectedFinish: number[]; win: number[] } {
  const n = probs.length;
  const rand = rng(seed);
  const place = new Array(n).fill(0);
  const top6 = new Array(n).fill(0);
  const finishSum = new Array(n).fill(0);
  const win = new Array(n).fill(0);
  const logp = probs.map((p) => Math.log(Math.max(p, 1e-9)));
  const idx = Array.from({ length: n }, (_, i) => i);
  const placeSlots = n >= 8 ? 3 : n >= 5 ? 2 : 1;
  for (let s = 0; s < sims; s++) {
    const keys = logp.map((lp) => lp - Math.log(-Math.log(Math.max(rand(), 1e-12))));
    idx.sort((a, b) => keys[b] - keys[a]);
    for (let pos = 0; pos < n; pos++) {
      const i = idx[pos];
      finishSum[i] += pos + 1;
      if (pos === 0) win[i]++;
      if (pos < placeSlots) place[i]++;
      if (pos < 6) top6[i]++;
    }
  }
  return {
    place: place.map((c) => c / sims),
    top6: top6.map((c) => c / sims),
    expectedFinish: finishSum.map((c) => c / sims),
    win: win.map((c) => c / sims),
  };
}

export function strengthFromFactors(factors: FactorScore[]): { strength: number; completeness: number; raw: number; evidence: number } {
  let num = 0;
  let den = 0;
  let applicable = 0;
  let backed = 0;
  for (const f of factors) {
    const w = f.weight * f.dataQuality;
    num += w * f.score;
    den += w;
    applicable++;
    if (f.dataQuality >= 0.5) backed++;
  }
  const raw = den > 0 ? num / den : 0;
  // Shrink toward 0 when little data backs the view (den small). predictRace re-centres this on the field mean.
  const strength = raw * Math.min(1, den / 3.5);
  return { strength: round(strength, 4), completeness: applicable ? round(backed / applicable, 3) : 0, raw: round(raw, 4), evidence: round(den, 4) };
}

/** Forecast-only drift: the declared rating already reflects rain that has fallen; only race-day rain still to come should move it. */
export function forecastDrift(weather?: WeatherSummary): number {
  const mm = weather?.rainRaceDayMm ?? 0;
  return mm > 15 ? 2 : mm > 5 ? 1 : 0;
}

export function spearman(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return 1;
  const rank = (xs: number[]) => {
    const order = xs.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
    const r = new Array(n).fill(0);
    order.forEach(([, i], k) => (r[i] = k + 1));
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const d2 = ra.reduce((s, r, i) => s + (r - rb[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

export function rateConfidence(args: {
  ranked: RunnerAssessment[];
  race: Race;
  fetchedAt: string;
  now: Date;
  marketAvailable: boolean;
}): ConfidenceRating {
  const { ranked, race, now } = args;
  const top = ranked.slice(0, 6);
  const notes: string[] = [];
  const dataCompleteness = top.length ? round(mean(top.map((r) => r.dataCompleteness)), 3) : 0;
  const sourceAgreement = round(clamp(race.verification.score, 0, 1), 3);
  const p1 = ranked[0]?.winProb ?? 0;
  const p2 = ranked[1]?.winProb ?? 0;
  const separation = round(clamp((p1 - p2) / 0.15, 0, 1) * 0.5 + clamp(p1 / 0.45, 0, 1) * 0.5, 3);
  let marketAlignment = 0.5;
  if (args.marketAvailable) {
    const withMarket = ranked.filter((r) => r.marketWinProb != null);
    if (withMarket.length >= 3) {
      const rho = spearman(withMarket.map((r) => -r.winProb), withMarket.map((r) => -(r.marketWinProb || 0)));
      marketAlignment = round(clamp(0.3 + ((rho + 1) / 2) * 0.7, 0, 1), 3);
    }
  } else notes.push('No market prices were available, so there was no market cross-check.');
  const n = race.fieldSize;
  const fieldSize = round(n <= 8 ? 1 : n <= 10 ? 0.9 : n <= 12 ? 0.75 : n <= 14 ? 0.65 : 0.55, 3);
  const ageMin = Math.max(0, (now.getTime() - new Date(args.fetchedAt).getTime()) / 60000);
  const freshness = round(ageMin < 30 ? 1 : ageMin < 180 ? 0.85 : ageMin < 720 ? 0.7 : ageMin < 1440 ? 0.55 : 0.4, 3);

  // Conditions volatility (research §14): heavy tracks, big rail moves and late scratchings make races less predictable.
  let volatility = 0;
  const volatilityNotes: string[] = [];
  if ((race.trackRating ?? 0) >= 8) {
    volatility += 0.5;
    volatilityNotes.push(`Heavy ${race.trackRating} track`);
  } else if ((race.trackRating ?? 0) >= 6) volatility += 0.2;
  const railOut = Number((race.sourceRefs?.['entain.rail'] || '').match(/\+\s?(\d+(?:\.\d+)?)\s?m/)?.[1] || 0);
  if (railOut >= 6) {
    volatility += 0.25;
    volatilityNotes.push(`rail out ${railOut}m`);
  }
  const scratchings = race.runners.filter((r) => r.scratched).length;
  if (scratchings >= 3) {
    volatility += 0.25;
    volatilityNotes.push(`${scratchings} scratchings`);
  }
  volatility = clamp(volatility, 0, 1);
  if (volatilityNotes.length) notes.push(`Less predictable conditions: ${volatilityNotes.join(', ')}.`);
  if (dataCompleteness < 0.45) notes.push('Thin data on the leading chances: several factors had little or no information.');
  if (sourceAgreement < 0.6) notes.push('Sources disagreed or only one source covered this race – check scratchings and jockeys yourself.');
  if (separation < 0.3) notes.push('Very open race: little separates the top picks.');
  else if (separation > 0.7) notes.push('A clear standout at the top of the market and our ratings.');
  if (n >= 14) notes.push('Big field adds randomness.');
  if (freshness < 0.7) notes.push('Data is a few hours old – run a pre-race check before betting.');

  let overall = round(
    clamp(
      (dataCompleteness * 0.2 + sourceAgreement * 0.2 + separation * 0.3 + marketAlignment * 0.15 + fieldSize * 0.1 + freshness * 0.05) * 100 * (1 - 0.3 * volatility),
      0,
      100,
    ),
    0,
  );
  // Honesty caps (research §14): a top pick under 25% can never be more than "Fair"; under 35% never "High".
  if (p1 < 0.25) overall = Math.min(overall, 61);
  else if (p1 < 0.35) overall = Math.min(overall, 77);
  if ((ranked[0]?.dataCompleteness ?? 1) < 0.3) {
    overall = Math.min(overall, 61);
    notes.push('Our top pick has very little data behind it – do not trust this race.');
  }
  const label: ConfidenceRating['label'] = overall < 45 ? 'Low' : overall < 62 ? 'Fair' : overall < 78 ? 'Good' : 'High';
  if (p1 < 0.25 && !notes.some((n) => /open race/.test(n))) notes.push(`Top pick is only ${Math.round(p1 * 100)}% to win – treat this as an open race.`);
  return { overall, label, components: { dataCompleteness, sourceAgreement, separation, marketAlignment, fieldSize, freshness }, notes };
}

function reasonsAndConcerns(f: FactorScore[], runner: Runner): { reasons: string[]; concerns: string[] } {
  const sorted = [...f].filter((x) => x.dataQuality >= 0.3).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const reasons = sorted.filter((x) => x.contribution > 0.04).slice(0, 4).map((x) => `${x.label}: ${x.evidence}`);
  const concerns = sorted.filter((x) => x.contribution < -0.04).slice(0, 3).map((x) => `${x.label}: ${x.evidence}`);
  if (runner.verification.sourceCount <= 1) concerns.push('Only one source covers this runner – details unverified');
  if (runner.verification.conflicts.length) concerns.push(`Sources disagree: ${runner.verification.conflicts[0]}`);
  if (runner.emergency) concerns.push('Emergency – it only starts because of a scratching; check it is confirmed');
  return { reasons, concerns };
}

export function predictRace(raceIn: Race, opts: PredictOptions): Prediction {
  const now = opts.now ?? new Date();
  const race: Race = { ...raceIn, runners: summariseRaceMarket(beforeRaceDay(raceIn.runners, opts.raceDate)) };
  const jumpAt = Date.parse(raceIn.startTime ?? '');
  // Emergencies waiting for a vacancy are left out: they would take win chance from the real starters
  // and change the place terms.
  const active = starters(race.runners);
  race.fieldSize = active.length;
  const patterns = opts.dayPatterns || [];
  const weights = applyDayPatterns(BASE_WEIGHTS, patterns);
  const expectedRating = expectedTrackRating(race.trackRating, forecastDrift(opts.weather));
  const ctx: FactorContext = {
    race,
    venueSlug: opts.venueSlug,
    expectedTrackRating: expectedRating,
    news: (opts.news || []).filter((n) => !Number.isFinite(jumpAt) || !n.publishedAt || !(Date.parse(n.publishedAt) >= jumpAt)),
    now,
    fieldStats: computeFieldStats(race),
  };

  const scored = active.map((runner) => {
    const factors = evaluateRunner(runner, ctx, weights, patterns);
    const s = strengthFromFactors(factors);
    const bias = patterns.length ? patternBias(patterns, runner, active.length) : 0;
    return { runner, factors, ...s, bias };
  });
  // Shrink thin-data runners toward the field mean of data-backed runners, not toward "average horse" (0):
  // a debutant with no data must not out-rate a field whose data says they are below average.
  const backed = scored.filter((e) => e.completeness >= 0.4);
  const fieldMean = backed.length ? mean(backed.map((e) => e.raw)) : 0;
  const evaluated = scored.map((e) => {
    const shrink = Math.min(1, e.evidence / 3.5);
    const strength = fieldMean + (e.raw - fieldMean) * shrink + e.bias;
    return { runner: e.runner, factors: e.factors, strength, completeness: e.completeness };
  });

  const beta = opts.beta ?? 3.0;
  const modelProbs = softmax(evaluated.map((e) => e.strength * beta));
  const marketProbs = evaluated.map((e) => e.runner.market?.impliedWinProb);
  const marketAvailable = marketProbs.filter((p) => p != null).length >= Math.max(2, Math.floor(active.length * 0.6));
  // Benter-style pool: ~0.4 fundamentals / 0.6 market when prices are available (research/modelknowledge.md §13).
  const lambda = marketAvailable ? (opts.marketWeight ?? 0.55) : 0;
  // A runner nobody has priced gets a neutral market opinion (its own model probability), never a punitive guess.
  // The priced runners' market shares sum to 1 on their own, so scale them down to leave that room.
  const priced = (i: number) => marketProbs[i] != null && marketProbs[i]! > 0;
  const unpricedMass = modelProbs.reduce((a, p, i) => (priced(i) ? a : a + p), 0);
  let pooled = evaluated.map((e, i) => {
    const m = priced(i) ? marketProbs[i]! * (1 - unpricedMass) : modelProbs[i];
    return Math.exp((1 - lambda) * Math.log(Math.max(modelProbs[i], 1e-6)) + lambda * Math.log(Math.max(m, 1e-6)));
  });
  const total = pooled.reduce((a, b) => a + b, 0) || 1;
  pooled = pooled.map((p) => p / total);

  const sims = opts.simulations ?? 6000;
  const sim = active.length ? simulateOrders(pooled, sims, opts.seed ?? 7) : { place: [], top6: [], expectedFinish: [], win: [] };

  const ranked: RunnerAssessment[] = evaluated
    .map((e, i) => {
      const winProb = round(pooled[i], 4);
      const { reasons, concerns } = reasonsAndConcerns(e.factors, e.runner);
      const mp = marketProbs[i];
      if (marketAvailable && (mp == null || mp <= 0)) concerns.push('No price found for this runner – market cross-check unavailable');
      if (e.completeness < 0.3) concerns.push('Very little data on this runner – rating is mostly a guess');
      return {
        runnerId: e.runner.id,
        number: e.runner.number,
        name: e.runner.name,
        strength: round(e.strength, 4),
        winProb,
        placeProb: round(sim.place[i] ?? 0, 4),
        top6Prob: round(sim.top6[i] ?? 0, 4),
        expectedFinish: round(sim.expectedFinish[i] ?? 0, 2),
        rank: 0,
        factors: e.factors,
        reasons,
        concerns,
        marketWinProb: mp != null ? round(mp, 4) : undefined,
        bestOdds: e.runner.market?.bestWin,
        bestPlace: e.runner.market?.bestPlace,
        fairOdds: round(1 / Math.max(winProb, 0.001), 2),
        valueEdge: e.runner.market?.bestWin ? round(expectedReturn(winProb, e.runner.market.bestWin), 4) : undefined,
        dataCompleteness: e.completeness,
        verificationScore: e.runner.verification.score,
      };
    })
    .sort((a, b) => b.winProb - a.winProb || a.expectedFinish - b.expectedFinish);
  ranked.forEach((r, i) => (r.rank = i + 1));

  const confidence = rateConfidence({ ranked, race, fetchedAt: race.fetchedAt, now, marketAvailable });
  const top = ranked.slice(0, 6);
  const betting = buildBettingPlan({ race, ranked, confidence, settings: opts.settings });
  const summary = summarise(race, ranked, confidence, patterns);
  const prediction: Prediction = {
    raceNumber: race.number,
    generatedAt: now.toISOString(),
    ranked,
    top,
    confidence,
    betting,
    summary,
    dayPatternsApplied: patterns,
    modelVersion: MODEL_VERSION,
  };
  if (opts.previous) prediction.changes = diffPredictions(opts.previous, prediction, raceIn);
  return prediction;
}

/**
 * Runners as they stood before race day: a feed read after the race lists that day's run as the latest start and
 * counts it in the career record, which would hand a race rated afterwards its own result. Those runs are taken out
 * of the form and the career record (track, distance and going records cannot be split, so they stay as given).
 */
export function beforeRaceDay(runners: Runner[], raceDate?: string): Runner[] {
  if (!raceDate) return runners;
  return runners.map((r) => {
    const later = (r.form || []).filter((f) => f.date && f.date.slice(0, 10) >= raceDate);
    if (!later.length) return r;
    const career = r.career && {
      ...r.career,
      starts: Math.max(0, r.career.starts - later.length),
      wins: Math.max(0, r.career.wins - later.filter((f) => f.position === 1).length),
      seconds: Math.max(0, r.career.seconds - later.filter((f) => f.position === 2).length),
      thirds: Math.max(0, r.career.thirds - later.filter((f) => f.position === 3).length),
    };
    return { ...r, form: r.form.filter((f) => !later.includes(f)), career };
  });
}

function summarise(race: Race, ranked: RunnerAssessment[], c: ConfidenceRating, patterns: DayPattern[]): string {
  if (!ranked.length) return 'No active runners to assess.';
  const t = ranked[0];
  const second = ranked[1];
  const bits = [`${t.name} (${t.number}) is our top pick at ${Math.round(t.winProb * 100)}% to win${t.bestOdds ? ` (best $${t.bestOdds.toFixed(2)})` : ''}.`];
  if (second) bits.push(`${second.name} (${second.number}) next at ${Math.round(second.winProb * 100)}%.`);
  if (t.valueEdge != null && t.bestOdds && t.valueEdge >= VALUE_MARGIN) bits.push(`$${t.bestOdds.toFixed(2)} is better than our fair price of $${t.fairOdds.toFixed(2)} – value.`);
  else if (t.valueEdge != null && t.bestOdds && t.valueEdge < 0) bits.push(`$${t.bestOdds.toFixed(2)} is under our fair price of $${t.fairOdds.toFixed(2)} – no value on top at that price.`);
  bits.push(`Confidence ${c.label.toLowerCase()} (${c.overall}/100).`);
  if (patterns.length) bits.push(`Adjusted for today's patterns: ${patterns.map((p) => p.label).join(', ')}.`);
  void race;
  return bits.join(' ');
}

export function diffPredictions(prev: Prediction, next: Prediction, race: Race): string[] {
  const changes: string[] = [];
  const prevTop = prev.top.map((r) => r.number);
  const nextTop = next.top.map((r) => r.number);
  if (prevTop[0] !== nextTop[0]) {
    const was = prev.top[0];
    const now = next.top[0];
    if (was && now) changes.push(`Top pick changed: ${was.name} (${was.number}) → ${now.name} (${now.number})`);
  }
  for (const r of next.top) {
    const before = prev.ranked.find((x) => x.runnerId === r.runnerId);
    if (before && before.rank !== r.rank && Math.abs(before.rank - r.rank) >= 1 && (before.rank <= 6 || r.rank <= 6)) changes.push(`${r.name} moved ${before.rank} → ${r.rank}`);
    if (before && before.bestOdds && r.bestOdds && Math.abs(r.bestOdds - before.bestOdds) / before.bestOdds >= 0.1) changes.push(`${r.name} price $${before.bestOdds.toFixed(2)} → $${r.bestOdds.toFixed(2)} (${r.bestOdds < before.bestOdds ? 'firming' : 'drifting'})`);
  }
  for (const n of prevTop) if (!nextTop.includes(n)) {
    const r = race.runners.find((x) => x.number === n);
    if (r?.scratched) changes.push(`${r.name} (${n}) scratched`);
    else if (r) changes.push(`${r.name} (${n}) dropped out of the top 6`);
  }
  if (prev.confidence.overall !== next.confidence.overall) changes.push(`Confidence ${prev.confidence.overall} → ${next.confidence.overall} (${next.confidence.label})`);
  if (next.dayPatternsApplied.length && !prev.dayPatternsApplied.length) changes.push(`Applied day patterns: ${next.dayPatternsApplied.map((p) => p.label).join(', ')}`);
  return changes;
}
