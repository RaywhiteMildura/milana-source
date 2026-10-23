import { Router, type Request, type Response, type NextFunction } from 'express';
import type { MeetingPack, MeetingSummary, RaceResult, Settings, SourceStatus } from '../../shared/types.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { FetchContext } from '../adapters/types.js';
import { JobManager, StillQueuedError } from '../jobs/manager.js';
import { collectAndRerate, discoverMeetings, dueResultChecks, isManualResult, keepJumpedPredictions, predictAll, recheckMeeting, recordResult, researchMeeting, sameResult, scoreResult, skipResultsJob, type ResearchDeps } from '../jobs/research.js';
import { Store } from '../store/store.js';
import { detectDayPatterns } from '../core/daypatterns.js';
import { withTimeout } from '../core/http.js';

export interface ApiDeps {
  registry: AdapterRegistry;
  store: Store;
  ctx: FetchContext;
  jobs: JobManager;
  mode: 'live' | 'demo';
  version: string;
  now?: () => Date;
  /** Extra fields merged into GET /api/health for authenticated callers (LAN urls, scheduler status). */
  healthExtras?: () => Record<string, unknown>;
}

class HttpProblem extends Error {
  constructor(
    public status: number,
    message: string,
    /** Extra fields for the JSON error body. */
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** The answer for a quick change still queued behind a long job of the same meeting: 202, with the job to follow. */
export interface QueuedReply {
  queued: true;
  jobId: string;
  message: string;
}

/**
 * Run a quick change through the meeting's queue. When it is still waiting behind
 * a long job after a phone-sized wait, answer 202 { queued, jobId, message } – the
 * change is not lost, it is applied as soon as the job ahead ends – instead of
 * holding the request open or failing.
 */
async function queuedChange<T>(res: Response, run: () => Promise<T>, message: string): Promise<{ done: true; value: T } | { done: false }> {
  try {
    return { done: true, value: await run() };
  } catch (err) {
    if (!(err instanceof StillQueuedError)) throw err;
    res.status(202).json({ queued: true, jobId: err.jobId, message } satisfies QueuedReply);
    return { done: false };
  }
}

/** Placings in a comparable form (dead heats in any order). */
const placingsText = (placings: number[][]): string => JSON.stringify(placings.map((slot) => [...slot].sort((a, b) => a - b)));

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

export function createApi(deps: ApiDeps): Router {
  const r = Router();
  const lastStatuses = new Map<string, SourceStatus>();
  const researchDeps = (): ResearchDeps => ({ registry: deps.registry, ctx: deps.ctx, settings: deps.store.getSettings(), now: deps.now });
  const remember = (statuses: SourceStatus[]) => statuses.forEach((s) => lastStatuses.set(s.source, s));

  r.get('/health', (_req, res) => {
    // Public part: enough for the app shell, deploy health checks and the login screen.
    const auth = (res.locals.auth as { required: boolean; authenticated: boolean } | undefined) ?? { required: false, authenticated: true };
    // `time` is the server's own clock (the one the automation runs on); the web app aligns its countdowns to it.
    const body: Record<string, unknown> = { ok: true, mode: deps.mode, version: deps.version, time: (deps.now?.() ?? new Date()).toISOString(), authRequired: auth.required };
    if (auth.authenticated) Object.assign(body, { dataDir: deps.store.dir }, deps.healthExtras?.() ?? {});
    res.json(body);
  });

  r.get('/settings', (_req, res) => res.json(deps.store.getSettings()));
  r.put(
    '/settings',
    wrap((req, res) => {
      const body = (req.body || {}) as Partial<Settings>;
      const clean: Partial<Settings> = {};
      if (typeof body.bankroll === 'number' && body.bankroll >= 0) clean.bankroll = body.bankroll;
      if (typeof body.unitAmount === 'number' && body.unitAmount > 0) clean.unitAmount = body.unitAmount;
      if (body.riskProfile && ['conservative', 'balanced', 'aggressive'].includes(body.riskProfile)) clean.riskProfile = body.riskProfile;
      if (typeof body.jurisdiction === 'string' && /^[A-Z]{2,3}$/.test(body.jurisdiction)) clean.jurisdiction = body.jurisdiction;
      if (Array.isArray(body.disabledSources)) clean.disabledSources = body.disabledSources.filter((s) => typeof s === 'string');
      if (typeof body.autoRecheckMinutesBeforeRace === 'number' && body.autoRecheckMinutesBeforeRace >= 0) clean.autoRecheckMinutesBeforeRace = body.autoRecheckMinutesBeforeRace;
      if (typeof body.autoResults === 'boolean') clean.autoResults = body.autoResults;
      res.json(deps.store.saveSettings(clean));
    }),
  );

  r.get('/sources', (_req, res) => {
    const settings = deps.store.getSettings();
    res.json({
      sources: deps.registry.all().map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        capabilities: a.capabilities,
        homepage: a.homepage,
        enabled: !settings.disabledSources.includes(a.id),
        lastStatus: lastStatuses.get(a.id),
      })),
    });
  });

  r.post(
    '/sources/probe',
    wrap((_req, res) => {
      const date = todayLocal(deps.now?.() ?? new Date());
      const job = deps.jobs.start('probe', { plannedSteps: deps.registry.all().map((a) => [`probe:${a.id}`, `Checking ${a.name}`]) }, async (job) => {
        for (const a of deps.registry.all()) {
          job.start(`probe:${a.id}`, `Checking ${a.name}`);
          const started = Date.now();
          try {
            let count: number | undefined;
            if (a.listMeetings) count = (await withTimeout(a.listMeetings(date, deps.ctx), 20_000, a.name)).length;
            else if (a.searchNews) count = (await withTimeout(a.searchNews('horse racing', deps.ctx), 20_000, a.name)).length;
            else if (a.fetchWeather) count = (await withTimeout(a.fetchWeather('Flemington', date, deps.ctx), 20_000, a.name)) ? 1 : 0;
            const status: SourceStatus = { source: a.id, name: a.name, kind: a.kind, ok: true, ms: Date.now() - started, itemCount: count, fetchedAt: new Date().toISOString(), url: a.homepage };
            lastStatuses.set(a.id, status);
            job.finish(`probe:${a.id}`, 'done', `${count ?? '?'} item(s) in ${status.ms}ms`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            lastStatuses.set(a.id, { source: a.id, name: a.name, kind: a.kind, ok: false, ms: Date.now() - started, error: msg, fetchedAt: new Date().toISOString(), url: a.homepage });
            job.finish(`probe:${a.id}`, 'warn', msg);
          }
        }
      });
      res.json({ jobId: job.id });
    }),
  );

  r.get(
    '/meetings',
    wrap(async (req, res) => {
      const date = String(req.query.date || todayLocal(deps.now?.() ?? new Date()));
      if (!isPlausibleDate(date)) throw new HttpProblem(400, 'date must be a real date, YYYY-MM-DD, between 2000 and 2100');
      const cacheKey = `meetings:${date}`;
      const force = req.query.force === '1';
      const cached = force ? undefined : deps.store.cacheGet<{ meetings: MeetingSummary[]; statuses: SourceStatus[] }>(cacheKey, 10 * 60_000);
      if (cached && cached.meetings.length) {
        res.json({ date, meetings: cached.meetings, sourceStatuses: cached.statuses, fromCache: true });
        return;
      }
      const result = await discoverMeetings(researchDeps(), date);
      remember(result.statuses);
      if (result.meetings.length) deps.store.cacheSet(cacheKey, result);
      res.json({ date, meetings: result.meetings, sourceStatuses: result.statuses, fromCache: false });
    }),
  );

  r.post(
    '/research',
    wrap(async (req, res) => {
      const { date, venueSlug } = (req.body || {}) as { date?: string; venueSlug?: string; force?: boolean };
      if (!date || !isPlausibleDate(date)) throw new HttpProblem(400, 'date must be a real date, YYYY-MM-DD, between 2000 and 2100');
      if (!venueSlug) throw new HttpProblem(400, 'venueSlug is required');
      const cacheKey = `meetings:${date}`;
      let meetings = deps.store.cacheGet<{ meetings: MeetingSummary[] }>(cacheKey, 6 * 60 * 60_000)?.meetings;
      let meeting = meetings?.find((m) => m.venueSlug === venueSlug);
      if (!meeting) {
        const d = await discoverMeetings(researchDeps(), date);
        remember(d.statuses);
        meetings = d.meetings;
        meeting = meetings.find((m) => m.venueSlug === venueSlug);
      }
      if (!meeting) throw new HttpProblem(404, `No meeting '${venueSlug}' found on ${date}`);
      const meetingId = meeting.id;
      const plannedSteps: Array<[string, string]> = [
        ...deps.registry.withCapability('racecard', deps.store.getSettings().disabledSources).map((a) => [`fetch:${a.id}`, `Fetching ${a.name}`] as [string, string]),
        ['form', 'Collecting detailed form'],
        ['reconcile', 'Cross-checking across sources'],
        ['weather', 'Weather & track'],
        ['news', 'News & rumours'],
        ['results', 'Results so far'],
        ['predict', 'Rating & betting structure'],
      ];
      const job = deps.jobs.start('research', { meetingId, plannedSteps }, async (job) => {
        // Re-running research must not throw away results, scorecards, the picks races jumped with and the day's
        // history. (Jobs of one meeting run one at a time, so the pack read here is still current at the end.)
        const existing = deps.store.getPack(meetingId);
        const pack = await researchMeeting(researchDeps(), meeting!, job, existing);
        if (existing) carryOver(existing, pack, deps.store.getSettings(), deps.now?.() ?? new Date());
        deps.store.savePack(pack);
      });
      res.json({ jobId: job.id, meetingId });
    }),
  );

  r.get('/jobs', (_req, res) => res.json(deps.jobs.list()));
  r.get('/jobs/:id', (req, res) => {
    const job = deps.jobs.get(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    res.json(job);
  });

  r.get('/packs', (_req, res) => res.json(deps.store.listPacks()));
  r.get('/packs/:id', (req, res) => {
    const pack = deps.store.getPack(req.params.id as string);
    if (!pack) {
      res.status(404).json({ error: 'pack not found' });
      return;
    }
    res.json(pack);
  });
  r.delete(
    '/packs/:id',
    wrap(async (req, res) => {
      const id = req.params.id as string;
      // Through the per-meeting queue so an in-flight job cannot resurrect the file afterwards.
      const out = await queuedChange(res, () => deps.jobs.exclusive(id, () => deps.store.deletePack(id), { label: 'Deleting the meeting' }), 'Still finishing another job for this meeting – it will be deleted as soon as that job ends.');
      if (out.done) res.json({ ok: out.value });
    }),
  );

  r.get('/packs/:id/races/:n', (req, res) => {
    const pack = deps.store.getPack(req.params.id as string);
    const n = Number(req.params.n);
    const race = pack?.races.find((x) => x.number === n);
    if (!pack || !race) {
      res.status(404).json({ error: 'race not found' });
      return;
    }
    res.json({ race, prediction: pack.predictions[n], result: pack.results[n] });
  });

  r.post(
    '/packs/:id/recheck',
    wrap((req, res) => {
      const pack = deps.store.getPack(req.params.id as string);
      if (!pack) throw new HttpProblem(404, 'pack not found');
      const raceNumber = (req.body || {}).raceNumber as number | undefined;
      if (raceNumber != null && !pack.races.some((x) => x.number === raceNumber)) throw new HttpProblem(400, 'unknown race number');
      if (raceNumber != null && pack.results[raceNumber]) throw new HttpProblem(400, `Race ${raceNumber} has already been run – use Fetch results to update it`);
      const job = deps.jobs.start('recheck', { meetingId: pack.id, raceNumber, plannedSteps: [['results', 'Results so far'], ['patterns', 'Day patterns'], ['repredict', 'Re-rating']] }, async (job) => {
        const latest = deps.store.getPack(pack.id);
        if (!latest) throw new Error('This meeting was deleted before the check ran');
        await recheckMeeting(researchDeps(), latest, job, raceNumber);
        if (deps.store.getPack(pack.id)) deps.store.savePack(latest);
      });
      res.json({ jobId: job.id });
    }),
  );

  r.post(
    '/packs/:id/results',
    wrap((req, res) => {
      const pack = deps.store.getPack(req.params.id as string);
      if (!pack) throw new HttpProblem(404, 'pack not found');
      const body = (req.body || {}) as { raceNumber?: number; catchup?: unknown };
      const raceNumber = body.raceNumber;
      if (raceNumber != null && !pack.races.some((x) => x.number === raceNumber)) throw new HttpProblem(400, 'unknown race number');
      if (body.catchup != null && typeof body.catchup !== 'boolean') throw new HttpProblem(400, 'catchup must be true or false');
      const plannedSteps: Array<[string, string]> = [['results', 'Fetching results'], ['patterns', 'Day patterns'], ['repredict', 'Re-rating']];
      if (body.catchup === true) {
        // The phone's catch-up: only what the watcher itself would look at now (its booked slots, never a settled,
        // given-up or hand-typed result), run as an automatic check – same history and confirmation rules as the scheduler.
        const due = dueResultChecks(pack, deps.now?.() ?? new Date(), { autoResults: true }).filter((n) => raceNumber == null || n === raceNumber);
        if (!due.length) {
          res.json({ jobId: null, due: [] });
          return;
        }
        const job = deps.jobs.start('results', { meetingId: pack.id, raceNumber: due.length === 1 ? due[0] : undefined, plannedSteps }, async (job) => {
          const latest = deps.store.getPack(pack.id);
          if (!latest) throw new Error('This meeting was deleted before the results check ran');
          // The scheduler may have looked at these races while this job was queued.
          const still = dueResultChecks(latest, deps.now?.() ?? new Date(), { autoResults: true }).filter((n) => due.includes(n));
          if (!still.length) {
            skipResultsJob(job, 'Already checked');
            return;
          }
          await collectAndRerate(researchDeps(), latest, job, still, { automatic: true });
          if (deps.store.getPack(pack.id)) deps.store.savePack(latest);
        });
        res.json({ jobId: job.id, due });
        return;
      }
      // Same code path as the automatic watcher: fetch, cross-check, record, day patterns, re-rate the rest.
      const job = deps.jobs.start('results', { meetingId: pack.id, raceNumber, plannedSteps }, async (job) => {
        const latest = deps.store.getPack(pack.id);
        if (!latest) throw new Error('This meeting was deleted before the results check ran');
        await collectAndRerate(researchDeps(), latest, job, raceNumber != null ? [raceNumber] : undefined);
        if (deps.store.getPack(pack.id)) deps.store.savePack(latest);
      });
      res.json({ jobId: job.id });
    }),
  );

  r.post(
    '/packs/:id/results/manual',
    wrap(async (req, res) => {
      const id = req.params.id as string;
      const probe = deps.store.getPack(id);
      if (!probe) throw new HttpProblem(404, 'pack not found');
      const { raceNumber, placings } = (req.body || {}) as { raceNumber?: number; placings?: number[][] };
      const probeRace = probe.races.find((x) => x.number === raceNumber);
      if (!probeRace) throw new HttpProblem(400, 'unknown race number');
      if (!Array.isArray(placings) || !placings.length || placings.length > 24 || !placings.every((p) => Array.isArray(p) && p.length > 0 && p.every((n) => Number.isInteger(n) && n > 0))) throw new HttpProblem(400, 'placings must be non-empty groups of runner numbers');
      if (new Set(placings.flat()).size !== placings.flat().length) throw new HttpProblem(400, 'a runner cannot fill two placings');
      const numbers = new Set(probeRace.runners.map((x) => x.number));
      const unknown = placings.flat().filter((n) => !numbers.has(n));
      if (unknown.length) throw new HttpProblem(400, `Unknown runner number(s): ${unknown.join(', ')}`);
      // Applied through the per-meeting queue so a running job cannot overwrite the typed-in result.
      const n = probeRace.number;
      const out = await queuedChange(res, () => deps.jobs
        .exclusive(
          id,
          () => {
            const pack = deps.store.getPack(id);
            if (!pack) throw new Error('pack not found');
            const existing = pack.results[n];
            // The same entry again (e.g. a retry after a slow save) changes nothing and is not a correction.
            if (isManualResult(existing) && placingsText(existing.placings) === placingsText(placings)) return pack;
            const result: RaceResult = { raceNumber: n, placings, recordedAt: new Date().toISOString(), source: 'manual', status: 'final', confirmedBy: ['manual'] };
            recordResult(pack, n, result, !existing ? 'new' : placingsText(existing.placings) !== placingsText(placings) ? 'corrected' : 'confirmed');
            // Typed in by hand, the race is settled: the watcher stops and its "next check" line goes away.
            const watch = pack.resultWatch?.[n];
            if (watch) {
              delete watch.nextCheckAt;
              delete watch.gaveUp;
              delete watch.correctionCheckAt;
              watch.note = 'Result entered by hand';
            }
            pack.dayPatterns = detectDayPatterns(pack.races, pack.results);
            predictAll(pack, deps.store.getSettings(), deps.now?.() ?? new Date());
            deps.store.savePack(pack);
            return pack;
          },
          { label: `Saving the result of Race ${n}` },
        ), `Still finishing another job for this meeting – your result for Race ${n} is queued and will be saved as soon as it finishes. No need to enter it again.`);
      if (out.done) res.json(out.value satisfies MeetingPack);
    }),
  );

  r.use((_req: Request, res: Response) => res.status(404).json({ error: 'not found' }));

  // Error handler ---------------------------------------------------------------
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    const status = err instanceof HttpProblem ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    if (status >= 500 && !(err instanceof HttpProblem)) console.error(err);
    res.status(status).json({ error: message, ...(err instanceof HttpProblem ? err.extra : {}) });
  });

  return r;
}

/**
 * Carry results, scorecards, history, the watcher's memory and the predictions (with their betting plans) of the
 * races that have run or jumped from an older pack into a re-researched one; every result is scored against the
 * prediction its race jumped with. A result typed in by hand always wins over what the sources say now.
 */
export function carryOver(existing: MeetingPack, pack: MeetingPack, settings: Settings, now: Date): void {
  const manual = new Set(
    Object.entries(existing.results)
      .filter(([, r]) => isManualResult(r))
      .map(([n]) => Number(n)),
  );
  // The watcher's memory still holds where the fresh research found nothing new for the race (or found the same
  // result); where it found a different result the watcher starts that race afresh.
  const watch = Object.entries(existing.resultWatch ?? {}).filter(([n]) => {
    const raceNumber = Number(n);
    const fresh = pack.results[raceNumber];
    return manual.has(raceNumber) || !fresh || sameResult(existing.results[raceNumber], fresh);
  });
  // The fresh research's own lines about a hand-typed race would contradict the result that is kept.
  pack.history = [...existing.history, ...pack.history.filter((h) => h.raceNumber == null || !manual.has(h.raceNumber))];
  // A race is scored on the picks it jumped with, never on a rating made after it ran.
  keepJumpedPredictions(existing, pack, now);
  for (const n of Object.keys(pack.results)) scoreResult(pack, Number(n));
  for (const [n, result] of Object.entries(existing.results)) {
    const raceNumber = Number(n);
    const fresh = pack.results[raceNumber];
    if (fresh && !manual.has(raceNumber)) continue; // the new research already found (and cross-checked) it
    recordResult(pack, raceNumber, result, 'confirmed', { history: false }); // its line is already in the carried history
    if (fresh && placingsText(fresh.placings.slice(0, 3)) !== placingsText(result.placings.slice(0, 3))) {
      const said = fresh.placings
        .slice(0, 3)
        .map((slot) => slot.join('/'))
        .join('-');
      pack.history.push({ at: now.toISOString(), type: 'note', raceNumber, summary: `R${raceNumber}: kept the result entered by hand (the sources now say ${said})` });
    }
  }
  if (watch.length) pack.resultWatch = Object.fromEntries(watch);
  pack.dayPatterns = detectDayPatterns(pack.races, pack.results);
  predictAll(pack, settings, now);
}

/** Express-level JSON error handler for body-parser failures that never reach the API router. */
export function jsonErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  void _next;
  const e = err as { status?: number; statusCode?: number; message?: string; type?: string };
  const status = e.status || e.statusCode || 500;
  res.status(status).json({ error: status === 400 ? `Bad request: ${e.message || 'invalid JSON body'}` : e.message || 'Server error' });
}

export function isPlausibleDate(s: string): boolean {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function todayLocal(d: Date, tz = 'Australia/Melbourne'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
