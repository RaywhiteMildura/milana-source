import type {
  DayPattern,
  MeetingPack,
  MeetingRaw,
  MeetingSummary,
  NewsItem,
  PackEvent,
  Prediction,
  Race,
  RaceRaw,
  RaceResult,
  ResultWatch,
  Settings,
  SourceStatus,
  WeatherSummary,
} from '../../shared/types.js';
import { mean, normaliseName, round, samePeople, zoneForAustralianState } from '../../shared/util.js';
import type { FetchContext, SourceAdapter } from '../adapters/types.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { JobHandle } from './manager.js';
import { mergeRaceRefresh, reconcileMeeting, reconcileRace, type SourceMeta } from '../core/reconcile.js';
import { predictRace } from '../core/model.js';
import { summariseRaceMarket } from '../core/market.js';
import { detectDayPatterns } from '../core/daypatterns.js';
import { matchNews } from '../core/news.js';
import { scorePrediction } from '../core/scorecard.js';
import { mapLimit, sleep, withTimeout } from '../core/http.js';

/**
 * Research orchestrator: fans out to every source, reconciles, enriches and
 * predicts. Also the pre-race recheck and results flows. Every source call is
 * wrapped so a dead source only costs a warning, never the job.
 */

export interface ResearchDeps {
  registry: AdapterRegistry;
  ctx: FetchContext;
  settings: Settings;
  now?: () => Date;
}

const SOURCE_TIMEOUT_MS = 45_000;
/** No Australian meeting has more than 12 races; anything beyond this is a broken feed. */
export const MAX_RACES = 20;
export const clampRaceNumbers = (numbers: number[]): number[] => [...new Set(numbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_RACES))].sort((a, b) => a - b);

// ---------------------------------------------------------------------------
// Automatic results watcher – schedule and bookkeeping
// ---------------------------------------------------------------------------

/**
 * Results-watch schedule, relative to a race's scheduled start: first check
 * 2 minutes after the jump, then every 2 minutes until +30 min, every 5 minutes
 * until +90 min, every 15 minutes until +4 h. After that the watcher gives up on
 * the race (the result can still be fetched with the button or typed in).
 * The per-race memory lives in pack.resultWatch, saved with the pack, so a
 * restarted server simply carries on from the next slot.
 */
export const RESULT_WATCH = {
  firstCheckMs: 2 * 60_000,
  giveUpMs: 4 * 60 * 60_000,
  /** Extra checks allowed once a final result has arrived from a single source, looking for a second source that confirms it. */
  confirmationChecks: 3,
  /**
   * A result the sources settle earlier than this after the jump gets one more
   * look at this point: a protest upheld or an amended result is often published
   * after a feed first called the placings final.
   */
  correctionLookMs: 30 * 60_000,
} as const;

/** Check slots in ms after the jump: 2,4,…,30 | 35,40,…,90 | 105,120,…,240 minutes. */
const RESULT_CHECK_SLOTS_MS: readonly number[] = (() => {
  const slots: number[] = [];
  for (let m = 2; m <= 30; m += 2) slots.push(m * 60_000);
  for (let m = 35; m <= 90; m += 5) slots.push(m * 60_000);
  for (let m = 105; m <= 240; m += 15) slots.push(m * 60_000);
  return slots;
})();

/** The next check slot strictly after `nowMs` for a race that jumped at `startMs`; undefined once the schedule is exhausted (4 h after the jump). */
export function nextResultCheckAt(startMs: number, nowMs: number): number | undefined {
  for (const slot of RESULT_CHECK_SLOTS_MS) if (startMs + slot > nowMs) return startMs + slot;
  return undefined;
}

/** How many of the extra one-source confirmation checks have run, as recorded in the watch note. */
export function confirmationChecks(watch: ResultWatch | undefined): number {
  const m = watch?.note?.match(/extra check (\d+) of \d+/);
  return m ? Number(m[1]) : 0;
}

export const isManualResult = (result: RaceResult | undefined): boolean => !!result && (result.source === 'manual' || !!result.confirmedBy?.includes('manual'));

/**
 * A race's result is settled – nothing left to poll for – when it was typed in
 * by hand, when two sources agree on a final result, or when a final result from
 * a single source has used up its confirmation checks (the watcher then carries
 * no nextCheckAt). Interim results and missing results are never settled.
 */
export function isResultSettled(pack: MeetingPack, raceNumber: number): boolean {
  const result = pack.results[raceNumber];
  if (!result) return false;
  if (isManualResult(result)) return true;
  if (result.status === 'interim') return false;
  if ((result.confirmedBy?.length ?? 0) >= 2) return true;
  const watch = pack.resultWatch?.[raceNumber];
  return !!watch && (!watch.nextCheckAt || confirmationChecks(watch) >= RESULT_WATCH.confirmationChecks);
}

/** A source result settled early whose one late-correction look (RESULT_WATCH.correctionLookMs) is due. Never true for a result typed in by hand. */
export function correctionLookDue(pack: MeetingPack, raceNumber: number, nowMs: number): boolean {
  const result = pack.results[raceNumber];
  const at = pack.resultWatch?.[raceNumber]?.correctionCheckAt;
  if (!result || !at || isManualResult(result)) return false;
  const t = Date.parse(at);
  return !Number.isFinite(t) || nowMs >= t;
}

/**
 * Which races are due an automatic results check right now. Pure. This is the
 * one rule for every automatic look – the scheduler, the phone's catch-up and
 * the results step of a pre-race check.
 *
 * Schedule, relative to each race's scheduled start (see RESULT_WATCH /
 * nextResultCheckAt): first check at start + 2 min; then every 2 min until
 * start + 30 min; then every 5 min until start + 90 min; then every 15 min until
 * start + 4 h; after that the collector marks resultWatch[n].gaveUp with a note
 * ('No result published after 4 hours - enter it manually or press Fetch
 * results') and the race is left alone.
 *
 * The memory is pack.resultWatch[n] (lastCheckedAt / nextCheckAt / attempts),
 * written by the results check and persisted with the pack, so restarts do not
 * matter: a race with no entry yet is due as soon as start + 2 min has passed
 * (also the catch-up path for a server that was off while races were run); a
 * race with an entry is due once its nextCheckAt has passed.
 *
 * A race is skipped when it has no start time, is abandoned, is settled (a
 * manual result; a final result confirmed by two sources; or a final result from
 * one source whose extra confirmation checks are used up – except for the one
 * late-correction look of a result settled early), when the watcher gave up on
 * it, or when settings.autoResults is false.
 */
export function dueResultChecks(pack: MeetingPack, now: Date, settings: Pick<Settings, 'autoResults'>): number[] {
  if (settings.autoResults === false) return [];
  const t = now.getTime();
  const due: number[] = [];
  for (const race of pack.races) {
    if (!race.startTime || race.status === 'abandoned') continue;
    const start = Date.parse(race.startTime);
    if (!Number.isFinite(start) || t < start + RESULT_WATCH.firstCheckMs) continue;
    if (isResultSettled(pack, race.number)) {
      if (correctionLookDue(pack, race.number, t)) due.push(race.number);
      continue;
    }
    const watch = pack.resultWatch?.[race.number];
    if (!watch) {
      due.push(race.number);
      continue;
    }
    if (watch.gaveUp || !watch.nextCheckAt) continue;
    const next = Date.parse(watch.nextCheckAt);
    if (!Number.isFinite(next) || t >= next) due.push(race.number);
  }
  return due;
}

/** Minutes after the jump at which a race that still has no result gets its race card checked for an abandonment. */
const ABANDON_PROBE_MINUTES: readonly number[] = [20, 30, 45, 60, 90, 120, 180, 240];

/** True for the first check at or past one of the abandonment probe marks (and for a first-ever check past the first mark). */
function abandonProbeDue(startMs: number, previousCheckMs: number | undefined, nowMs: number): boolean {
  return ABANDON_PROBE_MINUTES.some((m) => {
    const mark = startMs + m * 60_000;
    return nowMs >= mark && (previousCheckMs === undefined || !Number.isFinite(previousCheckMs) || previousCheckMs < mark);
  });
}

/** Results feeds publish nothing for an abandoned race, so ask the race-card sources for its status. */
async function raceAbandoned(deps: ResearchDeps, pack: MeetingPack, raceNumber: number): Promise<boolean> {
  const adapters = deps.registry.withCapability('racecard', deps.settings.disabledSources).filter((a) => a.fetchRace);
  if (!adapters.length) return false;
  const statuses = await mapLimit(adapters, 6, async (a) => (await timed((c) => a.fetchRace!(pack.meeting, raceNumber, c || deps.ctx), `${a.name} R${raceNumber} status`, deps.ctx, 20_000)).value?.status);
  return statuses.includes('abandoned');
}

/** Mark every step of a results job that found nothing left to do (another job looked at those races meanwhile). */
export function skipResultsJob(job: JobHandle, reason: string): void {
  for (const [key, label] of [
    ['results', 'Fetching results'],
    ['patterns', 'Day patterns'],
    ['repredict', 'Re-rating'],
  ] as const) {
    job.step(key, label);
    job.finish(key, 'skipped', reason);
  }
  job.message(reason);
}

function statusOf(a: SourceAdapter, ok: boolean, ms: number, extra: Partial<SourceStatus> = {}): SourceStatus {
  return { source: a.id, name: a.name, kind: a.kind, ok, ms, fetchedAt: new Date().toISOString(), url: a.homepage, ...extra };
}

/** Run a source call with a time budget; on overrun the in-flight HTTP requests are cancelled, not just abandoned. */
async function timed<T>(fn: (ctx?: FetchContext) => Promise<T>, label: string, ctx?: FetchContext, budgetMs = SOURCE_TIMEOUT_MS): Promise<{ value?: T; error?: string; ms: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const bound = ctx ? { ...ctx, http: ctx.http.bound(controller.signal), signal: controller.signal } : undefined;
  try {
    const value = await withTimeout(fn(bound), budgetMs, label);
    return { value, ms: Date.now() - started };
  } catch (err) {
    controller.abort();
    return { error: err instanceof Error ? err.message : String(err), ms: Date.now() - started };
  }
}

/** Merge meeting summaries discovered by several sources into one list. */
export function mergeMeetingSummaries(lists: Array<{ source: string; meetings: MeetingSummary[] }>): MeetingSummary[] {
  const out = new Map<string, MeetingSummary>();
  for (const { source, meetings } of lists) {
    for (const m of meetings) {
      const key = `${m.date}:${normaliseName(m.venue).replace(/\s+/g, '-')}:${m.raceType}:${(m.country || 'AUS').toUpperCase()}`;
      const existing = out.get(key);
      if (!existing) {
        out.set(key, { ...m, id: `${m.date}:${normaliseName(m.venue).replace(/\s+/g, '-')}`, venueSlug: normaliseName(m.venue).replace(/\s+/g, '-'), sources: [source], sourceRefs: { ...m.sourceRefs } });
      } else {
        existing.sources = [...new Set([...existing.sources, source])];
        existing.sourceRefs = { ...existing.sourceRefs, ...m.sourceRefs };
        existing.state = existing.state || m.state;
        existing.country = existing.country || m.country;
        existing.raceCount = existing.raceCount || (m.raceCount && m.raceCount <= MAX_RACES ? m.raceCount : undefined);
        existing.trackCondition = existing.trackCondition || m.trackCondition;
        existing.trackRating = existing.trackRating ?? m.trackRating;
        existing.weather = existing.weather || m.weather;
        existing.rail = existing.rail || m.rail;
        existing.firstRaceTime = existing.firstRaceTime || m.firstRaceTime;
      }
    }
  }
  for (const m of out.values()) {
    if (!m.timezone) m.timezone = zoneForAustralianState(m.state) || (m.country === 'NZ' ? 'Pacific/Auckland' : 'Australia/Melbourne');
  }
  return [...out.values()].sort((a, b) => (a.raceType === b.raceType ? a.venue.localeCompare(b.venue) : a.raceType === 'thoroughbred' ? -1 : 1));
}

export async function discoverMeetings(deps: ResearchDeps, date: string): Promise<{ meetings: MeetingSummary[]; statuses: SourceStatus[] }> {
  const adapters = deps.registry.withCapability('meetings', deps.settings.disabledSources);
  const statuses: SourceStatus[] = [];
  const lists = await mapLimit(adapters, 6, async (a) => {
    const r = await timed((c) => a.listMeetings!(date, c || deps.ctx), `${a.name} meetings`, deps.ctx, 20_000);
    statuses.push(statusOf(a, !r.error, r.ms, { itemCount: r.value?.length, error: r.error }));
    return { source: a.id, meetings: r.value || [] };
  });
  return { meetings: mergeMeetingSummaries(lists), statuses };
}

function sourceMeta(registry: AdapterRegistry): SourceMeta[] {
  return registry.all().map((a) => ({ id: a.id, kind: a.kind }));
}

async function fetchAllSources(deps: ResearchDeps, meeting: MeetingSummary, job: JobHandle): Promise<{ raws: MeetingRaw[]; statuses: SourceStatus[] }> {
  const adapters = deps.registry.withCapability('racecard', deps.settings.disabledSources);
  const statuses: SourceStatus[] = [];
  const raws: MeetingRaw[] = [];
  await mapLimit(adapters, 6, async (a) => {
    const key = `fetch:${a.id}`;
    job.start(key, `Fetching ${a.name}`);
    const r = await timed((c) => a.fetchMeeting!(meeting, c || deps.ctx), `${a.name} meeting`, deps.ctx, 90_000);
    if (r.value) r.value.races = r.value.races.filter((race) => Number.isInteger(race.number) && race.number >= 1 && race.number <= MAX_RACES);
    if (r.error || !r.value) {
      job.finish(key, 'warn', `Unavailable: ${r.error || 'no data'}`);
      statuses.push(statusOf(a, false, r.ms, { error: r.error || 'no data' }));
      return;
    }
    const races = r.value.races.length;
    const runners = r.value.races.reduce((n, race) => n + race.runners.length, 0);
    raws.push(r.value);
    statuses.push(statusOf(a, true, r.ms, { itemCount: runners }));
    job.finish(key, races ? 'done' : 'warn', races ? `${races} races, ${runners} runners in ${(r.ms / 1000).toFixed(1)}s` : 'Responded but had no races for this meeting');
  });
  return { raws, statuses };
}

async function fetchDeepForm(deps: ResearchDeps, meeting: MeetingSummary, raws: MeetingRaw[], job: JobHandle): Promise<void> {
  const adapters = deps.registry.withCapability('form', deps.settings.disabledSources);
  if (!adapters.length) return;
  job.start('form', 'Collecting detailed form (past starts, breeding, statistics)');
  const raceNumbers = clampRaceNumbers(raws.flatMap((m) => m.races.map((r) => r.number)));
  let added = 0;
  let failures = 0;
  for (const a of adapters) {
    let existing = raws.find((m) => m.source === a.id);
    // Only call fetchForm when the adapter's racecard didn't already include form lines.
    const alreadyHasForm = existing?.races.some((r) => r.runners.some((x) => (x.form?.length || 0) > 0));
    if (alreadyHasForm) continue;
    if (!existing) {
      // The race card call failed or timed out but form may still answer: keep it as its own (form-only) source.
      existing = { meeting, races: [], source: a.id, fetchedAt: new Date().toISOString() };
      raws.push(existing);
    }
    await mapLimit(raceNumbers, 3, async (n) => {
      const r = await timed((c) => a.fetchForm!(meeting, n, c || deps.ctx), `${a.name} form R${n}`, deps.ctx, 30_000);
      if (r.error || !r.value) {
        failures++;
        return;
      }
      const target = existing?.races.find((x) => x.number === n);
      if (target) {
        for (const fr of r.value) {
          const key = normaliseName(fr.name);
          const hit = target.runners.find((x) => normaliseName(x.name) === key || (fr.number && x.number === fr.number));
          if (hit) Object.assign(hit, { ...fr, ...stripUndefined(hit), form: fr.form?.length ? fr.form : hit.form, odds: hit.odds || fr.odds });
          else target.runners.push(fr);
          added++;
        }
      } else if (existing) {
        existing.races.push({ number: n, name: `Race ${n}`, distance: 0, status: 'unknown', sourceRefs: {}, runners: r.value, source: a.id, fetchedAt: new Date().toISOString() });
        added += r.value.length;
      }
    });
  }
  job.finish('form', failures && !added ? 'warn' : 'done', `${added} runner form records${failures ? `, ${failures} lookups failed` : ''}`);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) (out as Record<string, unknown>)[k] = v;
  return out;
}

async function fetchWeather(deps: ResearchDeps, meeting: MeetingSummary, job: JobHandle): Promise<{ weather?: WeatherSummary; statuses: SourceStatus[] }> {
  const adapters = deps.registry.withCapability('weather', deps.settings.disabledSources);
  const statuses: SourceStatus[] = [];
  if (!adapters.length) return { statuses };
  job.start('weather', 'Checking weather and likely track condition');
  for (const a of adapters) {
    const r = await timed((c) => a.fetchWeather!(meeting.venue, meeting.date, c || deps.ctx), `${a.name} weather`, deps.ctx, 20_000);
    statuses.push(statusOf(a, !r.error && !!r.value, r.ms, { error: r.error }));
    if (r.value) {
      job.finish('weather', 'done', r.value.summary);
      return { weather: r.value, statuses };
    }
  }
  job.finish('weather', 'warn', 'No weather source responded');
  return { statuses };
}

async function fetchNews(deps: ResearchDeps, meeting: MeetingSummary, races: Race[], job: JobHandle): Promise<{ news: NewsItem[]; statuses: SourceStatus[] }> {
  const adapters = deps.registry.withCapability('news', deps.settings.disabledSources);
  const statuses: SourceStatus[] = [];
  if (!adapters.length) return { news: [], statuses };
  job.start('news', 'Scanning news and online chatter for every runner');
  const qs = buildNewsQueries(meeting, races);
  const items: NewsItem[] = [];
  await Promise.all(
    adapters.map(async (a) => {
      const started = Date.now();
      let failures = 0;
      // Sequential per source with a small pause: friendly to rate limits (Reddit, Google).
      for (const q of qs) {
        const r = await timed((c) => a.searchNews!(q, c || deps.ctx), `${a.name} news`, deps.ctx, 15_000);
        if (r.error) failures++;
        else items.push(...(r.value || []));
        await sleep(a.id === 'reddit' ? 1200 : 250);
      }
      statuses.push(statusOf(a, failures < qs.length, Date.now() - started, { itemCount: items.filter((i) => i.source === a.id).length, error: failures ? `${failures}/${qs.length} queries failed` : undefined }));
    }),
  );
  // Match against all runners of the meeting
  const everyone = { runners: races.flatMap((r) => r.runners.map((x) => ({ name: x.name, jockey: x.jockey, trainer: x.trainer }))) };
  const matched = matchNews(dedupeNews(items), everyone, [meeting.venue, ...races.map((r) => r.name)]);
  for (const race of races) {
    for (const r of race.runners) {
      const key = normaliseName(r.name);
      r.news = matched.filter((n) => n.mentions.some((m) => normaliseName(m) === key)).slice(0, 12);
    }
  }
  job.finish('news', 'done', `${matched.length} relevant items from ${qs.length} searches`);
  return { news: matched, statuses };
}

/**
 * Build a compact set of news queries: the meeting, each feature race, and the
 * runners grouped six at a time as "A" OR "B" OR ... (all our news sources
 * understand OR). Keeps a 9-race card to ~20 queries per source instead of 100+.
 */
export function buildNewsQueries(meeting: MeetingSummary, races: Array<Pick<Race, 'name' | 'group' | 'runners'>>, groupSize = 6): string[] {
  const out: string[] = [`${meeting.venue} races ${meeting.date}`];
  const names: string[] = [];
  for (const race of races) {
    if (race.group || /stakes|cup|plate|classic|guineas/i.test(race.name)) out.push(race.name.replace(/^R\d+\s+/i, ''));
    for (const r of race.runners) if (!r.scratched && r.name && !names.includes(r.name)) names.push(r.name);
  }
  for (let i = 0; i < names.length; i += groupSize) out.push(names.slice(i, i + groupSize).map((n) => `"${n}"`).join(' OR '));
  return [...new Set(out)];
}

function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    const k = it.url || normaliseName(it.title);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

export function predictAll(pack: MeetingPack, settings: Settings, now: Date, onlyRaces?: number[]): void {
  for (const race of pack.races) {
    if (onlyRaces && !onlyRaces.includes(race.number)) continue;
    if (race.status === 'abandoned') continue;
    if (pack.results[race.number]) continue; // never re-predict a finished race
    race.runners = summariseRaceMarket(race.runners); // keep consensus odds on the saved runners for the UI
    const previous = pack.predictions[race.number];
    pack.predictions[race.number] = predictRace(race, {
      venueSlug: pack.meeting.venueSlug,
      weather: pack.weather,
      news: pack.news,
      dayPatterns: pack.dayPatterns,
      settings,
      now,
      previous,
    });
  }
}

/** Full research of a meeting. */
export async function researchMeeting(deps: ResearchDeps, meeting: MeetingSummary, job: JobHandle): Promise<MeetingPack> {
  const now = deps.now?.() ?? new Date();
  const statuses: SourceStatus[] = [];

  job.message(`Researching ${meeting.venue} ${meeting.date}`);
  const { raws, statuses: s1 } = await fetchAllSources(deps, meeting, job);
  statuses.push(...s1);
  if (!raws.length) throw new Error('No source returned a race card for this meeting. Check your internet connection and the source health panel.');

  await fetchDeepForm(deps, meeting, raws, job);

  job.start('reconcile', 'Cross-checking every runner across sources');
  const reconciled = reconcileMeeting(raws, { sources: sourceMeta(deps.registry) });
  const conflicts = reconciled.verification.conflicts.length;
  job.finish('reconcile', 'done', `${reconciled.races.length} races, ${reconciled.races.reduce((n, r) => n + r.runners.length, 0)} runners; ${conflicts} conflict${conflicts === 1 ? '' : 's'} flagged; verification ${(reconciled.verification.score * 100).toFixed(0)}%`);

  const { weather, statuses: s2 } = await fetchWeather(deps, meeting, job);
  statuses.push(...s2);

  const { news, statuses: s3 } = await fetchNews(deps, meeting, reconciled.races, job);
  statuses.push(...s3);

  // Meeting-level conditions from the best source
  const header: MeetingSummary = { ...meeting, sources: reconciled.sources, timezone: meeting.timezone || zoneForAustralianState(meeting.state) || 'Australia/Melbourne' };
  for (const raw of raws) {
    header.trackCondition = header.trackCondition || raw.meeting.trackCondition;
    header.trackRating = header.trackRating ?? raw.meeting.trackRating;
    header.rail = header.rail || raw.meeting.rail;
    header.weather = header.weather || raw.meeting.weather;
    header.raceCount = header.raceCount || raw.meeting.raceCount || raw.races.length;
    header.firstRaceTime = header.firstRaceTime || raw.meeting.firstRaceTime;
    header.state = header.state || raw.meeting.state;
  }
  for (const race of reconciled.races) {
    race.trackRating = race.trackRating ?? header.trackRating;
    race.trackCondition = race.trackCondition || header.trackCondition;
  }

  const pack: MeetingPack = {
    id: meeting.id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    meeting: header,
    races: reconciled.races,
    predictions: {},
    weather,
    news,
    sourceStatuses: statuses,
    dayPatterns: [],
    results: {},
    history: [],
    verificationScore: reconciled.verification.score,
    settings: deps.settings,
  };

  // Rate every race first so races that have already been run get a scorecard, then learn from those results.
  job.start('predict', 'Rating every race and building betting structures');
  predictAll(pack, deps.settings, now);
  job.finish('predict', 'done', `${Object.keys(pack.predictions).length} races predicted`);

  await collectResults(deps, pack, job, true);
  pack.dayPatterns = detectDayPatterns(pack.races, pack.results);
  if (pack.dayPatterns.length) {
    job.start('patterns', 'Applying patterns from today\'s results to the remaining races');
    predictAll(pack, deps.settings, now);
    job.finish('patterns', 'done', pack.dayPatterns.map((p) => p.label).join('; '));
  }

  pack.history.push({ at: now.toISOString(), type: 'research', summary: `Full research: ${raws.length} source${raws.length === 1 ? '' : 's'} responded, verification ${(pack.verificationScore * 100).toFixed(0)}%` });
  job.message(`Done – ${pack.races.length} races researched`);
  return pack;
}

/** First three placings as a comparable key. */
function placingsKey(placings: number[][]): string {
  return placings
    .slice(0, 3)
    .map((slot) => [...slot].sort((a, b) => a - b).join('/'))
    .join('>');
}

/**
 * Choose one result from what the sources reported: two sources agreeing on the first three placings
 * make a result "confirmed"; a lone source is recorded but flagged; disagreement prefers a source that
 * calls the result final and records the conflict.
 */
export function chooseResult(reports: RaceResult[]): { result: RaceResult; note?: string } | undefined {
  const valid = reports.filter((r) => r.placings?.length);
  if (!valid.length) return undefined;
  const groups = new Map<string, RaceResult[]>();
  for (const r of valid) {
    const k = placingsKey(r.placings);
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  const ranked = [...groups.values()].sort((a, b) => b.length - a.length || (b.some((r) => r.status === 'final') ? 1 : 0) - (a.some((r) => r.status === 'final') ? 1 : 0));
  const best = ranked[0];
  const chosen = best.find((r) => r.status === 'final') || best[0];
  const confirmedBy = best.map((r) => r.source);
  // One agreeing source still calling it interim (protest, correct weight not yet signalled) keeps it interim:
  // another feed labelling the same placings final does not outvote that.
  const status: RaceResult['status'] = best.some((r) => r.status === 'interim') ? 'interim' : 'final';
  const result: RaceResult = { ...chosen, status, confirmedBy, dividends: Object.assign({}, ...best.map((r) => r.dividends || {})) };
  if (!Object.keys(result.dividends || {}).length) delete result.dividends;
  let note: string | undefined;
  if (ranked.length > 1) note = `Sources disagree on the placings: ${ranked.map((g) => `${g.map((r) => r.source).join('+')} say ${g[0].placings.slice(0, 3).map((s) => s.join('/')).join('-')}`).join('; ')}`;
  else if (best.length === 1 && valid.length === 1) note = `Only ${chosen.source} has reported this result so far`;
  return { result, note };
}

/** A failed source call, worded to fit on a phone: "TAB: HTTP 403". */
interface SourceFailure {
  name: string;
  error: string;
}

/** "HTTP 403 for https://api…/results" -> "HTTP 403"; long messages are cut short. */
function shortError(message: string): string {
  const s = message.replace(/\s+(?:for|from)\s+https?:\/\/\S+/gi, '').trim();
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}

/** Last time each "source: error" was logged, so a source that refuses every call (e.g. geo-blocked) is logged every 15 minutes, not every call. */
const resultsWarnedAt = new Map<string, number>();
const RESULTS_WARN_EVERY_MS = 15 * 60_000;

/** Ask every results source about one race and cross-check the answers – one feed is never enough to settle a race. Failed calls are logged and reported, not swallowed. */
async function fetchResultReports(deps: ResearchDeps, adapters: SourceAdapter[], pack: MeetingPack, raceNumber: number): Promise<{ reports: RaceResult[]; failures: SourceFailure[] }> {
  const answers = await mapLimit(adapters, 3, async (a) => {
    const r = await timed((c) => a.fetchResults!(pack.meeting, raceNumber, c || deps.ctx), `${a.name} results R${raceNumber}`, deps.ctx, 30_000);
    if (r.error) {
      const key = `${a.id}|${shortError(r.error)}`;
      const last = resultsWarnedAt.get(key);
      if (last === undefined || Date.now() - last >= RESULTS_WARN_EVERY_MS) {
        resultsWarnedAt.set(key, Date.now());
        deps.ctx.log.warn(`${a.name} results ${pack.meeting.venue} R${raceNumber}: ${r.error}`);
      }
    }
    return { a, r };
  });
  return {
    reports: answers.map(({ r }) => r.value).filter((v): v is RaceResult => !!v),
    failures: answers.filter(({ r }) => r.error).map(({ a, r }) => ({ name: a.name, error: shortError(r.error!) })),
  };
}

type ResultKind = 'new' | 'confirmed' | 'corrected';

/** Same placings (first three), status and number of agreeing sources. */
export function sameResult(a: RaceResult | undefined, b: RaceResult | undefined): boolean {
  return !!a && !!b && placingsKey(a.placings) === placingsKey(b.placings) && (a.status ?? 'final') === (b.status ?? 'final') && (a.confirmedBy?.length ?? 0) === (b.confirmedBy?.length ?? 0);
}

/**
 * Record a result chosen from the sources when it tells us something the pack does not already know; returns
 * what kind of news it was. A result typed in by hand is never replaced by a fetched one, whoever asks.
 */
function applyChosenResult(pack: MeetingPack, raceNumber: number, result: RaceResult, opts: { history: boolean }): ResultKind | undefined {
  const existing = pack.results[raceNumber];
  if (isManualResult(existing)) return undefined;
  if (sameResult(existing, result)) return undefined;
  // The same final placings from fewer sources (one of them did not answer this time) is no news: keep the firmer record.
  const fewer = (result.confirmedBy?.length ?? 0) < (existing?.confirmedBy?.length ?? 0);
  if (existing && fewer && existing.status === 'final' && result.status === 'final' && placingsKey(existing.placings) === placingsKey(result.placings)) return undefined;
  const kind: ResultKind = existing && placingsKey(existing.placings) !== placingsKey(result.placings) ? 'corrected' : existing ? 'confirmed' : 'new';
  recordResult(pack, raceNumber, result, kind, opts);
  return kind;
}

/** Pull results for the races of a freshly researched pack that have finished. Returns race numbers newly resulted or corrected. */
export async function collectResults(deps: ResearchDeps, pack: MeetingPack, job: JobHandle, verbose = true): Promise<number[]> {
  const adapters = deps.registry.withCapability('results', deps.settings.disabledSources);
  const now = deps.now?.() ?? new Date();
  const candidates = resultCandidates(pack, now);
  if (!adapters.length || !candidates.length) {
    if (verbose) {
      job.start('results', 'Collecting results of races already run');
      job.finish('results', 'done', candidates.length ? 'No results source available' : 'No races have been run yet');
    }
    return [];
  }
  if (verbose) job.start('results', 'Collecting results of races already run');
  const newly: number[] = [];
  for (const race of candidates) {
    const chosen = chooseResult((await fetchResultReports(deps, adapters, pack, race.number)).reports);
    if (!chosen) continue;
    if (!applyChosenResult(pack, race.number, chosen.result, { history: true })) continue;
    if (chosen.note) pack.history.push({ at: now.toISOString(), type: 'note', raceNumber: race.number, summary: `R${race.number}: ${chosen.note}` });
    newly.push(race.number);
  }
  if (verbose) job.finish('results', 'done', newly.length ? `Results in for R${newly.join(', R')}` : 'No new results yet');
  return newly;
}

/**
 * Races whose result is worth asking for when a whole meeting is checked on request: jumped (or reported
 * running/finished), not abandoned, not typed in by hand, and not already final from two sources (unless that
 * result's late-correction look is due). The automatic looks use dueResultChecks instead.
 */
function resultCandidates(pack: MeetingPack, now: Date): Race[] {
  const unsettled = (n: number) => {
    const r = pack.results[n];
    return !r || (!isManualResult(r) && (r.status === 'interim' || (r.confirmedBy?.length || 0) < 2 || correctionLookDue(pack, n, now.getTime())));
  };
  return pack.races.filter((r) => r.status !== 'abandoned' && unsettled(r.number) && (!r.startTime || new Date(r.startTime).getTime() <= now.getTime() + 60_000 || r.status === 'final' || r.status === 'interim'));
}

function describeWinner(pack: MeetingPack, result: RaceResult): string {
  const race = pack.races.find((r) => r.number === result.raceNumber);
  const winner = race?.runners.find((r) => result.placings[0]?.includes(r.number));
  return winner ? `${winner.name} (${winner.number})` : `#${result.placings[0]?.join('/')}`;
}

function scorecardLine(sc: NonNullable<RaceResult['scorecard']>): string {
  const parts = [sc.winnerRank ? `winner was our #${sc.winnerRank}` : 'winner was not in our ranking'];
  if (sc.trifectaBoxHit) parts.push('trifecta box hit');
  else if (sc.quinellaHit) parts.push('quinella hit');
  if (sc.exactaHit) parts.push('exacta hit');
  return parts.join(', ');
}

export interface CollectAndRerateOptions {
  /** True when the server ran the check by itself (the history line then starts with "Automatic"). */
  automatic?: boolean;
}

/** What one results pass found; the callers turn it into job steps and history. */
interface ResultsPass {
  /** Races whose result arrived, changed or firmed up. */
  newly: number[];
  /** Races the sources were asked about. */
  checked: number[];
  /** Races found to be abandoned (no result will come). */
  abandoned: number[];
  /** News per race: "R1 result in - Alpha (1) won", "R5 abandoned". */
  headlines: string[];
  /** No news per race: "R2 nothing published yet". */
  waiting: string[];
  /** Scorecards, source disagreements and unreachable sources, for the history event's details. */
  details: string[];
  /** Races for which not one results source answered (as opposed to answering with nothing). */
  unanswered: number[];
  /** Every failed source call of the pass, de-duplicated: "TAB: HTTP 403". */
  failures: string[];
}

const emptyPass = (): ResultsPass => ({ newly: [], checked: [], abandoned: [], headlines: [], waiting: [], details: [], unanswered: [], failures: [] });

/**
 * The one results pass behind the automatic watcher, the Fetch results button,
 * the phone's catch-up and the results step of a pre-race check. For each race
 * it asks every results source, cross-checks the answers, records what is new
 * and keeps the per-race bookkeeping in pack.resultWatch: when to look again,
 * settled (with one late-correction look for a result settled early), given
 * up, or – when the race card says so – abandoned. A result typed in by hand is
 * never re-fetched or replaced. `history: true` also writes the per-race result
 * lines (the pre-race check's style); otherwise the caller writes one line.
 */
async function checkRaceResults(deps: ResearchDeps, pack: MeetingPack, races: Race[], adapters: SourceAdapter[], now: Date, opts: { history: boolean }): Promise<ResultsPass> {
  const at = now.toISOString();
  const nowMs = now.getTime();
  const out = emptyPass();
  const watchMap = (pack.resultWatch ??= {});
  for (const race of races) {
    if (isManualResult(pack.results[race.number])) continue;
    out.checked.push(race.number);
    const { reports, failures } = await fetchResultReports(deps, adapters, pack, race.number);
    const reasons = failures.map((f) => `${f.name}: ${f.error}`);
    for (const r of reasons) if (!out.failures.includes(r)) out.failures.push(r);
    const unanswered = failures.length === adapters.length;
    const chosen = chooseResult(reports);
    const wasSettled = isResultSettled(pack, race.number);
    const watch = (watchMap[race.number] ??= { lastCheckedAt: at, attempts: 0 });
    const previousCheck = watch.attempts > 0 ? Date.parse(watch.lastCheckedAt) : undefined;
    watch.lastCheckedAt = at;
    watch.attempts += 1;
    const start = race.startTime ? Date.parse(race.startTime) : NaN;
    const next = Number.isFinite(start) ? nextResultCheckAt(start, nowMs) : undefined;
    /** Book the next check; false when the schedule is exhausted. */
    const schedule = (note: string): boolean => {
      delete watch.correctionCheckAt;
      if (!next) {
        delete watch.nextCheckAt;
        return false;
      }
      watch.nextCheckAt = new Date(next).toISOString();
      delete watch.gaveUp;
      watch.note = note;
      return true;
    };
    const settle = (note: string): void => {
      delete watch.nextCheckAt;
      delete watch.gaveUp;
      watch.note = note;
      // Settled early: one more look later for a correction (protest upheld, amended placings), then never again.
      const look = start + RESULT_WATCH.correctionLookMs;
      if (Number.isFinite(look) && look > nowMs) watch.correctionCheckAt = new Date(look).toISOString();
      else delete watch.correctionCheckAt;
    };

    if (!chosen && !pack.results[race.number]) {
      // Nothing published – or the race will never be run: results feeds stay silent for an abandoned race.
      if (Number.isFinite(start) && abandonProbeDue(start, previousCheck, nowMs) && (await raceAbandoned(deps, pack, race.number))) {
        race.status = 'abandoned';
        delete watchMap[race.number];
        out.abandoned.push(race.number);
        out.headlines.push(`R${race.number} abandoned`);
        continue;
      }
      if (unanswered) {
        out.unanswered.push(race.number);
        out.details.push(`R${race.number}: no results source answered (${reasons.join('; ')})`);
      }
      const waitingNote = unanswered ? `No results source answered (${reasons.join('; ')})` : 'Nothing published yet';
      if (!schedule(waitingNote)) {
        if (Number.isFinite(start)) {
          watch.gaveUp = true;
          watch.note = unanswered ? 'Could not reach the results sources for 4 hours - check the connection, then press Fetch results or enter it manually' : 'No result published after 4 hours - enter it manually or press Fetch results';
        } else watch.note = waitingNote;
      }
      out.waiting.push(`R${race.number} ${unanswered ? 'no results source answered' : 'nothing published yet'}`);
      continue;
    }

    // A race that already has a result and got no answer this time is treated like an unchanged look.
    const kind = chosen ? applyChosenResult(pack, race.number, chosen.result, { history: opts.history }) : undefined;
    if (kind && opts.history && chosen?.note) pack.history.push({ at, type: 'note', raceNumber: race.number, summary: `R${race.number}: ${chosen.note}` });
    const stored = pack.results[race.number];
    const sources = stored.confirmedBy?.length ?? 1;
    const who = describeWinner(pack, stored);
    if (kind) {
      out.newly.push(race.number);
      out.headlines.push(
        kind === 'corrected'
          ? `R${race.number} result corrected - ${who} won`
          : kind === 'confirmed' && stored.status === 'final' && sources >= 2
            ? `R${race.number} result confirmed by ${sources} sources - ${who} won`
            : `R${race.number} ${stored.status === 'interim' ? 'interim result' : 'result'} in - ${who} won`,
      );
      if (stored.scorecard) out.details.push(`R${race.number}: ${scorecardLine(stored.scorecard)}`);
    }
    if (chosen?.note && /disagree/i.test(chosen.note)) out.details.push(`R${race.number}: ${chosen.note}`);
    if (unanswered) out.details.push(`R${race.number}: no results source answered (${reasons.join('; ')})`);

    if (wasSettled && !kind) {
      // A look at a result that was already settled (its late-correction look, or a button press): unchanged, so it stays settled.
      if (correctionLookDue(pack, race.number, nowMs)) delete watch.correctionCheckAt;
      out.waiting.push(`R${race.number} no change`);
      continue;
    }
    if (stored.status === 'interim') {
      if (!schedule('Interim result - waiting for it to be declared final')) {
        watch.gaveUp = true;
        watch.note = 'Result still interim 4 hours after the jump - check it manually';
      }
      if (!kind) out.waiting.push(`R${race.number} still interim`);
    } else if (sources >= 2) {
      settle(`Confirmed by ${sources} sources`);
    } else {
      // Final, but one source only: a few more looks for a second opinion, then accept it. A look nobody answered counts too.
      const k = kind ? 0 : confirmationChecks(watch) + 1;
      const sourceName = deps.registry.get(stored.source)?.name ?? stored.source;
      if (k >= RESULT_WATCH.confirmationChecks || !schedule(`Result from ${sourceName} only - waiting for a second source (extra check ${k} of ${RESULT_WATCH.confirmationChecks})`)) settle('One source only');
      if (!kind) out.waiting.push(`R${race.number} still from one source`);
    }
  }
  return out;
}

/**
 * Results check behind the automatic watcher, the phone's catch-up and the
 * "Fetch results" button. Asks every results source about the races given (or
 * every race that has jumped), cross-checks the answers, records what is new,
 * keeps the per-race watch bookkeeping in pack.resultWatch (when to look again,
 * or that the race is settled / given up / abandoned), and – only when something
 * new arrived – refreshes the day patterns and re-rates the races still to be
 * run. Nothing else is touched. Writes a single history line describing the
 * whole check.
 */
export async function collectAndRerate(deps: ResearchDeps, pack: MeetingPack, job: JobHandle, only?: number[], opts: CollectAndRerateOptions = {}): Promise<{ newly: number[]; checked: number[] }> {
  const now = deps.now?.() ?? new Date();
  const at = now.toISOString();
  const automatic = opts.automatic === true;
  const prefix = automatic ? 'Automatic results check' : 'Results check';
  const adapters = deps.registry.withCapability('results', deps.settings.disabledSources);
  const wanted = only ? clampRaceNumbers(only) : undefined;
  // A result typed in by hand is never re-fetched – not even on request. One final and agreed by two sources is
  // not re-fetched either, apart from its one late-correction look.
  const settledForGood = (n: number) => {
    const r = pack.results[n];
    return !!r && (isManualResult(r) || (r.status !== 'interim' && (r.confirmedBy?.length || 0) >= 2 && !correctionLookDue(pack, n, now.getTime())));
  };
  const candidates = wanted ? pack.races.filter((r) => wanted.includes(r.number) && r.status !== 'abandoned' && !settledForGood(r.number)) : resultCandidates(pack, now);

  job.start('results', 'Fetching results');
  const pass = adapters.length && candidates.length ? await checkRaceResults(deps, pack, candidates, adapters, now, { history: false }) : emptyPass();
  const { newly, checked, abandoned, headlines, waiting, details } = pass;
  const noneAnswered = checked.length > 0 && pass.unanswered.length === checked.length;
  const failed = pass.failures.length ? ` (${pass.failures.join('; ')})` : '';
  job.finish(
    'results',
    !adapters.length || noneAnswered ? 'warn' : 'done',
    !adapters.length
      ? 'No results source available'
      : !candidates.length
        ? wanted
          ? 'Nothing to check - already settled'
          : 'No races have been run yet'
        : noneAnswered
          ? `No results source answered${failed}`
          : `${newly.length ? `Results in for R${newly.join(', R')}` : 'No new results yet'}${failed}`,
  );

  // Only news changes the picture: patterns and the remaining races are re-rated when a result arrived, changed or firmed up.
  let rerated: number[] = [];
  if (newly.length) {
    job.start('patterns', 'Day patterns');
    pack.dayPatterns = detectDayPatterns(pack.races, pack.results);
    const resulted = Object.keys(pack.results).length;
    job.finish('patterns', 'done', pack.dayPatterns.length ? pack.dayPatterns.map((p) => p.label).join('; ') : `No strong patterns yet (${resulted} result${resulted === 1 ? '' : 's'} in)`);
    rerated = pack.races.filter((r) => !pack.results[r.number] && r.status !== 'abandoned').map((r) => r.number);
    job.start('repredict', 'Re-rating');
    predictAll(pack, deps.settings, now, rerated);
    job.finish('repredict', 'done', rerated.length ? `${rerated.length} race${rerated.length === 1 ? '' : 's'} re-rated` : 'No races left to rate');
  } else {
    job.step('patterns', 'Day patterns');
    job.finish('patterns', 'skipped', 'No new results');
    job.step('repredict', 'Re-rating');
    job.finish('repredict', 'skipped', 'No new results');
  }

  // One history line for the whole check. Consecutive automatic "nothing yet" lines collapse into one so the day's story stays readable.
  const news = newly.length > 0 || abandoned.length > 0;
  let summary: string;
  if (news) summary = `${prefix}: ${headlines.join('; ')}${rerated.length ? `; R${rerated.join(', R')} re-rated` : ''}`;
  else if (!checked.length) summary = `${prefix}: ${!adapters.length ? 'no results source available' : wanted ? `R${wanted.join(', R')} already settled` : 'no races have been run yet'}`;
  else {
    const states = new Set(waiting.map((w) => w.replace(/^R\d+ /, '')));
    summary = `${prefix} R${checked.join(', R')}: ${states.size === 1 ? [...states][0] : waiting.join('; ')}`;
  }
  const event: PackEvent = { at, type: 'results', summary };
  if (checked.length === 1) event.raceNumber = checked[0];
  if (details.length) event.changes = details;
  const last = pack.history[pack.history.length - 1];
  if (automatic && !news && checked.length && last?.type === 'results' && last.summary.startsWith(`${prefix} R`)) {
    const m = last.summary.match(/ \((\d+) checks so far\)$/);
    event.summary = `${summary} (${(m ? Number(m[1]) : 1) + 1} checks so far)`;
    pack.history[pack.history.length - 1] = event;
  } else pack.history.push(event);
  job.message(newly.length ? `Results recorded for R${newly.join(', R')}` : abandoned.length ? `R${abandoned.join(', R')} abandoned` : 'No new results yet');
  return { newly, checked };
}

export function recordResult(pack: MeetingPack, raceNumber: number, result: RaceResult, kind: ResultKind = 'new', opts: { history?: boolean } = {}): void {
  const race = pack.races.find((r) => r.number === raceNumber);
  const prediction = pack.predictions[raceNumber];
  const stored: RaceResult = { ...result, raceNumber, status: result.status || 'final', recordedAt: result.recordedAt || new Date().toISOString() };
  if (prediction) stored.scorecard = scorePrediction(prediction, stored);
  pack.results[raceNumber] = stored;
  if (race) {
    race.status = stored.status === 'interim' ? 'interim' : 'final';
    race.results = stored.placings;
    for (const r of race.runners) {
      const pos = stored.placings.findIndex((slot) => slot.includes(r.number));
      r.finishingPosition = pos >= 0 ? pos + 1 : r.finishingPosition;
    }
  }
  if (opts.history === false) return;
  const who = describeWinner(pack, stored);
  const tag = stored.status === 'interim' ? ' (interim)' : '';
  const by = stored.confirmedBy?.length ? ` – ${stored.confirmedBy.length >= 2 ? `confirmed by ${stored.confirmedBy.join(', ')}` : `from ${stored.confirmedBy[0]} only`}` : '';
  pack.history.push({
    at: stored.recordedAt,
    type: 'results',
    raceNumber,
    summary: kind === 'corrected' ? `R${raceNumber} result corrected: ${who} won${tag}${by}` : kind === 'confirmed' ? `R${raceNumber} result confirmed: ${who} won${by}` : `R${raceNumber} result: ${who} won${tag}${by}${stored.scorecard ? ` – our pick ranked ${stored.scorecard.winnerRank ?? '?'}${stored.scorecard.trifectaBoxHit ? ', trifecta box hit' : ''}` : ''}`,
  });
}

/**
 * Pre-race recheck: refresh one race (or all remaining), pull the results that are due (with the watcher's
 * own bookkeeping, so it never re-fetches a settled or hand-typed result), detect patterns, re-predict.
 */
export async function recheckMeeting(deps: ResearchDeps, pack: MeetingPack, job: JobHandle, raceNumber?: number): Promise<{ changes: string[]; refreshed: number[] }> {
  const now = deps.now?.() ?? new Date();
  const adapters = deps.registry.withCapability('racecard', deps.settings.disabledSources);
  const targets = pack.races.filter((r) => !pack.results[r.number] && r.status !== 'abandoned' && (raceNumber ? r.number === raceNumber : true));
  const changes: string[] = [];
  const refreshed: number[] = [];

  // 1. Fresh race cards --------------------------------------------------------
  const statuses: SourceStatus[] = [];
  for (const race of targets) {
    const key = `refresh:${race.number}`;
    job.start(key, `Refreshing R${race.number} (odds, scratchings, riders)`);
    const raws: Array<{ source: string; weight: number; race: RaceRaw }> = [];
    await mapLimit(adapters, 6, async (a) => {
      const fn = a.fetchRace
        ? (c?: FetchContext) => a.fetchRace!(pack.meeting, race.number, c || deps.ctx)
        : async (c?: FetchContext) => {
            const m = await a.fetchMeeting!(pack.meeting, c || deps.ctx);
            const r = m.races.find((x) => x.number === race.number);
            if (!r) throw new Error(`race ${race.number} not in ${a.name} card`);
            return r;
          };
      const r = await timed(fn, `${a.name} R${race.number}`, deps.ctx, 30_000);
      statuses.push(statusOf(a, !r.error && !!r.value, r.ms, { error: r.error }));
      if (r.value) raws.push({ source: a.id, weight: a.kind === 'official' ? 1 : a.kind === 'form' ? 0.85 : 0.65, race: r.value });
    });
    if (!raws.length) {
      job.finish(key, 'warn', 'No source responded – keeping earlier data');
      continue;
    }
    const fresh = reconcileRace(raws);
    const before = race;
    const merged = mergeRaceRefresh(before, fresh);
    // Describe field changes
    for (const r of merged.runners) {
      const prev = before.runners.find((x) => x.id === r.id || (x.number === r.number && x.number > 0));
      if (!prev) {
        changes.push(`R${race.number}: ${r.name} (${r.number}) added to the field`);
        continue;
      }
      if (!prev.scratched && r.scratched) changes.push(`R${race.number}: ${r.name} (${r.number}) scratched`);
      if (prev.scratched && !r.scratched) changes.push(`R${race.number}: ${r.name} (${r.number}) reinstated`);
      if (prev.jockey && r.jockey && !samePeople(prev.jockey, r.jockey)) changes.push(`R${race.number}: ${r.name} jockey change ${prev.jockey} → ${r.jockey}`);
      if (prev.barrier && r.barrier && prev.barrier !== r.barrier) changes.push(`R${race.number}: ${r.name} barrier ${prev.barrier} → ${r.barrier}`);
    }
    if (before.trackRating && merged.trackRating && before.trackRating !== merged.trackRating) changes.push(`R${race.number}: track rating ${before.trackRating} → ${merged.trackRating}`);
    if (before.status !== 'abandoned' && merged.status === 'abandoned') {
      changes.push(`R${race.number}: race abandoned`);
      if (pack.resultWatch) delete pack.resultWatch[race.number];
    }
    const idx = pack.races.findIndex((x) => x.number === race.number);
    pack.races[idx] = merged;
    refreshed.push(race.number);
    job.finish(key, 'done', `${raws.length} source${raws.length === 1 ? '' : 's'}, ${merged.fieldSize} runners`);
  }
  pack.sourceStatuses = mergeStatuses(pack.sourceStatuses, statuses);

  // 2. Results of earlier races + day patterns ---------------------------------
  // Only the races the watcher would look at now, through the watcher's own pass: one set of rules for every
  // results path (manual results untouched, settled ones left alone, resultWatch kept up to date).
  const resultAdapters = deps.registry.withCapability('results', deps.settings.disabledSources);
  const due = dueResultChecks(pack, now, { autoResults: true });
  const dueRaces = pack.races.filter((r) => due.includes(r.number));
  job.start('results', 'Collecting results of races already run');
  const pass = resultAdapters.length && dueRaces.length ? await checkRaceResults(deps, pack, dueRaces, resultAdapters, now, { history: true }) : emptyPass();
  const newly = pass.newly;
  for (const n of pass.abandoned) changes.push(`R${n}: race abandoned`);
  job.finish(
    'results',
    resultAdapters.length ? 'done' : 'warn',
    !resultAdapters.length ? 'No results source available' : !dueRaces.length ? 'No results due right now' : newly.length ? `Results in for R${newly.join(', R')}` : 'No new results yet',
  );
  job.start('patterns', 'Looking for patterns in today\'s results');
  const before = pack.dayPatterns;
  pack.dayPatterns = detectDayPatterns(pack.races, pack.results);
  const patternChanges = describePatternChanges(before, pack.dayPatterns);
  changes.push(...patternChanges);
  job.finish('patterns', 'done', pack.dayPatterns.length ? pack.dayPatterns.map((p) => p.label).join('; ') : `No strong patterns yet (${Object.keys(pack.results).length} result${Object.keys(pack.results).length === 1 ? '' : 's'} in)`);

  // 3. Re-predict -------------------------------------------------------------
  job.start('repredict', 'Re-rating with the latest information');
  const previous: Record<number, Prediction> = { ...pack.predictions };
  // A result that arrived in this check re-rates every race still to be run, as the watcher would.
  const toPredict = raceNumber && !newly.length ? [raceNumber] : pack.races.filter((r) => !pack.results[r.number] && r.status !== 'abandoned').map((r) => r.number);
  predictAll(pack, deps.settings, now, toPredict);
  for (const n of raceNumber ? [raceNumber] : toPredict) {
    const p = pack.predictions[n];
    if (p?.changes?.length) changes.push(...p.changes.map((c) => `R${n}: ${c}`));
    else if (p && previous[n]) p.changes = p.changes || [];
  }
  job.finish('repredict', 'done', `${toPredict.length} race${toPredict.length === 1 ? '' : 's'} re-rated`);

  // The headline verification must describe the data the picks now rest on.
  pack.verificationScore = round(mean(pack.races.map((r) => r.verification.score)), 3);
  pack.meeting.sources = [...new Set(pack.races.flatMap((r) => r.sources))];

  pack.history.push({
    at: now.toISOString(),
    type: 'recheck',
    raceNumber,
    summary: raceNumber ? `Pre-race check R${raceNumber}: ${changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'no changes'}${newly.length ? `, results in for R${newly.join(', R')}` : ''}` : `Pre-race check (all remaining): ${changes.length} change${changes.length === 1 ? '' : 's'}${newly.length ? `, results in for R${newly.join(', R')}` : ''}`,
    changes,
  });
  job.message(changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'} found` : 'No changes – picks stand');
  return { changes, refreshed };
}

function describePatternChanges(before: DayPattern[], after: DayPattern[]): string[] {
  const out: string[] = [];
  for (const p of after) if (!before.some((b) => b.key === p.key)) out.push(`New pattern: ${p.label} – ${p.detail}`);
  for (const b of before) if (!after.some((p) => p.key === b.key)) out.push(`Pattern faded: ${b.label}`);
  return out;
}

function mergeStatuses(old: SourceStatus[], fresh: SourceStatus[]): SourceStatus[] {
  const map = new Map(old.map((s) => [s.source, s]));
  for (const s of fresh) map.set(s.source, s);
  return [...map.values()];
}
