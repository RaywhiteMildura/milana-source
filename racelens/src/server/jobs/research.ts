import type {
  DayPattern,
  MeetingPack,
  MeetingRaw,
  MeetingSummary,
  NewsItem,
  Prediction,
  Race,
  RaceRaw,
  RaceResult,
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
    // Ask every results source, then cross-check – one feed is never enough to settle a race.
    const reports = (await mapLimit(adapters, 3, async (a) => (await timed((c) => a.fetchResults!(pack.meeting, race.number, c || deps.ctx), `${a.name} results R${race.number}`, deps.ctx, 30_000)).value || null)).filter((r): r is RaceResult => !!r);
    const chosen = chooseResult(reports);
    if (!chosen) continue;
    const existing = pack.results[race.number];
    const changed = !existing || placingsKey(existing.placings) !== placingsKey(chosen.result.placings) || existing.status !== chosen.result.status || (existing.confirmedBy?.length || 0) !== (chosen.result.confirmedBy?.length || 0);
    if (!changed) continue;
    const corrected = !!existing && placingsKey(existing.placings) !== placingsKey(chosen.result.placings);
    recordResult(pack, race.number, chosen.result, corrected ? 'corrected' : existing ? 'confirmed' : 'new');
    if (chosen.note) pack.history.push({ at: now.toISOString(), type: 'note', raceNumber: race.number, summary: `R${race.number}: ${chosen.note}` });
    newly.push(race.number);
  }
  if (verbose) job.finish('results', 'done', newly.length ? `Results in for R${newly.join(', R')}` : 'No new results yet');
  return newly;
}

export function recordResult(pack: MeetingPack, raceNumber: number, result: RaceResult, kind: 'new' | 'confirmed' | 'corrected' = 'new'): void {
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
  const winner = race?.runners.find((r) => stored.placings[0]?.includes(r.number));
  const who = winner ? `${winner.name} (${winner.number})` : `#${stored.placings[0]?.join('/')}`;
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
