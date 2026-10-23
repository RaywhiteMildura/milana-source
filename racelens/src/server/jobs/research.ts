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
  const anyFinal = best.some((r) => r.status === 'final' || r.status === undefined);
  const status: RaceResult['status'] = best.length >= 2 || anyFinal ? (best.every((r) => r.status === 'interim') ? 'interim' : 'final') : 'interim';
  const result: RaceResult = { ...chosen, status, confirmedBy, dividends: Object.assign({}, ...best.map((r) => r.dividends || {})) };
  if (!Object.keys(result.dividends || {}).length) delete result.dividends;
  let note: string | undefined;
  if (ranked.length > 1) note = `Sources disagree on the placings: ${ranked.map((g) => `${g.map((r) => r.source).join('+')} say ${g[0].placings.slice(0, 3).map((s) => s.join('/')).join('-')}`).join('; ')}`;
  else if (best.length === 1 && valid.length === 1) note = `Only ${chosen.source} has reported this result so far`;
  return { result, note };
}

/** Ask every results source about one race and cross-check the answers – one feed is never enough to settle a race. */
async function fetchResultReports(deps: ResearchDeps, adapters: SourceAdapter[], pack: MeetingPack, raceNumber: number): Promise<RaceResult[]> {
  const reports = await mapLimit(adapters, 3, async (a) => (await timed((c) => a.fetchResults!(pack.meeting, raceNumber, c || deps.ctx), `${a.name} results R${raceNumber}`, deps.ctx, 30_000)).value || null);
  return reports.filter((r): r is RaceResult => !!r);
}

type ResultKind = 'new' | 'confirmed' | 'corrected';

/** Record a chosen result when it tells us something the pack does not already know; returns what kind of news it was. */
function applyChosenResult(pack: MeetingPack, raceNumber: number, result: RaceResult, opts: { history: boolean }): ResultKind | undefined {
  const existing = pack.results[raceNumber];
  const changed = !existing || placingsKey(existing.placings) !== placingsKey(result.placings) || existing.status !== result.status || (existing.confirmedBy?.length || 0) !== (result.confirmedBy?.length || 0);
  if (!changed) return undefined;
  const kind: ResultKind = existing && placingsKey(existing.placings) !== placingsKey(result.placings) ? 'corrected' : existing ? 'confirmed' : 'new';
  recordResult(pack, raceNumber, result, kind, opts);
  return kind;
}

/** Pull results for races that have finished. Returns race numbers newly resulted or corrected. */
export async function collectResults(deps: ResearchDeps, pack: MeetingPack, job: JobHandle, verbose = true, only?: number): Promise<number[]> {
  const adapters = deps.registry.withCapability('results', deps.settings.disabledSources);
  const now = deps.now?.() ?? new Date();
  const unsettled = (n: number) => !pack.results[n] || pack.results[n].status === 'interim' || (pack.results[n].confirmedBy?.length || 0) < 2;
  const candidates = pack.races.filter((r) => (only ? r.number === only : true) && unsettled(r.number) && (!r.startTime || new Date(r.startTime).getTime() <= now.getTime() + 60_000 || r.status === 'final' || r.status === 'interim' || only));
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
    const chosen = chooseResult(await fetchResultReports(deps, adapters, pack, race.number));
    if (!chosen) continue;
    if (!applyChosenResult(pack, race.number, chosen.result, { history: true })) continue;
    if (chosen.note) pack.history.push({ at: now.toISOString(), type: 'note', raceNumber: race.number, summary: `R${race.number}: ${chosen.note}` });
    newly.push(race.number);
  }
  if (verbose) job.finish('results', 'done', newly.length ? `Results in for R${newly.join(', R')}` : 'No new results yet');
  return newly;
}

/** Races whose result is worth asking for right now: jumped (or reported running/finished) and not yet settled. */
function resultCandidates(pack: MeetingPack, now: Date): Race[] {
  const unsettled = (n: number) => {
    const r = pack.results[n];
    return !r || (!isManualResult(r) && (r.status === 'interim' || (r.confirmedBy?.length || 0) < 2));
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

/**
 * Results check behind the automatic watcher and the "Fetch results" button.
 * Asks every results source about the races given (or every race that has
 * jumped), cross-checks the answers, records what is new, keeps the per-race
 * watch bookkeeping in pack.resultWatch (when to look again, or that the race
 * is settled / given up), and – only when something new arrived – refreshes the
 * day patterns and re-rates the races still to be run. Nothing else is touched.
 * Writes a single history line describing the whole check.
 */
export async function collectAndRerate(deps: ResearchDeps, pack: MeetingPack, job: JobHandle, only?: number[], opts: CollectAndRerateOptions = {}): Promise<{ newly: number[]; checked: number[] }> {
  const now = deps.now?.() ?? new Date();
  const at = now.toISOString();
  const automatic = opts.automatic === true;
  const prefix = automatic ? 'Automatic results check' : 'Results check';
  const adapters = deps.registry.withCapability('results', deps.settings.disabledSources);
  const wanted = only ? clampRaceNumbers(only) : undefined;
  // A result typed in by hand, or final and agreed by two sources, is never re-fetched – not even on request.
  const settledForGood = (n: number) => {
    const r = pack.results[n];
    return !!r && (isManualResult(r) || (r.status !== 'interim' && (r.confirmedBy?.length || 0) >= 2));
  };
  const candidates = wanted ? pack.races.filter((r) => wanted.includes(r.number) && r.status !== 'abandoned' && !settledForGood(r.number)) : resultCandidates(pack, now);
  const newly: number[] = [];
  const checked: number[] = [];
  const headlines: string[] = [];
  const waiting: string[] = [];
  const details: string[] = [];

  job.start('results', 'Fetching results');
  if (adapters.length && candidates.length) {
    const watchMap = (pack.resultWatch ??= {});
    for (const race of candidates) {
      checked.push(race.number);
      const chosen = chooseResult(await fetchResultReports(deps, adapters, pack, race.number));
      const watch = (watchMap[race.number] ??= { lastCheckedAt: at, attempts: 0 });
      watch.lastCheckedAt = at;
      watch.attempts += 1;
      const start = race.startTime ? Date.parse(race.startTime) : NaN;
      const next = Number.isFinite(start) ? nextResultCheckAt(start, now.getTime()) : undefined;
      /** Book the next check; false when the schedule is exhausted. */
      const schedule = (note: string): boolean => {
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
      };

      if (!chosen) {
        if (!schedule('Nothing published yet')) {
          if (Number.isFinite(start)) {
            watch.gaveUp = true;
            watch.note = 'No result published after 4 hours - enter it manually or press Fetch results';
          } else watch.note = 'Nothing published yet';
        }
        waiting.push(`R${race.number} nothing published yet`);
        continue;
      }

      const kind = applyChosenResult(pack, race.number, chosen.result, { history: false });
      const stored = pack.results[race.number];
      const sources = stored.confirmedBy?.length ?? 1;
      const who = describeWinner(pack, stored);
      if (kind) {
        newly.push(race.number);
        headlines.push(
          kind === 'corrected'
            ? `R${race.number} result corrected - ${who} won`
            : kind === 'confirmed' && stored.status === 'final' && sources >= 2
              ? `R${race.number} result confirmed by ${sources} sources - ${who} won`
              : `R${race.number} ${stored.status === 'interim' ? 'interim result' : 'result'} in - ${who} won`,
        );
        if (stored.scorecard) details.push(`R${race.number}: ${scorecardLine(stored.scorecard)}`);
      }
      if (chosen.note && /disagree/i.test(chosen.note)) details.push(`R${race.number}: ${chosen.note}`);

      if (stored.status === 'interim') {
        if (!schedule('Interim result - waiting for it to be declared final')) {
          watch.gaveUp = true;
          watch.note = 'Result still interim 4 hours after the jump - check it manually';
        }
        if (!kind) waiting.push(`R${race.number} still interim`);
      } else if (sources >= 2) {
        settle(`Confirmed by ${sources} sources`);
      } else {
        // Final, but one source only: a few more looks for a second opinion, then accept it.
        const k = kind ? 0 : confirmationChecks(watch) + 1;
        const sourceName = deps.registry.get(stored.source)?.name ?? stored.source;
        if (k >= RESULT_WATCH.confirmationChecks || !schedule(`Result from ${sourceName} only - waiting for a second source (extra check ${k} of ${RESULT_WATCH.confirmationChecks})`)) settle('One source only');
        if (!kind) waiting.push(`R${race.number} still from one source`);
      }
    }
  }
  job.finish(
    'results',
    adapters.length ? 'done' : 'warn',
    !adapters.length ? 'No results source available' : !candidates.length ? (wanted ? 'Nothing to check - already settled' : 'No races have been run yet') : newly.length ? `Results in for R${newly.join(', R')}` : 'No new results yet',
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
  let summary: string;
  if (newly.length) summary = `${prefix}: ${headlines.join('; ')}${rerated.length ? `; R${rerated.join(', R')} re-rated` : ''}`;
  else if (!checked.length) summary = `${prefix}: ${!adapters.length ? 'no results source available' : wanted ? `R${wanted.join(', R')} already settled` : 'no races have been run yet'}`;
  else {
    const states = new Set(waiting.map((w) => w.replace(/^R\d+ /, '')));
    summary = `${prefix} R${checked.join(', R')}: ${states.size === 1 ? [...states][0] : waiting.join('; ')}`;
  }
  const event: PackEvent = { at, type: 'results', summary };
  if (checked.length === 1) event.raceNumber = checked[0];
  if (details.length) event.changes = details;
  const last = pack.history[pack.history.length - 1];
  if (automatic && !newly.length && checked.length && last?.type === 'results' && last.summary.startsWith(`${prefix} R`)) {
    const m = last.summary.match(/ \((\d+) checks so far\)$/);
    event.summary = `${summary} (${(m ? Number(m[1]) : 1) + 1} checks so far)`;
    pack.history[pack.history.length - 1] = event;
  } else pack.history.push(event);
  job.message(newly.length ? `Results recorded for R${newly.join(', R')}` : 'No new results yet');
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

/** Pre-race recheck: refresh one race (or all remaining), pull results, detect patterns, re-predict. */
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
    const idx = pack.races.findIndex((x) => x.number === race.number);
    pack.races[idx] = merged;
    refreshed.push(race.number);
    job.finish(key, 'done', `${raws.length} source${raws.length === 1 ? '' : 's'}, ${merged.fieldSize} runners`);
  }
  pack.sourceStatuses = mergeStatuses(pack.sourceStatuses, statuses);

  // 2. Results of earlier races + day patterns ---------------------------------
  const newly = await collectResults(deps, pack, job, true);
  job.start('patterns', 'Looking for patterns in today\'s results');
  const before = pack.dayPatterns;
  pack.dayPatterns = detectDayPatterns(pack.races, pack.results);
  const patternChanges = describePatternChanges(before, pack.dayPatterns);
  changes.push(...patternChanges);
  job.finish('patterns', 'done', pack.dayPatterns.length ? pack.dayPatterns.map((p) => p.label).join('; ') : `No strong patterns yet (${Object.keys(pack.results).length} result${Object.keys(pack.results).length === 1 ? '' : 's'} in)`);

  // 3. Re-predict -------------------------------------------------------------
  job.start('repredict', 'Re-rating with the latest information');
  const previous: Record<number, Prediction> = { ...pack.predictions };
  const toPredict = raceNumber ? [raceNumber] : pack.races.filter((r) => !pack.results[r.number]).map((r) => r.number);
  predictAll(pack, deps.settings, now, toPredict);
  for (const n of toPredict) {
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
    summary: raceNumber ? `Pre-race check R${raceNumber}: ${changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'no changes'}` : `Pre-race check (all remaining): ${changes.length} change${changes.length === 1 ? '' : 's'}${newly.length ? `, results in for R${newly.join(', R')}` : ''}`,
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
