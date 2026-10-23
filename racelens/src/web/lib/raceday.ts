/**
 * Pure helpers behind the race-day automation UI: what the server's results
 * watcher is doing for a race, what the scheduler is up to, and how to spot a
 * freshly landed result between two snapshots of a meeting pack.
 */
import type { MeetingPack, RaceResult, ResultWatch, SchedulerStatus } from '@shared/types';
import { fmtRelative, joinNice } from './format';

/** A race must be this long past the jump before the page goes looking for its result. */
export const CATCHUP_MIN_AGE_MS = 3 * 60_000;
/** ...and the server must not have looked itself this recently. */
export const CATCHUP_STALE_MS = 2 * 60_000;

/** A result that will not change any more (manual results carry no status and count as final). */
export function isSettled(result: RaceResult | undefined): boolean {
  return !!result && result.status !== 'interim';
}

/** Which races are resulted and how firmly, for spotting what a refresh changed. */
export function resultKeys(pack: Pick<MeetingPack, 'results'> | null | undefined): Map<number, 'interim' | 'final'> {
  const out = new Map<number, 'interim' | 'final'>();
  for (const [n, r] of Object.entries(pack?.results ?? {})) out.set(Number(n), r.status === 'interim' ? 'interim' : 'final');
  return out;
}

/** Races that gained a result (or had an interim one confirmed) between two snapshots. */
export function newlyResulted(before: Map<number, string>, after: Map<number, string>): number[] {
  const out: number[] = [];
  for (const [n, status] of after) {
    const prev = before.get(n);
    if (!prev || (prev === 'interim' && status === 'final')) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/** "R3 result in" / "R3 and R4 results in" */
export function resultToast(numbers: number[]): string {
  return numbers.length === 1 ? `R${numbers[0]} result in` : `${joinNice(numbers.map((n) => `R${n}`))} results in`;
}

/**
 * Should the page ask the server for results right now? True when some race
 * jumped a while ago, has no settled result, and the server has not checked it
 * recently (or at all).
 */
export function catchupDue(pack: Pick<MeetingPack, 'races' | 'results' | 'resultWatch'>, now: number): boolean {
  return (pack.races ?? []).some((r) => {
    if (!r.startTime || r.status === 'abandoned' || isSettled(pack.results?.[r.number])) return false;
    if (now - new Date(r.startTime).getTime() < CATCHUP_MIN_AGE_MS) return false;
    const w = pack.resultWatch?.[r.number];
    return !w?.lastCheckedAt || now - new Date(w.lastCheckedAt).getTime() > CATCHUP_STALE_MS;
  });
}

export type WatchTone = 'neutral' | 'amber' | 'blue';

/** "in 2 min", or "any moment now" once the booked time has arrived (the server ticks once a minute). */
function nextCheckWord(iso: string, now: number): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t - now < 15_000 ? 'any moment now' : fmtRelative(iso, now);
}

/** What the automatic results watcher is doing for a race that has jumped. */
export function resultWatchLine(watch: ResultWatch | undefined, result: RaceResult | undefined, autoOn: boolean, now: number): { text: string; tone: WatchTone } {
  if (watch?.gaveUp) return { text: watch.note || 'Automatic checks have stopped for this race – fetch the result or enter it manually.', tone: 'amber' };
  // "checked 1 min ago, next in 1 min" – appended to the server's note while checks are still booked.
  const timing = watch?.nextCheckAt ? ` (checked ${fmtRelative(watch.lastCheckedAt, now)}, next ${nextCheckWord(watch.nextCheckAt, now)})` : '';
  if (result?.status === 'interim' || (watch?.note && /one source/i.test(watch.note))) return { text: `${watch?.note || 'Result from one source only – confirming'}${timing}`, tone: 'blue' };
  if (watch?.note) return { text: `${watch.note}${timing}`, tone: 'blue' };
  if (watch) {
    const next = watch.nextCheckAt ? `, next ${nextCheckWord(watch.nextCheckAt, now)}` : '';
    return { text: `Checking for the result automatically – last checked ${fmtRelative(watch.lastCheckedAt, now)}${next}`, tone: 'blue' };
  }
  if (autoOn) return { text: 'The result will be fetched automatically a couple of minutes after the race.', tone: 'neutral' };
  return { text: 'Automatic results are off – fetch the result or enter it manually.', tone: 'neutral' };
}

export type SchedulerTone = 'green' | 'amber' | 'neutral';

/** "Watching Flemington R3 – next check in 1 min" / "Nothing to watch right now." */
export function schedulerLine(s: SchedulerStatus | undefined, now: number): { text: string; tone: SchedulerTone } {
  if (!s) return { text: 'Automatic checks run while the server is on.', tone: 'neutral' };
  if (!s.running) return { text: 'The automatic scheduler is not running on the server right now.', tone: 'amber' };
  if (!s.autoResults && s.autoRecheckMinutes <= 0) return { text: 'Automatic results and pre-race checks are both turned off.', tone: 'amber' };
  if (s.watching.length === 0) {
    const last = s.lastTickAt ? ` Last look ${fmtRelative(s.lastTickAt, now)}.` : '';
    return { text: `Nothing to watch right now.${last}`, tone: 'green' };
  }
  // One phrase per venue: "Flemington R1, R2 and R4 – next check in 1 min".
  const byVenue = new Map<string, { races: number[]; next?: string }>();
  for (const w of s.watching) {
    const g = byVenue.get(w.venue) ?? { races: [] };
    g.races.push(w.raceNumber);
    if (w.nextCheckAt && (!g.next || w.nextCheckAt < g.next)) g.next = w.nextCheckAt;
    byVenue.set(w.venue, g);
  }
  const items = [...byVenue.entries()].map(([venue, g]) => {
    const races = joinNice([...new Set(g.races)].sort((a, b) => a - b).map((n) => `R${n}`));
    return `${venue} ${races}${g.next ? ` – next check ${nextCheckWord(g.next, now)}` : ''}`;
  });
  return { text: `Watching ${items.join('; ')}`, tone: 'green' };
}
