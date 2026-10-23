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
    // A bet is only suggested when the price on offer beats our own fair price (positive expected return).
    // A short-priced top pick gets the price to wait for instead of a stake.
    if (t1.winProb >= 0.2 && odds1 == null) {
      notes.push(`No price yet for ${t1.name}. It is only worth a win bet at $${fair1.toFixed(2)} or better.`);
    } else if (t1.winProb >= 0.2 && odds1 != null) {
      const winEv = expectedReturn(t1.winProb, odds1);
      const place1 = placeOddsFor(t1);
      const ewEv = place1 != null ? (winEv + expectedReturn(t1.placeProb, place1)) / 2 : -1;
      const eachWay = odds1 >= 4 && odds1 <= 12 && slots === 3 && t1.placeProb >= 0.5 && ewEv > 0;
      if (winEv > 0 || eachWay) {
        const k = kellyFraction(t1.winProb, odds1);
        const perLeg = clamp((k * profile.kelly * settings.bankroll) / unit, 0.5, 2) * scale;
        // Each-way is two bets: both legs count against the profile cap.
        const units = spend(eachWay ? perLeg * 2 : perLeg);
        if (units >= MIN_UNITS) {
          const leg = eachWay ? units / 2 : units;
          suggestions.push({
            type: eachWay ? 'each-way' : 'win',
            runners: [t1.number],
            stakeUnits: round(units, 2),
            stakeAmount: money(units),
            rationale: eachWay
              ? `${t1.name} is our top pick (${pct(t1.winProb)} win, ${pct(t1.placeProb)} place). $${odds1.toFixed(2)} beats our fair price of $${fair1.toFixed(2)} – $${money(leg)} win + $${money(leg)} place. Take $${fair1.toFixed(2)} or better.`
              : `${t1.name} is our top pick at ${pct(t1.winProb)} to win. $${odds1.toFixed(2)} beats our fair price of $${fair1.toFixed(2)} – take $${fair1.toFixed(2)} or better.`,
            estimatedReturn: estimateReturn(leg * unit, odds1, eachWay ? place1 : undefined),
            priority: 'core',
          });
        }
      } else {
        notes.push(`${t1.name} is the most likely winner, but $${odds1.toFixed(2)} is under our fair price of $${fair1.toFixed(2)} – no value. Only worth a win bet at $${fair1.toFixed(2)} or better.`);
        const placeEv = place1 != null ? expectedReturn(t1.placeProb, place1) : -1;
        if (slots > 0 && t1.placeProb >= 0.6 && placeEv > 0) {
          const units = spend(0.75 * scale);
          if (units >= MIN_UNITS)
            suggestions.push({
              type: 'place',
              runners: [t1.number],
              stakeUnits: units,
              stakeAmount: money(units),
              rationale: `${t1.name} looks very hard to keep out of the placings (${pct(t1.placeProb)}), and about $${place1!.toFixed(2)} for the place pays more than that chance is worth.`,
              estimatedReturn: `≈ $${round(units * unit * place1!, 0)} if it places`,
              priority: 'core',
            });
        }
      }
    }

    // Value plays -----------------------------------------------------------
    // At least 5% better than our fair price, so a small rating error does not turn it into a losing bet.
    const value = top.filter((r) => r !== t1 && r.bestOdds != null && r.bestOdds >= 4 && r.winProb >= 0.08 && expectedReturn(r.winProb, r.bestOdds) >= VALUE_MARGIN).slice(0, 2);
    for (const v of value) {
      const odds = v.bestOdds!;
      const winEv = expectedReturn(v.winProb, odds);
      const placeOdds = placeOddsFor(v);
      const ew = odds >= 6 && slots === 3 && v.placeProb >= 0.35 && placeOdds != null && (winEv + expectedReturn(v.placeProb, placeOdds)) / 2 > 0;
      const k = kellyFraction(v.winProb, odds);
      const perLeg = clamp((k * profile.kelly * settings.bankroll) / unit, 0.25, 1) * scale;
      const units = spend(ew ? perLeg * 2 : perLeg);
      if (units < MIN_UNITS) break;
      const leg = ew ? units / 2 : units;
      suggestions.push({
        type: ew ? 'each-way' : 'win',
        runners: [v.number],
        stakeUnits: round(units, 2),
        stakeAmount: money(units),
        rationale: `${v.name}: we rate it ${pct(v.winProb)} (fair $${v.fairOdds.toFixed(2)}) and $${odds.toFixed(2)} is on offer – about ${pct(winEv)} more than it is worth.${ew ? ` $${money(leg)} win + $${money(leg)} place.` : ''} Take $${(v.fairOdds * (1 + VALUE_MARGIN)).toFixed(2)} or better.`,
        estimatedReturn: estimateReturn(leg * unit, odds, ew ? placeOdds : undefined),
        priority: 'value',
      });
    }

    // Exotics ---------------------------------------------------------------
    if (profile.exotics && stance !== 'watch' && t2 && t3) {
      const quinellaProb = t1.winProb + t2.winProb; // crude but honest: top-2 share
      if (quinellaProb >= 0.45 && n >= 6) {
        const units = spend(0.5 * scale);
        if (units >= MIN_UNITS)
          suggestions.push({ type: 'quinella', runners: [t1.number, t2.number], stakeUnits: units, stakeAmount: money(units), rationale: `Top two picks in either order; together they hold ${pct(quinellaProb)} of the win chance.`, priority: 'value' });
      }
      if (confidence.overall >= 55 && t1.winProb >= 0.28) {
        const legs = [[t1.number], [t2.number, t3.number]];
        const units = spend(0.5 * scale);
        if (units >= MIN_UNITS)
          suggestions.push({ type: 'exacta', runners: [t1.number, t2.number, t3.number], legs, stakeUnits: units, stakeAmount: money(units), combinations: 2, rationale: `${t1.name} to win with ${t2.name} or ${t3.name} second.`, priority: 'value' });
      }
      // Exotics carry ~21-22% takeout: only box when our top picks hold a real share of the win chance (research §15.2).
      const top3Share = top.slice(0, 3).reduce((a, r) => a + r.winProb, 0);
      const top5Share = top.slice(0, 5).reduce((a, r) => a + r.winProb, 0);
      const boxCount = Math.min(4, top.length);
      if (boxCount >= 3 && n >= 7 && top3Share >= 0.5) {
        const combos = permutations(boxCount, 3);
        const budget = spend(1 * scale);
        if (budget >= MIN_UNITS) {
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
        if (budget >= MIN_UNITS) {
          const flexi = round((money(budget) / combos) * 100, 1);
          suggestions.push({ type: 'first4', runners: top.slice(0, 5).map((r) => r.number), stakeUnits: budget, stakeAmount: money(budget), combinations: combos, flexiPct: flexi, rationale: `Box top 5 in the First 4 (${combos} combinations, ${flexi}% flexi).`, priority: 'fun' });
        }
      }
    }

    // Saver -----------------------------------------------------------------
    const place2 = t2 ? placeOddsFor(t2) : undefined;
    if (settings.riskProfile === 'conservative' && t2 && slots > 0 && t2.placeProb >= 0.55 && (place2 == null || expectedReturn(t2.placeProb, place2) > 0)) {
      const units = spend(0.5 * scale);
      if (units >= MIN_UNITS) suggestions.push({ type: 'saver', runners: [t2.number], stakeUnits: units, stakeAmount: money(units), rationale: `Place saver on ${t2.name} (${pct(t2.placeProb)} to place).`, priority: 'saver' });
    }
  }

  if (!suggestions.length && (stance === 'bet' || stance === 'small')) {
    stance = 'watch';
    notes.unshift('No bet at the current prices: nothing on offer pays more than our ratings say it is worth. Watch, or bet only if a price reaches the mark given below.');
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

/** Smallest suggestion worth making (a quarter unit; bookmakers reject sub-$1 legs). */
const MIN_UNITS = 0.25;

/** How far above our fair price a runner other than the top pick must be before we call it value. */
export const VALUE_MARGIN = 0.05;

/** Expected profit per $1 staked at these odds, by our own probability: 0.1 = 10c in the dollar, negative = a losing bet. */
export function expectedReturn(prob: number, decimalOdds: number): number {
  return prob * decimalOdds - 1;
}

/** Best place price, or the usual quarter-odds place terms when no place price is quoted. */
function placeOddsFor(r: RunnerAssessment): number | undefined {
  if (r.bestPlace && r.bestPlace > 1) return r.bestPlace;
  if (r.bestOdds && r.bestOdds > 1) return round(1 + (r.bestOdds - 1) / 4, 2);
  return undefined;
}

function estimateReturn(legStake: number, winOdds: number, placeOdds?: number): string {
  if (placeOdds) return `≈ $${round(legStake * winOdds + legStake * placeOdds, 0)} if it wins, ≈ $${round(legStake * placeOdds, 0)} if it only places`;
  return `≈ $${round(legStake * winOdds, 0)} if it wins`;
}
