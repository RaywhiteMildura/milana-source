import type { DayPattern, FactorScore, FormLine, NewsItem, Race, Runner } from '../../shared/types.js';
import { clamp, mean, parseLastStarts, round, stddev } from '../../shared/util.js';
import { jockeyTier, trainerTier, STAMINA_SIRES, VENUE_TWEAKS, WET_TRACK_SIRES } from './knowledge.js';
import { wetTrackFactor } from './weather.js';
import { newsFactorForRunner } from './news.js';

/**
 * Factor library. Each factor returns a standardised score in [-1, 1] plus a
 * data-quality estimate in [0, 1] and a human-readable evidence string. The
 * model (model.ts) weights them; weights are adjusted by day patterns.
 */

export interface FactorContext {
  race: Race;
  venueSlug: string;
  expectedTrackRating?: number;
  news: NewsItem[];
  now: Date;
  /** Field mean weight, etc. computed once per race */
  fieldStats: FieldStats;
}

export interface FieldStats {
  meanWeight?: number;
  meanCareerWin: number;
  meanCareerPlace: number;
  leaders: number;
  active: number;
  ratingStats: Record<string, { mean: number; sd: number }>;
  prizeLevel?: number;
}

export type FactorFn = (runner: Runner, ctx: FactorContext) => Omit<FactorScore, 'weight' | 'contribution'>;

/**
 * Factor weights. Starting values follow the evidence review in
 * research/modelknowledge.md §13 (Benter-style fundamentals + market blend):
 * form and class dominate; jockey, trainer, weight and gear are real but
 * largely already priced by the market, so they carry less.
 */
export const BASE_WEIGHTS: Record<string, number> = {
  recentForm: 1.0,
  classSuitability: 0.85,
  trackDistance: 0.75,
  wetForm: 0.6,
  barrier: 0.5,
  pace: 0.6,
  jockey: 0.35,
  trainer: 0.35,
  weight: 0.3,
  fitness: 0.55,
  careerStrike: 0.45,
  sourceRatings: 0.7,
  moneyMove: 0.3,
  news: 0.3,
  gear: 0.15,
  lineage: 0.15,
};

export const FACTOR_LABELS: Record<string, string> = {
  recentForm: 'Recent form',
  classSuitability: 'Class',
  trackDistance: 'Track & distance',
  wetForm: 'Track condition',
  barrier: 'Barrier draw',
  pace: 'Pace & racing pattern',
  jockey: 'Jockey',
  trainer: 'Trainer',
  weight: 'Weight',
  fitness: 'Fitness & freshness',
  careerStrike: 'Career record',
  sourceRatings: 'Published ratings',
  moneyMove: 'Market move',
  news: 'News & rumours',
  gear: 'Gear changes',
  lineage: 'Breeding',
};

export function computeFieldStats(race: Race): FieldStats {
  const active = race.runners.filter((r) => !r.scratched);
  const weights = active.map((r) => r.weight).filter((w): w is number => typeof w === 'number' && w > 0);
  const winRates = active.map((r) => (r.career && r.career.starts > 0 ? r.career.wins / r.career.starts : undefined)).filter((x): x is number => x != null);
  const placeRates = active
    .map((r) => (r.career && r.career.starts > 0 ? (r.career.wins + r.career.seconds + r.career.thirds) / r.career.starts : undefined))
    .filter((x): x is number => x != null);
  const ratingStats: FieldStats['ratingStats'] = {};
  const keys = new Set(active.flatMap((r) => Object.keys(r.ratings || {})));
  for (const k of keys) {
    const vals = active.map((r) => r.ratings?.[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (vals.length >= 3) ratingStats[k] = { mean: mean(vals), sd: stddev(vals) || 1 };
  }
  return {
    meanWeight: weights.length ? mean(weights) : undefined,
    meanCareerWin: winRates.length ? mean(winRates) : 0.12,
    meanCareerPlace: placeRates.length ? mean(placeRates) : 0.35,
    leaders: active.filter((r) => r.speedMapPosition === 'leader').length,
    active: active.length,
    ratingStats,
    prizeLevel: race.prize,
  };
}

const neutral = (key: string, evidence = 'No data'): Omit<FactorScore, 'weight' | 'contribution'> => ({
  key,
  label: FACTOR_LABELS[key] || key,
  score: 0,
  evidence,
  dataQuality: 0,
});

/** Quality of a single past run: 1 = won, down to about -0.6 for a well-beaten run. */
export function runQuality(f: Pick<FormLine, 'position' | 'starters' | 'margin'>): number {
  const pos = f.position;
  if (!pos || pos < 1) return 0;
  let q = pos === 1 ? 1 : pos === 2 ? 0.65 : pos === 3 ? 0.45 : pos <= 5 ? 0.2 : pos <= 8 ? -0.1 : -0.4;
  if (typeof f.margin === 'number') {
    if (pos > 1 && f.margin <= 1) q += 0.15;
    else if (pos > 1 && f.margin <= 2.5) q += 0.05;
    else if (f.margin >= 6) q -= 0.2;
  }
  if (f.starters && f.starters <= 6 && pos <= 3) q -= 0.1; // small fields flatter placings
  return clamp(q, -0.7, 1);
}

export const recentForm: FactorFn = (r) => {
  const lines = r.form.slice(0, 5);
  const weights = [0.4, 0.25, 0.15, 0.12, 0.08];
  if (lines.length) {
    let s = 0;
    let w = 0;
    lines.forEach((f, i) => {
      s += runQuality(f) * weights[i];
      w += weights[i];
    });
    const score = clamp((s / w - 0.15) * 1.5, -1, 1);
    const desc = lines.map((f) => `${f.position}/${f.starters}${f.margin != null && f.position > 1 ? ` (${f.margin}L)` : ''}`).join(', ');
    return { key: 'recentForm', label: FACTOR_LABELS.recentForm, score: round(score, 3), evidence: `Last ${lines.length}: ${desc}`, dataQuality: Math.min(1, 0.5 + lines.length * 0.1) };
  }
  const ls = parseLastStarts(r.last5);
  if (ls.length) {
    const recent = [...ls].reverse().filter((x) => x !== 'x') as number[];
    if (!recent.length) return neutral('recentForm', 'Resuming from a spell');
    let s = 0;
    let w = 0;
    recent.slice(0, 5).forEach((p, i) => {
      s += runQuality({ position: p, starters: 10 }) * weights[i];
      w += weights[i];
    });
    return { key: 'recentForm', label: FACTOR_LABELS.recentForm, score: round(clamp((s / w - 0.15) * 1.5, -1, 1), 3), evidence: `Last starts ${r.last5}`, dataQuality: 0.45 };
  }
  return neutral('recentForm');
};

const CLASS_ORDER: Array<[RegExp, number]> = [
  [/\bg(?:roup)?\s*1\b|\bgroup one\b/i, 9],
  [/\bg(?:roup)?\s*2\b/i, 8],
  [/\bg(?:roup)?\s*3\b/i, 7],
  [/\blisted\b|\blr\b/i, 6],
  [/\bbm\s?(9\d|1\d\d)\b|\bbenchmark\s?(9\d|1\d\d)/i, 5.5],
  [/\bbm\s?(7\d|8\d)\b|\bbenchmark\s?(7\d|8\d)/i, 4.5],
  [/\bbm\s?(5\d|6\d)\b|\bbenchmark\s?(5\d|6\d)/i, 3.5],
  [/\bmaiden\b|\bmdn\b/i, 1],
  [/\btrial\b/i, 0.5],
  [/\bclass\s?[1-3]\b|\bcl[1-3]\b|\brestricted\b/i, 3],
  [/\bopen\b|\bquality\b|\bhcp\b|\bhandicap\b/i, 5],
];

export function classLevel(text?: string, prize?: number): number | undefined {
  if (text) for (const [re, lvl] of CLASS_ORDER) if (re.test(text)) return lvl;
  if (prize) {
    if (prize >= 1_000_000) return 9;
    if (prize >= 300_000) return 7.5;
    if (prize >= 150_000) return 6;
    if (prize >= 80_000) return 5;
    if (prize >= 40_000) return 4;
    if (prize >= 20_000) return 3;
    return 2;
  }
  return undefined;
}

export const classSuitability: FactorFn = (r, ctx) => {
  const today = classLevel(ctx.race.raceClass || ctx.race.group || ctx.race.name, ctx.race.prize);
  const recent = r.form.slice(0, 4).map((f) => ({ lvl: classLevel(f.raceClass, f.prize), q: runQuality(f) })).filter((x) => x.lvl != null) as Array<{ lvl: number; q: number }>;
  if (today == null || !recent.length) return neutral('classSuitability', 'Class of recent races unknown');
  const avg = mean(recent.map((x) => x.lvl));
  const diff = avg - today; // positive: dropping in class
  let score = clamp(diff * 0.35, -0.8, 0.8);
  // Has it performed at this level or higher?
  const provenAtLevel = recent.some((x) => x.lvl >= today && x.q >= 0.45);
  if (provenAtLevel) score += 0.2;
  const outclassed = recent.filter((x) => x.lvl >= today).every((x) => x.q < 0) && recent.some((x) => x.lvl >= today);
  if (outclassed) score -= 0.25;
  const evidence = diff > 0.5 ? `Drops in class (recent avg level ${avg.toFixed(1)} vs today ${today})` : diff < -0.5 ? `Steps up in class (recent avg ${avg.toFixed(1)} vs today ${today})` : `Racing at a similar level${provenAtLevel ? ', has placed at this grade' : ''}`;
  return { key: 'classSuitability', label: FACTOR_LABELS.classSuitability, score: round(clamp(score, -1, 1), 3), evidence, dataQuality: 0.4 + Math.min(0.5, recent.length * 0.12) };
};

function rate(s?: { starts: number; wins: number; seconds: number; thirds: number }): { win: number; place: number; n: number } | undefined {
  if (!s || !s.starts) return undefined;
  return { win: s.wins / s.starts, place: (s.wins + s.seconds + s.thirds) / s.starts, n: s.starts };
}

export const trackDistance: FactorFn = (r, ctx) => {
  const career = rate(r.career);
  const parts: string[] = [];
  let score = 0;
  let dq = 0;
  const consider = (label: string, s?: { starts: number; wins: number; seconds: number; thirds: number }, weight = 1) => {
    const x = rate(s);
    if (!x) return;
    const baseWin = career?.win ?? ctx.fieldStats.meanCareerWin;
    const basePlace = career?.place ?? ctx.fieldStats.meanCareerPlace;
    const shrink = x.n / (x.n + 3); // small samples shrink toward 0
    const delta = ((x.win - baseWin) * 1.5 + (x.place - basePlace)) * shrink;
    score += delta * weight;
    dq += 0.3 * Math.min(1, x.n / 4) * weight;
    parts.push(`${label} ${s!.wins}-${s!.seconds}-${s!.thirds} from ${s!.starts}`);
  };
  consider('Track/dist', r.splits?.trackDistance, 1.2);
  consider('Track', r.splits?.track, 0.8);
  consider('Distance', r.splits?.distance, 1.0);
  // Form lines within +-100m of today's trip
  const near = r.form.filter((f) => Math.abs(f.distance - ctx.race.distance) <= 100);
  if (near.length) {
    const q = mean(near.map(runQuality));
    score += (q - 0.15) * 0.6;
    dq += 0.25 * Math.min(1, near.length / 3);
    parts.push(`${near.length} run${near.length > 1 ? 's' : ''} near ${ctx.race.distance}m avg quality ${(q * 100).toFixed(0)}%`);
  }
  if (!parts.length) {
    // First time at distance? Lineage hint via STAMINA sires for 2000m+
    if (ctx.race.distance >= 2000 && r.sire && STAMINA_SIRES.has(r.sire.toLowerCase())) return { key: 'trackDistance', label: FACTOR_LABELS.trackDistance, score: 0.1, evidence: `Untried at ${ctx.race.distance}m; by stamina sire ${r.sire}`, dataQuality: 0.2 };
    return neutral('trackDistance', `No track/distance record available`);
  }
  return { key: 'trackDistance', label: FACTOR_LABELS.trackDistance, score: round(clamp(score, -1, 1), 3), evidence: parts.join('; '), dataQuality: clamp(dq, 0, 1) };
};

export const wetForm: FactorFn = (r, ctx) => {
  const rating = ctx.expectedTrackRating ?? ctx.race.trackRating;
  const base = wetTrackFactor(r, rating);
  let { score, evidence, dataQuality } = base;
  if (rating != null && rating >= 6 && dataQuality < 0.3 && r.sire && WET_TRACK_SIRES.has(r.sire.toLowerCase())) {
    score += 0.15;
    evidence += `; sire ${r.sire} gets wet-trackers`;
    dataQuality = Math.max(dataQuality, 0.3);
  }
  return { key: 'wetForm', label: FACTOR_LABELS.wetForm, score: round(clamp(score, -1, 1), 3), evidence, dataQuality };
};

export const barrier: FactorFn = (r, ctx) => {
  const n = ctx.fieldStats.active;
  if (!r.barrier || n < 2) return neutral('barrier', 'Barrier unknown');
  const rel = clamp((r.barrier - 1) / Math.max(1, n - 1), 0, 1); // 0 inside .. 1 outside
  const d = ctx.race.distance;
  let distFactor = d <= 1200 ? 1.0 : d <= 1600 ? 0.9 : d <= 2100 ? 0.6 : 0.4;
  const tweak = VENUE_TWEAKS[ctx.venueSlug]?.barrierEffect;
  if (tweak) distFactor *= tweak(d);
  const sizeFactor = n <= 8 ? 0.6 : n <= 12 ? 0.85 : 1.0;
  // Inside third mild positive, middle neutral, outside third negative (wider is worse).
  let raw = rel < 0.33 ? 0.3 - rel * 0.3 : rel < 0.66 ? 0.05 - (rel - 0.33) * 0.4 : -0.1 - (rel - 0.66) * 1.2;
  // Very inside barriers in big fields over middle distances can get trapped: soften slightly.
  if (r.barrier <= 2 && n >= 14 && d >= 1400) raw -= 0.08;
  const score = clamp(raw * distFactor * sizeFactor, -1, 1);
  const where = rel < 0.33 ? 'inside' : rel < 0.66 ? 'middle' : 'wide';
  return { key: 'barrier', label: FACTOR_LABELS.barrier, score: round(score, 3), evidence: `Barrier ${r.barrier} of ${n} (${where})${tweak ? ' – venue-adjusted' : ''}`, dataQuality: 0.9 };
};

export const pace: FactorFn = (r, ctx) => {
  const pos = r.speedMapPosition || inferPosition(r);
  if (!pos) return neutral('pace', 'Racing pattern unknown');
  const d = ctx.race.distance;
  const leaders = ctx.fieldStats.leaders;
  let base = pos === 'leader' ? 0.3 : pos === 'on-pace' ? 0.3 : pos === 'midfield' ? 0 : -0.2;
  if (d <= 1200) base *= 1.15;
  if (leaders >= 3) {
    // Pace pressure: leaders suffer, swoopers benefit
    if (pos === 'leader') base -= 0.35;
    if (pos === 'backmarker') base += 0.35;
  } else if (leaders <= 1 && pos === 'leader') base += 0.2; // lone leader
  const tweak = VENUE_TWEAKS[ctx.venueSlug]?.paceEffect;
  if (tweak) base *= tweak(d);
  const inferred = r.speedMapPosition ? '' : ' (inferred from recent settling positions)';
  return { key: 'pace', label: FACTOR_LABELS.pace, score: round(clamp(base, -1, 1), 3), evidence: `Expected to settle ${pos}${leaders >= 3 ? `, ${leaders} likely leaders = pressure` : leaders <= 1 && pos === 'leader' ? ', may lead uncontested' : ''}${inferred}`, dataQuality: r.speedMapPosition ? 0.8 : 0.5 };
};

export function inferPosition(r: Runner): Runner['speedMapPosition'] | undefined {
  const firsts = r.form
    .slice(0, 4)
    .map((f) => f.inRunning?.split(/[-\/,\s]+/).map(Number).find((n) => !Number.isNaN(n)))
    .filter((n): n is number => typeof n === 'number');
  if (!firsts.length) return undefined;
  const avg = mean(firsts);
  const sizes = r.form.slice(0, 4).map((f) => f.starters || 10);
  const rel = avg / Math.max(1, mean(sizes));
  if (avg <= 1.5) return 'leader';
  if (rel <= 0.35) return 'on-pace';
  if (rel <= 0.7) return 'midfield';
  return 'backmarker';
}

export const jockey: FactorFn = (r) => {
  if (!r.jockey) return neutral('jockey', 'Jockey not yet declared');
  const tier = jockeyTier(r.jockey);
  let score = tier === 'A' ? 0.6 : tier === 'B' ? 0.3 : 0;
  const parts = [tier ? `${r.jockey}: ${tier === 'A' ? 'elite' : 'strong'} rider` : `${r.jockey}`];
  let dq = tier ? 0.7 : 0.4;
  const js = r.jockeyStats;
  const pct = js?.recentWinPct ?? js?.winPct;
  if (pct != null && pct > 0) {
    // Published strike rate beats our tier table: 10% is average, 20%+ elite.
    const statScore = clamp((pct - 10) / 14, -0.6, 0.8);
    score = tier ? (score + statScore) / 2 : statScore;
    parts.push(`${pct.toFixed(0)}% ${js?.recentWinPct != null ? 'recent ' : ''}strike rate`);
    dq = 0.85;
  }
  if (r.claim && r.claim > 0) {
    score -= 0.1;
    parts.push(`apprentice claiming ${r.claim}kg`);
  }
  const combo = rate(r.splits?.jockey);
  if (combo && combo.n >= 2) {
    score += (combo.win - 0.15) * 1.2 * Math.min(1, combo.n / 4);
    parts.push(`combination ${r.splits!.jockey!.wins} wins from ${combo.n}`);
  }
  return { key: 'jockey', label: FACTOR_LABELS.jockey, score: round(clamp(score, -1, 1), 3), evidence: parts.join('; '), dataQuality: dq };
};

export const trainer: FactorFn = (r) => {
  if (!r.trainer) return neutral('trainer', 'Trainer unknown');
  const tier = trainerTier(r.trainer);
  let score = tier === 'A' ? 0.5 : tier === 'B' ? 0.25 : 0;
  let dq = tier ? 0.65 : 0.35;
  const parts = [tier ? `${r.trainer}: ${tier === 'A' ? 'leading' : 'strong'} stable` : `${r.trainer}`];
  const ts = r.trainerStats;
  const pct = ts?.recentWinPct ?? ts?.winPct;
  if (pct != null && pct > 0) {
    const statScore = clamp((pct - 10) / 14, -0.6, 0.8);
    score = tier ? (score + statScore) / 2 : statScore;
    parts.push(`${pct.toFixed(0)}% ${ts?.recentWinPct != null ? 'recent ' : ''}strike rate`);
    dq = 0.8;
  }
  return { key: 'trainer', label: FACTOR_LABELS.trainer, score: round(clamp(score, -1, 1), 3), evidence: parts.join('; '), dataQuality: dq };
};

export const weight: FactorFn = (r, ctx) => {
  if (!r.weight || !ctx.fieldStats.meanWeight) return neutral('weight', 'Weight unknown');
  const carried = r.weight - (r.claim || 0);
  const diff = carried - ctx.fieldStats.meanWeight;
  const distMult = ctx.race.distance >= 1800 ? 1.3 : ctx.race.distance >= 1400 ? 1.0 : 0.8;
  const isWfa = /wfa|weight.?for.?age|set weights|sw\b/i.test(`${ctx.race.raceClass || ''} ${ctx.race.name || ''}`);
  let score = isWfa ? 0 : clamp(-diff * 0.09 * distMult, -0.8, 0.8);
  const parts = [`${carried.toFixed(1)}kg vs field avg ${ctx.fieldStats.meanWeight.toFixed(1)}kg`];
  const last = r.form[0];
  if (last?.weight && !isWfa) {
    const change = carried - last.weight;
    if (Math.abs(change) >= 1.5) {
      score -= clamp(change * 0.05, -0.2, 0.2);
      parts.push(`${change > 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(1)}kg on last start`);
    }
  }
  if (isWfa) parts.push('set weights / WFA so little effect');
  return { key: 'weight', label: FACTOR_LABELS.weight, score: round(score, 3), evidence: parts.join('; '), dataQuality: isWfa ? 0.3 : 0.75 };
};

export const fitness: FactorFn = (r, ctx) => {
  let days = r.daysSinceLastRun;
  if (days == null && r.form[0]?.date && ctx.race.startTime) {
    days = Math.round((new Date(ctx.race.startTime).getTime() - new Date(r.form[0].date).getTime()) / 86400000);
  }
  if (days == null || Number.isNaN(days)) return neutral('fitness', 'Last start date unknown');
  let score: number;
  let evidence: string;
  const firstUp = rate(r.splits?.firstUp);
  const secondUp = rate(r.splits?.secondUp);
  if (days <= 6) {
    score = -0.15;
    evidence = `Backs up after ${days} days`;
  } else if (days <= 13) {
    score = 0.1;
    evidence = `${days} days since last run (quick back-up)`;
  } else if (days <= 35) {
    score = 0.3;
    evidence = `${days} days since last run – ideal spacing`;
  } else if (days <= 60) {
    score = 0.05;
    evidence = `${days} days between runs`;
  } else {
    score = -0.25;
    evidence = `Resumes after ${days} days`;
    if (firstUp) {
      score += (firstUp.win - 0.15) * 2 + (firstUp.place - 0.4) * 0.8;
      evidence += `; first-up record ${r.splits!.firstUp!.wins}-${r.splits!.firstUp!.seconds}-${r.splits!.firstUp!.thirds} from ${firstUp.n}`;
    }
  }
  // Second-up: previous start was first-up (gap > 90 days before it)
  const prevGap = r.form.length >= 2 ? Math.round((new Date(r.form[0].date).getTime() - new Date(r.form[1].date).getTime()) / 86400000) : undefined;
  if (prevGap != null && prevGap > 90 && days <= 35 && secondUp) {
    score += (secondUp.win - 0.15) * 1.5;
    evidence += `; second-up record ${r.splits!.secondUp!.wins} wins from ${secondUp.n}`;
  }
  return { key: 'fitness', label: FACTOR_LABELS.fitness, score: round(clamp(score, -1, 1), 3), evidence, dataQuality: 0.7 };
};

export const careerStrike: FactorFn = (r, ctx) => {
  const c = rate(r.career);
  if (!c) return neutral('careerStrike', 'No career record');
  if (c.n < 2) return { key: 'careerStrike', label: FACTOR_LABELS.careerStrike, score: 0, evidence: `Lightly raced (${c.n} start${c.n === 1 ? '' : 's'})`, dataQuality: 0.2 };
  const shrink = c.n / (c.n + 4);
  const score = clamp(((c.win - ctx.fieldStats.meanCareerWin) * 2.5 + (c.place - ctx.fieldStats.meanCareerPlace) * 1.2) * shrink, -1, 1);
  return { key: 'careerStrike', label: FACTOR_LABELS.careerStrike, score: round(score, 3), evidence: `${r.career!.starts}: ${r.career!.wins}-${r.career!.seconds}-${r.career!.thirds} (${Math.round(c.win * 100)}% win, ${Math.round(c.place * 100)}% place)`, dataQuality: Math.min(1, 0.4 + c.n * 0.05) };
};

export const sourceRatings: FactorFn = (r, ctx) => {
  const zs: number[] = [];
  const names: string[] = [];
  for (const [k, st] of Object.entries(ctx.fieldStats.ratingStats)) {
    const v = r.ratings?.[k];
    if (typeof v !== 'number') continue;
    zs.push((v - st.mean) / (st.sd || 1));
    names.push(`${k} ${v}`);
  }
  if (!zs.length) return neutral('sourceRatings', 'No published ratings');
  const score = clamp(mean(zs) / 1.8, -1, 1);
  return { key: 'sourceRatings', label: FACTOR_LABELS.sourceRatings, score: round(score, 3), evidence: names.join(', '), dataQuality: Math.min(1, 0.5 + zs.length * 0.2) };
};

export const moneyMove: FactorFn = (r) => {
  const m = r.market;
  if (!m || m.movePct == null) return neutral('moneyMove', 'No price history yet');
  const score = clamp(-m.movePct / 25, -0.8, 0.8);
  const word = m.mover === 'firming' ? 'Firming' : m.mover === 'drifting' ? 'Drifting' : 'Steady';
  return { key: 'moneyMove', label: FACTOR_LABELS.moneyMove, score: round(score, 3), evidence: `${word} ${m.movePct > 0 ? '+' : ''}${m.movePct}% since opening${m.bestWin ? ` (best $${m.bestWin.toFixed(2)})` : ''}`, dataQuality: 0.6 };
};

export const news: FactorFn = (r, ctx) => {
  const n = newsFactorForRunner(ctx.news, r.name, ctx.now);
  if (!n.dataQuality) return neutral('news', 'No news mentions found');
  return { key: 'news', label: FACTOR_LABELS.news, score: round(clamp(n.score, -1, 1), 3), evidence: n.evidence, dataQuality: n.dataQuality };
};

export const gear: FactorFn = (r) => {
  if (!r.gearChanges.length) return neutral('gear', 'No gear changes');
  let score = 0;
  for (const g of r.gearChanges) {
    const t = g.toLowerCase();
    if (/blinkers.*(first time|on)|(first time|on).*blinkers/.test(t)) score += 0.15;
    else if (/blinkers.*off|off.*blinkers/.test(t)) score -= 0.05;
    else if (/tongue tie/.test(t)) score += 0.05;
    else if (/winkers|visor|pacifiers/.test(t)) score += 0.05;
    else if (/bar plates|concussion plates|ear muffs/.test(t)) score -= 0.03;
  }
  return { key: 'gear', label: FACTOR_LABELS.gear, score: round(clamp(score, -0.5, 0.5), 3), evidence: r.gearChanges.join(', '), dataQuality: 0.5 };
};

export const lineage: FactorFn = (r, ctx) => {
  if (!r.sire) return neutral('lineage', 'Breeding unknown');
  const parts = [`${r.sire} x ${r.dam || '?'}${r.damSire ? ` (${r.damSire})` : ''}`];
  let score = 0;
  let dq = 0.15;
  if (ctx.race.distance >= 2000 && STAMINA_SIRES.has(r.sire.toLowerCase())) {
    score += 0.15;
    dq = 0.3;
    parts.push('stamina influence on sire side');
  }
  if (ctx.race.distance >= 2000 && r.damSire && STAMINA_SIRES.has(r.damSire.toLowerCase())) {
    score += 0.1;
    dq = Math.max(dq, 0.25);
    parts.push('stamina on dam side');
  }
  return { key: 'lineage', label: FACTOR_LABELS.lineage, score: round(score, 3), evidence: parts.join('; '), dataQuality: dq };
};

export const FACTORS: Record<string, FactorFn> = {
  recentForm,
  classSuitability,
  trackDistance,
  wetForm,
  barrier,
  pace,
  jockey,
  trainer,
  weight,
  fitness,
  careerStrike,
  sourceRatings,
  moneyMove,
  news,
  gear,
  lineage,
};

/** Evaluate all factors for a runner with the supplied weights. */
export function evaluateRunner(runner: Runner, ctx: FactorContext, weights: Record<string, number> = BASE_WEIGHTS, patterns: DayPattern[] = []): FactorScore[] {
  void patterns;
  const out: FactorScore[] = [];
  for (const [key, fn] of Object.entries(FACTORS)) {
    let res: Omit<FactorScore, 'weight' | 'contribution'>;
    try {
      res = fn(runner, ctx);
    } catch (err) {
      res = neutral(key, `Factor failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const w = weights[key] ?? BASE_WEIGHTS[key] ?? 0.3;
    out.push({ ...res, weight: w, contribution: round(res.score * w * res.dataQuality, 4) });
  }
  return out;
}
