import type { BetSuggestion, BettingPlan, ConfidenceRating, Race, RunnerAssessment, Settings } from '../../shared/types.js';
import { clamp, round } from '../../shared/util.js';

/**
 * Betting structure planner. Produces a suggested set of bets sized by
 * confidence and value. Suggestions only – the user places (or doesn't place)
 * the bets. Follows Australian conventions: place pays 3 with 8+ runners,
 * 2 with 5–7, none under 5.
 */

const PROFILE = {
  conservative: { maxUnits: 1.5, kelly: 0.15, exotics: false, first4: false },
  balanced: { maxUnits: 3, kelly: 0.25, exotics: true, first4: false },
  aggressive: { maxUnits: 5, kelly: 0.4, exotics: true, first4: true },
} as const;

export function placeSlots(fieldSize: number): number {
  return fieldSize >= 8 ? 3 : fieldSize >= 5 ? 2 : 0;
}

export function kellyFraction(prob: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const f = (prob * b - (1 - prob)) / b;
  return Math.max(0, f);
}

export function combinations(n: number, k: number): number {
  if (k > n || k < 0) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

export function permutations(n: number, k: number): number {
  if (k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r *= n - i;
  return r;
}

export function buildBettingPlan(args: { race: Race; ranked: RunnerAssessment[]; confidence: ConfidenceRating; settings: Settings }): BettingPlan {
  const { race, ranked, confidence, settings } = args;
  const profile = PROFILE[settings.riskProfile] || PROFILE.balanced;
  const unit = settings.unitAmount || 10;
  const notes: string[] = [];
  const suggestions: BetSuggestion[] = [];
  const n = race.fieldSize;
  const slots = placeSlots(n);
  const top = ranked.slice(0, 6);

  if (!top.length) return { stance: 'skip', unitAmount: unit, totalUnits: 0, totalAmount: 0, suggestions: [], notes: ['No active runners.'] };

  // Stance -----------------------------------------------------------------
  let stance: BettingPlan['stance'];
  if (confidence.overall < 38 || race.verification.score < 0.45) stance = 'skip';
  else if (confidence.overall < 50) stance = 'watch';
  else if (confidence.overall < 65) stance = 'small';
  else stance = 'bet';
  if (race.verification.score < 0.45) notes.push('Field details are poorly verified across sources – do not bet until you have checked scratchings and riders.');
  if (stance === 'skip') notes.push('Confidence is too low for a recommended bet. Watch only.');
  if (stance === 'watch') notes.push('Open race. Treat any bet here as a small speculative play or pass.');

  const scale = stance === 'bet' ? 1 : stance === 'small' ? 0.5 : stance === 'watch' ? 0.25 : 0;
  const maxUnits = profile.maxUnits * scale;
  let unitsLeft = maxUnits;
  const spend = (u: number) => {
    const used = Math.min(u, Math.max(0, unitsLeft));
    unitsLeft -= used;
    return round(used, 2);
  };
  const money = (u: number) => round(u * unit, 2);

  const t1 = top[0];
  const t2 = top[1];
  const t3 = top[2];
  const odds1 = t1.bestOdds;
  const fair1 = t1.fairOdds;

  if (scale > 0) {
    // Core win bet ----------------------------------------------------------
    const edge = t1.valueEdge ?? 0;
    if (t1.winProb >= 0.2 && edge >= -0.03) {
      const k = odds1 ? kellyFraction(t1.winProb, odds1) : 0.05;
      let units = clamp((k * profile.kelly * settings.bankroll) / unit, 0.5, 2) * scale;
      const eachWay = odds1 != null && odds1 >= 4 && odds1 <= 12 && slots === 3 && t1.placeProb >= 0.5;
      units = spend(units);
      if (units > 0) {
        suggestions.push({
          type: eachWay ? 'each-way' : 'win',
          runners: [t1.number],
          stakeUnits: units,
          stakeAmount: money(units * (eachWay ? 2 : 1)),
          rationale: eachWay
            ? `${t1.name} is our top pick (${pct(t1.winProb)} win, ${pct(t1.placeProb)} place) at a price where each-way protects the stake.`
            : `${t1.name} is our top pick at ${pct(t1.winProb)} to win${odds1 ? ` – fair odds $${fair1.toFixed(2)} vs $${odds1.toFixed(2)} available` : ''}.`,
          estimatedReturn: odds1 ? `≈ $${round(units * unit * odds1, 0)} if it wins` : undefined,
          priority: 'core',
        });
      }
    } else if (t1.winProb >= 0.2) {
      notes.push(`${t1.name} is the most likely winner but is shorter than we rate it – the value is elsewhere.`);
      const units = spend(0.75 * scale);
      if (units > 0 && slots > 0 && t1.placeProb >= 0.6)
        suggestions.push({ type: 'place', runners: [t1.number], stakeUnits: units, stakeAmount: money(units), rationale: `${t1.name} looks very hard to keep out of the placings (${pct(t1.placeProb)}).`, priority: 'core' });
    }

    // Value plays -----------------------------------------------------------
    const value = top.filter((r) => r !== t1 && (r.valueEdge ?? 0) >= 0.035 && (r.bestOdds ?? 0) >= 4 && r.winProb >= 0.08).slice(0, 2);
    for (const v of value) {
      const k = v.bestOdds ? kellyFraction(v.winProb, v.bestOdds) : 0.03;
      const units = spend(clamp((k * profile.kelly * settings.bankroll) / unit, 0.25, 1) * scale);
      if (units <= 0) break;
      const ew = v.bestOdds! >= 6 && slots === 3 && v.placeProb >= 0.35;
      suggestions.push({
        type: ew ? 'each-way' : 'win',
        runners: [v.number],
        stakeUnits: units,
        stakeAmount: money(units * (ew ? 2 : 1)),
        rationale: `${v.name}: we rate it ${pct(v.winProb)} (fair $${v.fairOdds.toFixed(2)}) but $${v.bestOdds!.toFixed(2)} is on offer – ${pct(v.valueEdge!)} edge.`,
        estimatedReturn: `≈ $${round(units * unit * v.bestOdds!, 0)} if it wins`,
        priority: 'value',
      });
    }

    // Exotics ---------------------------------------------------------------
    if (profile.exotics && stance !== 'watch' && t2 && t3) {
      const quinellaProb = t1.winProb + t2.winProb; // crude but honest: top-2 share
      if (quinellaProb >= 0.45 && n >= 6) {
        const units = spend(0.5 * scale);
        if (units > 0)
          suggestions.push({ type: 'quinella', runners: [t1.number, t2.number], stakeUnits: units, stakeAmount: money(units), rationale: `Top two picks in either order; together they hold ${pct(quinellaProb)} of the win chance.`, priority: 'value' });
      }
      if (confidence.overall >= 55 && t1.winProb >= 0.28) {
        const legs = [[t1.number], [t2.number, t3.number]];
        const units = spend(0.5 * scale);
        if (units > 0)
          suggestions.push({ type: 'exacta', runners: [t1.number, t2.number, t3.number], legs, stakeUnits: units, stakeAmount: money(units), combinations: 2, rationale: `${t1.name} to win with ${t2.name} or ${t3.name} second.`, priority: 'value' });
      }
      // Exotics carry ~21-22% takeout: only box when our top picks hold a real share of the win chance (research §15.2).
      const top3Share = top.slice(0, 3).reduce((a, r) => a + r.winProb, 0);
      const top5Share = top.slice(0, 5).reduce((a, r) => a + r.winProb, 0);
      const boxCount = Math.min(4, top.length);
      if (boxCount >= 3 && n >= 7 && top3Share >= 0.5) {
        const combos = permutations(boxCount, 3);
        const budget = spend(1 * scale);
        if (budget > 0) {
          const flexi = round((money(budget) / combos) * 100, 1);
          suggestions.push({
            type: 'trifecta',
            runners: top.slice(0, boxCount).map((r) => r.number),
            stakeUnits: budget,
            stakeAmount: money(budget),
            combinations: combos,
            flexiPct: flexi,
            rationale: `Box our top ${boxCount} for the trifecta (${combos} combinations, ${flexi}% flexi).`,
            priority: 'fun',
          });
        }
      }
      if (profile.first4 && top.length >= 5 && confidence.overall >= 60 && n >= 8 && top5Share >= 0.7) {
        const combos = permutations(5, 4);
        const budget = spend(1 * scale);
        if (budget > 0) {
          const flexi = round((money(budget) / combos) * 100, 1);
          suggestions.push({ type: 'first4', runners: top.slice(0, 5).map((r) => r.number), stakeUnits: budget, stakeAmount: money(budget), combinations: combos, flexiPct: flexi, rationale: `Box top 5 in the First 4 (${combos} combinations, ${flexi}% flexi).`, priority: 'fun' });
        }
      }
    }

    // Saver -----------------------------------------------------------------
    if (settings.riskProfile === 'conservative' && t2 && slots > 0 && t2.placeProb >= 0.55) {
      const units = spend(0.5 * scale);
      if (units > 0) suggestions.push({ type: 'saver', runners: [t2.number], stakeUnits: units, stakeAmount: money(units), rationale: `Place saver on ${t2.name} (${pct(t2.placeProb)} to place).`, priority: 'saver' });
    }
  }

  if (!suggestions.length && (stance === 'bet' || stance === 'small')) {
    stance = 'watch';
    notes.unshift('No runner clears our probability or value thresholds in this open race – watch rather than bet.');
  }
  if (slots === 0) notes.push('Fewer than 5 runners: no place betting available.');
  else if (slots === 2) notes.push('5–7 runners: place pays first two only.');
  notes.push('Suggestions only. Stick to your unit size and never chase losses. Gambling Help 1800 858 858.');

  const totalAmount = round(suggestions.reduce((a, s) => a + s.stakeAmount, 0), 2);
  return {
    stance,
    unitAmount: unit,
    totalUnits: round(totalAmount / unit, 2),
    totalAmount,
    suggestions,
    notes,
  };
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}
