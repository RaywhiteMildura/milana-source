/**
 * Pure helpers behind the race-day automation UI: what the server's results
 * watcher is doing for a race, what the scheduler is up to, and what changed
 * between two snapshots of a meeting pack that is worth telling the owner about.
 */
import type { MeetingPack, Race, RaceResult, ResultWatch, SchedulerStatus } from '@shared/types';
import { samePeople } from '@shared/util';
import { fmtRelative, joinNice } from './format';

/** A race must be this long past the jump before the page goes looking for its result. */
export const CATCHUP_MIN_AGE_MS = 3 * 60_000;
/** The page asks for a catch-up at most this often (client-side throttle). */
export const CATCHUP_STALE_MS = 2 * 60_000;
/**
 * The server is "behind" once a booked check is this overdue: its scheduler
 * ticks every 60 s and a results check takes a few seconds, so anything later
 * means it was asleep, stopped or restarting.
 */
export const CATCHUP_GRACE_MS = 90_000;

/** A result that will not change any more (manual results carry no status and count as final). */
export function isSettled(result: RaceResult | undefined): boolean {
  return !!result && result.status !== 'interim';
}

/** A result typed in by hand: the automatic watcher never looks at that race again. */
export function isManualResult(result: RaceResult | undefined): boolean {
  return !!result && (result.source === 'manual' || !!result.confirmedBy?.includes('manual'));
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

/** What changed between two snapshots of a pack that the owner would want to hear about. */
export interface PackNews {
  /** A result arrived, or an interim one was confirmed */
  resulted: number[];
  /** An existing result's placings changed (protest upheld, amended result) */
  corrected: number[];
  /** The race was abandoned since the last snapshot */
  abandoned: number[];
  /** A scratching, a reinstatement, a runner added or a rider change in a race still to run */
  fieldChanged: number[];
  /** The picks for a race still to run changed (new prediction, different top order or confidence band) */
  rerated: number[];
}

type NewsSnapshot = Pick<MeetingPack, 'races' | 'results' | 'predictions'>;

const placingsKey = (r: RaceResult | undefined) => JSON.stringify(r?.placings ?? []);
const picksKey = (p: MeetingPack['predictions'][number] | undefined) => (p ? `${(p.top ?? p.ranked ?? []).map((a) => a.number).join(',')}|${p.confidence?.label ?? ''}` : '');

function fieldChanged(before: Race, after: Race): boolean {
  const prev = new Map((before.runners ?? []).map((r) => [r.number, r]));
  const next = after.runners ?? [];
  if (next.some((r) => !prev.has(r.number))) return true;
  // A runner taken out of the field entirely (not just marked scratched) is news too.
  const now = new Set(next.map((r) => r.number));
  if ((before.runners ?? []).some((r) => !now.has(r.number))) return true;
  return next.some((r) => {
    const p = prev.get(r.number)!;
    if (!!p.scratched !== !!r.scratched) return true;
    return !!p.jockey && !!r.jockey && !samePeople(p.jockey, r.jockey);
  });
}

/**
 * Compare two snapshots of the same pack. Book-keeping alone – an automatic
 * results check that found nothing, a re-saved watch entry, a newer updatedAt,
 * re-generated predictions with the same picks – is not news.
 */
export function packNews(before: NewsSnapshot | null | undefined, after: NewsSnapshot): PackNews {
  const news: PackNews = { resulted: [], corrected: [], abandoned: [], fieldChanged: [], rerated: [] };
  if (!before) return news;
  news.resulted = newlyResulted(resultKeys(before), resultKeys(after));
  const fresh = new Set(news.resulted);
  for (const [k, r] of Object.entries(after.results ?? {})) {
    const n = Number(k);
    const was = before.results?.[n];
    if (was && !fresh.has(n) && placingsKey(was) !== placingsKey(r)) news.corrected.push(n);
  }
  const previous = new Map((before.races ?? []).map((r) => [r.number, r]));
  for (const race of after.races ?? []) {
    const was = previous.get(race.number);
    if (!was || after.results?.[race.number]) continue;
    if (race.status === 'abandoned') {
      if (was.status !== 'abandoned') news.abandoned.push(race.number);
      continue;
    }
    if (fieldChanged(was, race)) news.fieldChanged.push(race.number);
    const p = after.predictions?.[race.number];
    if (p && picksKey(p) !== picksKey(before.predictions?.[race.number])) news.rerated.push(race.number);
  }
  for (const list of Object.values(news)) list.sort((a: number, b: number) => a - b);
  return news;
}

/** The toast for a refresh, or null when nothing the owner cares about changed. */
export function newsToast(news: PackNews): { kind: 'success' | 'warn' | 'info'; text: string } | null {
  const R = (ns: number[]) => joinNice(ns.map((n) => `R${n}`));
  const parts: string[] = [];
  if (news.resulted.length) parts.push(resultToast(news.resulted));
  if (news.corrected.length) parts.push(`${R(news.corrected)} result${news.corrected.length === 1 ? '' : 's'} corrected`);
  if (news.abandoned.length) parts.push(`${R(news.abandoned)} abandoned`);
  if (news.fieldChanged.length) parts.push(`scratching or rider change in ${R(news.fieldChanged)}`);
  // New picks follow from any of the above, so they are only worth their own words when nothing else happened.
  if (!parts.length && news.rerated.length) parts.push(news.rerated.length > 3 ? 'new picks for the remaining races' : `new picks for ${R(news.rerated)}`);
  if (!parts.length) return null;
  const kind = news.resulted.length ? 'success' : news.corrected.length || news.abandoned.length ? 'warn' : 'info';
  const text = parts.join('; ');
  return { kind, text: kind === 'info' ? `Updated: ${text}` : text.charAt(0).toUpperCase() + text.slice(1) };
}

/**
 * Should the page ask the server to catch up on results right now? Only when
 * the server looks to be behind its own schedule: a race jumped a while ago,
 * has no settled result, and either was never looked at (the server was off
 * while it ran) or its booked check is well overdue. A race the watcher gave
 * up on, settled, or booked for later is left to the server. The caller also
 * makes sure automatic results are known to be on.
 */
export function catchupDue(pack: Pick<MeetingPack, 'races' | 'results' | 'resultWatch'>, now: number): boolean {
  return (pack.races ?? []).some((r) => {
    if (!r.startTime || r.status === 'abandoned' || isSettled(pack.results?.[r.number])) return false;
    const start = Date.parse(r.startTime);
    if (!Number.isFinite(start) || now - start < CATCHUP_MIN_AGE_MS) return false;
    const w = pack.resultWatch?.[r.number];
    if (!w) return true;
    if (w.gaveUp || !w.nextCheckAt) return false;
    const next = Date.parse(w.nextCheckAt);
    return !Number.isFinite(next) || now - next > CATCHUP_GRACE_MS;
  });
}

export type WatchTone = 'neutral' | 'amber' | 'blue';

/** "in 2 min", or "any moment now" once the booked time is under 30 s away (fmtRelative would say "just now"; the server ticks once a minute). */
function nextCheckWord(iso: string, now: number): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t - now < 30_000 ? 'any moment now' : fmtRelative(iso, now);
}

const lastChecked = (watch: ResultWatch | undefined, now: number) => (watch?.lastCheckedAt && Number.isFinite(Date.parse(watch.lastCheckedAt)) ? ` Last checked ${fmtRelative(watch.lastCheckedAt, now)}.` : '');

/**
 * Whether the race page shows the results-watch line: for a race that has
 * jumped and still has no settled result, and for a settled one only while the
 * server is booked to look again (a one-source result being confirmed) – never
 * for a result typed in by hand, and not once automatic results are off.
 */
export function watchLineVisible(race: Pick<Race, 'startTime' | 'status'>, result: RaceResult | undefined, watch: ResultWatch | undefined, autoOn: boolean, now: number): boolean {
  const start = race.startTime ? Date.parse(race.startTime) : NaN;
  if (!Number.isFinite(start) || start > now || race.status === 'abandoned') return false;
  if (!isSettled(result)) return true;
  return autoOn && !!watch?.nextCheckAt && !isManualResult(result);
}

/** What the automatic results watcher is doing for a race that has jumped. */
export function resultWatchLine(watch: ResultWatch | undefined, result: RaceResult | undefined, autoOn: boolean, now: number): { text: string; tone: WatchTone } {
  if (watch?.gaveUp) return { text: watch.note || 'Automatic checks have stopped for this race – fetch the result or enter it manually.', tone: 'amber' };
  // A booking left over from before automatic results were switched off will never be kept: do not promise it.
  if (!autoOn) {
    const what = result?.status === 'interim' ? 'Interim result only. Automatic results are off – fetch the result again to confirm it, or enter it manually.' : 'Automatic results are off – fetch the result or enter it manually.';
    return { text: `${what}${lastChecked(watch, now)}`, tone: 'neutral' };
  }
  // "checked 1 min ago, next in 1 min" – appended to the server's note while checks are still booked.
  const timing = watch?.nextCheckAt ? ` (checked ${fmtRelative(watch.lastCheckedAt, now)}, next ${nextCheckWord(watch.nextCheckAt, now)})` : '';
  if (result?.status === 'interim' || (watch?.note && /one source/i.test(watch.note))) return { text: `${watch?.note || 'Result from one source only – confirming'}${timing}`, tone: 'blue' };
  // The sources could not be reached at all: worth a second look, unlike "nothing published yet".
  if (watch?.note && /no results source answered/i.test(watch.note)) return { text: `${watch.note}${timing}`, tone: 'amber' };
  if (watch?.note) return { text: `${watch.note}${timing}`, tone: 'blue' };
  if (watch) {
    const next = watch.nextCheckAt ? `, next ${nextCheckWord(watch.nextCheckAt, now)}` : '';
    return { text: `Checking for the result automatically – last checked ${fmtRelative(watch.lastCheckedAt, now)}${next}`, tone: 'blue' };
  }
  return { text: 'The result will be fetched automatically a couple of minutes after the race.', tone: 'neutral' };
}

export type SchedulerTone = 'green' | 'amber' | 'neutral';

/** "Watching Flemington R3 – next check in 1 min" / "Nothing to watch right now." */
export function schedulerLine(s: SchedulerStatus | undefined, now: number): { text: string; tone: SchedulerTone } {
  if (!s) return { text: 'Automatic checks run while the server is on.', tone: 'neutral' };
  if (!s.running) return { text: 'The automatic scheduler is not running on the server right now.', tone: 'amber' };
  if (!s.autoResults && s.autoRecheckMinutes <= 0) return { text: 'Automatic results and pre-race checks are both turned off.', tone: 'amber' };
  const last = s.lastTickAt ? ` Last look ${fmtRelative(s.lastTickAt, now)}.` : '';
  // Results bookings left over from before the switch was turned off are not being kept.
  if (!s.autoResults) return { text: `Automatic results are off – pre-race checks still run by themselves.${last}`, tone: 'neutral' };
  if (s.watching.length === 0) return { text: `Nothing to watch right now.${last}`, tone: 'green' };
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
