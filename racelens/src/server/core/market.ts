import type { MarketSummary, OddsQuote, Runner } from '../../shared/types.js';
import { mean, round, stddev } from '../../shared/util.js';
import { starters } from './field.js';

/**
 * Market engine: turns a pile of odds quotes from many bookmakers into a
 * consensus view per runner, including overround-free implied probabilities
 * and money moves (firming / drifting).
 */

const MIN_PRICE = 1.01;

function winQuotes(odds: OddsQuote[]): OddsQuote[] {
  return odds.filter((q) => typeof q.win === 'number' && q.win >= MIN_PRICE && Number.isFinite(q.win));
}

export function summariseRunnerMarket(runner: Pick<Runner, 'odds'>): MarketSummary | undefined {
  const quotes = winQuotes(runner.odds || []);
  if (!quotes.length) {
    const place = (runner.odds || []).filter((q) => typeof q.place === 'number' && q.place! >= 1);
    if (!place.length) return undefined;
    return { bestPlace: Math.max(...place.map((q) => q.place!)), quoteCount: 0 };
  }
  // Fixed odds are the primary signal; tote/exchange only if nothing else.
  const fixed = quotes.filter((q) => q.type === 'fixed');
  const use = fixed.length ? fixed : quotes;
  const wins = use.map((q) => q.win!);
  const best = use.reduce((a, b) => (b.win! > a.win! ? b : a));
  const places = (runner.odds || []).filter((q) => typeof q.place === 'number' && q.place! >= 1).map((q) => q.place!);
  const moves = use
    .filter((q) => typeof q.opening === 'number' && q.opening! >= MIN_PRICE)
    .map((q) => ((q.win! - q.opening!) / q.opening!) * 100);
  const flucMoves = use
    .filter((q) => !q.opening && q.flucs && q.flucs.length >= 2)
    .map((q) => ((q.win! - q.flucs![0].price) / q.flucs![0].price) * 100);
  const allMoves = [...moves, ...flucMoves].filter((m) => Number.isFinite(m));
  const movePct = allMoves.length ? round(mean(allMoves), 1) : undefined;
  const m = mean(wins);
  return {
    bestWin: best.win,
    bestWinBookmaker: best.bookmaker,
    meanWin: round(m, 2),
    bestPlace: places.length ? Math.max(...places) : undefined,
    movePct,
    mover: movePct == null ? undefined : movePct <= -8 ? 'firming' : movePct >= 8 ? 'drifting' : 'steady',
    quoteCount: use.length,
    dispersion: wins.length > 1 ? round(stddev(wins) / m, 3) : 0,
  };
}

/**
 * Attach a MarketSummary to every runner and normalise implied probabilities
 * across the runners that will start so they sum to 1.
 */
export function summariseRaceMarket(runners: Runner[]): Runner[] {
  const out = runners.map((r) => ({ ...r, market: summariseRunnerMarket(r) }));
  const active = starters(out).filter((r) => r.market?.meanWin);
  const raw = active.map((r) => 1 / r.market!.meanWin!);
  const total = raw.reduce((a, b) => a + b, 0);
  if (total > 0) {
    active.forEach((r, i) => {
      r.market!.impliedWinProb = round(raw[i] / total, 4);
    });
  }
  return out;
}

/** Overround (book percentage) of a race's mean prices, e.g. 1.18 = 118%. */
export function overround(runners: Runner[]): number | undefined {
  const active = runners.filter((r) => !r.scratched && r.market?.meanWin);
  if (!active.length) return undefined;
  return round(active.reduce((a, r) => a + 1 / r.market!.meanWin!, 0), 3);
}

/** Favourite (lowest mean win price) among active runners. */
export function favourite(runners: Runner[]): Runner | undefined {
  return runners
    .filter((r) => !r.scratched && r.market?.meanWin)
    .sort((a, b) => a.market!.meanWin! - b.market!.meanWin!)[0];
}
