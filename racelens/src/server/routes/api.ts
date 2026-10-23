import { Router, type Request, type Response, type NextFunction } from 'express';
import type { MeetingPack, MeetingSummary, RaceResult, Settings, SourceStatus } from '../../shared/types.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { FetchContext } from '../adapters/types.js';
import { JobManager } from '../jobs/manager.js';
import { collectResults, discoverMeetings, predictAll, recheckMeeting, recordResult, researchMeeting, type ResearchDeps } from '../jobs/research.js';
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
}

class HttpProblem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

export function createApi(deps: ApiDeps): Router {
  const r = Router();
  const lastStatuses = new Map<string, SourceStatus>();
  const researchDeps = (): ResearchDeps => ({ registry: deps.registry, ctx: deps.ctx, settings: deps.store.getSettings(), now: deps.now });
  const remember = (statuses: SourceStatus[]) => statuses.forEach((s) => lastStatuses.set(s.source, s));

  r.get('/health', (_req, res) => {
    res.json({ ok: true, mode: deps.mode, version: deps.version, time: new Date().toISOString(), dataDir: deps.store.dir });
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
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpProblem(400, 'date must be YYYY-MM-DD');
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
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpProblem(400, 'date must be YYYY-MM-DD');
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
        const pack = await researchMeeting(researchDeps(), meeting!, job);
        // Re-running research must not throw away results, scorecards and the day's history.
        const existing = deps.store.getPack(meetingId);
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
      const ok = await deps.jobs.exclusive(id, () => deps.store.deletePack(id));
      res.json({ ok });
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
      const raceNumber = (req.body || {}).raceNumber as number | undefined;
      const job = deps.jobs.start('results', { meetingId: pack.id, raceNumber, plannedSteps: [['results', 'Fetching results'], ['patterns', 'Day patterns']] }, async (job) => {
        const latest = deps.store.getPack(pack.id);
        if (!latest) throw new Error('This meeting was deleted before the results check ran');
        const newly = await collectResults(researchDeps(), latest, job, true, raceNumber);
        job.start('patterns', 'Updating day patterns');
        latest.dayPatterns = detectDayPatterns(latest.races, latest.results);
        if (newly.length) predictAll(latest, deps.store.getSettings(), deps.now?.() ?? new Date());
        job.finish('patterns', 'done', latest.dayPatterns.length ? latest.dayPatterns.map((p) => p.label).join('; ') : 'No strong patterns');
        if (deps.store.getPack(pack.id)) deps.store.savePack(latest);
        job.message(newly.length ? `Results recorded for R${newly.join(', R')}` : 'No new results available yet');
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
      if (!Array.isArray(placings) || !placings.length || !placings.every((p) => Array.isArray(p) && p.every((n) => Number.isInteger(n) && n > 0))) throw new HttpProblem(400, 'placings must be number[][]');
      const numbers = new Set(probeRace.runners.map((x) => x.number));
      const unknown = placings.flat().filter((n) => !numbers.has(n));
      if (unknown.length) throw new HttpProblem(400, `Unknown runner number(s): ${unknown.join(', ')}`);
      // Applied through the per-meeting queue so a running job cannot overwrite the typed-in result.
      const updated = await deps.jobs.exclusive(id, () => {
        const pack = deps.store.getPack(id);
        if (!pack) throw new Error('pack not found');
        const result: RaceResult = { raceNumber: probeRace.number, placings, recordedAt: new Date().toISOString(), source: 'manual', status: 'final', confirmedBy: ['manual'] };
        recordResult(pack, probeRace.number, result, pack.results[probeRace.number] ? 'corrected' : 'new');
        pack.dayPatterns = detectDayPatterns(pack.races, pack.results);
        predictAll(pack, deps.store.getSettings(), deps.now?.() ?? new Date());
        deps.store.savePack(pack);
        return pack;
      });
      res.json(updated satisfies MeetingPack);
    }),
  );

  r.use((_req: Request, res: Response) => res.status(404).json({ error: 'not found' }));

  // Error handler ---------------------------------------------------------------
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    const status = err instanceof HttpProblem ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  });

  return r;
}

/** Carry results, scorecards, history and the predictions of resulted races from an older pack into a re-researched one. */
export function carryOver(existing: MeetingPack, pack: MeetingPack, settings: Settings, now: Date): void {
  pack.history = [...existing.history, ...pack.history];
  for (const [n, result] of Object.entries(existing.results)) {
    const raceNumber = Number(n);
    if (pack.results[raceNumber]) continue; // the new research already found (and cross-checked) it
    if (existing.predictions[raceNumber]) pack.predictions[raceNumber] = existing.predictions[raceNumber];
    recordResult(pack, raceNumber, result, 'confirmed');
    pack.history.pop(); // recordResult logs a line; the original is already in the carried history
  }
  pack.dayPatterns = detectDayPatterns(pack.races, pack.results);
  predictAll(pack, settings, now);
  void now;
}

/** Express-level JSON error handler for body-parser failures that never reach the API router. */
export function jsonErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  void _next;
  const e = err as { status?: number; statusCode?: number; message?: string; type?: string };
  const status = e.status || e.statusCode || 500;
  res.status(status).json({ error: status === 400 ? `Bad request: ${e.message || 'invalid JSON body'}` : e.message || 'Server error' });
}

export function todayLocal(d: Date, tz = 'Australia/Melbourne'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
