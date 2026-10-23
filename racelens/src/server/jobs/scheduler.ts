import type { MeetingPack, SchedulerStatus, Settings } from '../../shared/types.js';
import type { Store } from '../store/store.js';
import type { JobManager } from './manager.js';
import { collectAndRerate, isResultSettled, recheckMeeting, RESULT_WATCH, type ResearchDeps } from './research.js';

/**
 * Background scheduler. Every minute it looks at the saved packs for the
 * current race days and
 *
 *  - pre-race: runs a recheck for any race that jumps within
 *    `autoRecheckMinutesBeforeRace` minutes (once on entering the window, once
 *    inside the final three minutes), and
 *  - after the jump: fetches each race's result by itself, cross-checks it,
 *    records it, updates the day patterns and re-rates the remaining races –
 *    no button press needed. The phone screen picks the changes up on its next
 *    refresh, and opening the next race also triggers a catch-up.
 *
 * One tick runs shortly after start-up so a restarted server catches up at once.
 */
export interface SchedulerDeps {
  store: Store;
  jobs: JobManager;
  researchDeps: () => ResearchDeps;
  now?: () => Date;
  log?: { info(msg: string): void; warn(msg: string): void };
}

/** Every distinct Australian offset (incl. daylight saving variants): a meeting date is "today" somewhere in the country. */
const AU_ZONES = ['Australia/Perth', 'Australia/Darwin', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Melbourne'];

/** Local calendar dates (YYYY-MM-DD) at `now` shifted by each day offset, across every Australian zone. */
function localDates(now: Date, dayOffsets: number[]): Set<string> {
  const out = new Set<string>();
  for (const tz of AU_ZONES) {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    for (const d of dayOffsets) out.add(fmt.format(new Date(now.getTime() + d * 86400000)));
  }
  return out;
}

const RESULTS_STEPS: Array<[string, string]> = [
  ['results', 'Fetching results'],
  ['patterns', 'Day patterns'],
  ['repredict', 'Re-rating'],
];

/**
 * Which races are due an automatic results check right now. Pure.
 *
 * Schedule, relative to each race's scheduled start (see RESULT_WATCH /
 * nextResultCheckAt in research.ts): first check at start + 2 min; then every
 * 2 min until start + 30 min; then every 5 min until start + 90 min; then every
 * 15 min until start + 4 h; after that the collector marks resultWatch[n].gaveUp
 * with a note ('No result published after 4 hours - enter it manually or press
 * Fetch results') and the race is left alone.
 *
 * The memory is pack.resultWatch[n] (lastCheckedAt / nextCheckAt / attempts),
 * written by collectAndRerate and persisted with the pack, so restarts do not
 * matter: a race with no entry yet is due as soon as start + 2 min has passed
 * (also the catch-up path for a server that was off while races were run); a
 * race with an entry is due once its nextCheckAt has passed.
 *
 * A race is skipped when it has no start time, is abandoned, is settled (a
 * manual result; a final result confirmed by two sources; or a final result from
 * one source whose extra confirmation checks are used up), when the watcher gave
 * up on it, or when settings.autoResults is false.
 */
export function dueResultChecks(pack: MeetingPack, now: Date, settings: Pick<Settings, 'autoResults'>): number[] {
  if (settings.autoResults === false) return [];
  const t = now.getTime();
  const due: number[] = [];
  for (const race of pack.races) {
    if (!race.startTime || race.status === 'abandoned') continue;
    const start = Date.parse(race.startTime);
    if (!Number.isFinite(start) || t < start + RESULT_WATCH.firstCheckMs) continue;
    if (isResultSettled(pack, race.number)) continue;
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

export class AutoRecheckScheduler {
  private timer?: NodeJS.Timeout;
  private firstTimer?: NodeJS.Timeout;
  private intervalMs = 60_000;
  private lastTickAt?: string;
  private nextTickAt?: string;
  /** `${pack}:${race}:initial|final` pre-race stages already fired */
  private fired = new Set<string>();
  /** Watch entries per pack, keyed by the pack's updatedAt so unchanged packs are not re-read on every health poll. */
  private watchCache = new Map<string, { updatedAt: string; entries: SchedulerStatus['watching'] }>();

  constructor(private readonly deps: SchedulerDeps) {}

  /** Tick every `intervalMs`, with a first tick `firstTickDelayMs` after start so a restarted server catches up immediately. */
  start(intervalMs = 60_000, firstTickDelayMs = 5_000): void {
    this.stop();
    this.intervalMs = intervalMs;
    const run = () => void this.tick().catch((err) => this.deps.log?.warn(`scheduler tick failed: ${err instanceof Error ? err.message : err}`));
    this.timer = setInterval(run, intervalMs);
    this.timer.unref?.();
    this.firstTimer = setTimeout(() => {
      this.firstTimer = undefined;
      run();
    }, Math.max(0, firstTickDelayMs));
    this.firstTimer.unref?.();
    const now = this.deps.now?.() ?? new Date();
    this.nextTickAt = new Date(now.getTime() + Math.max(0, firstTickDelayMs)).toISOString();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstTimer) clearTimeout(this.firstTimer);
    this.timer = undefined;
    this.firstTimer = undefined;
    this.nextTickAt = undefined;
  }

  /** What the scheduler is doing right now (shown in Settings and the pack page). */
  status(): SchedulerStatus {
    const settings = this.deps.store.getSettings();
    const now = this.deps.now?.() ?? new Date();
    const dates = localDates(now, [-1, 0]);
    const watching: SchedulerStatus['watching'] = [];
    const live = new Set<string>();
    for (const item of this.deps.store.listPacks()) {
      if (!dates.has(item.meeting.date)) continue;
      live.add(item.id);
      const cached = this.watchCache.get(item.id);
      if (cached && cached.updatedAt === item.updatedAt) {
        watching.push(...cached.entries);
        continue;
      }
      const pack = this.deps.store.getPack(item.id);
      if (!pack) continue;
      const entries: SchedulerStatus['watching'] = Object.entries(pack.resultWatch ?? {})
        .filter(([n, w]) => !!w.nextCheckAt && !w.gaveUp && !isResultSettled(pack, Number(n)))
        .map(([n, w]) => ({ meetingId: pack.id, venue: pack.meeting.venue, raceNumber: Number(n), attempts: w.attempts, lastCheckedAt: w.lastCheckedAt, nextCheckAt: w.nextCheckAt }));
      this.watchCache.set(item.id, { updatedAt: item.updatedAt, entries });
      watching.push(...entries);
    }
    for (const id of this.watchCache.keys()) if (!live.has(id)) this.watchCache.delete(id);
    watching.sort((a, b) => (a.nextCheckAt || '').localeCompare(b.nextCheckAt || '') || a.raceNumber - b.raceNumber);
    return {
      running: !!this.timer,
      lastTickAt: this.lastTickAt,
      nextTickAt: this.timer ? this.nextTickAt : undefined,
      autoResults: settings.autoResults !== false,
      autoRecheckMinutes: settings.autoRecheckMinutesBeforeRace,
      watching,
    };
  }

  /** Decide which races are due for an automatic pre-race check. Pure apart from the fired-stage memory, for tests. */
  dueRaces(pack: MeetingPack, now: Date, minutesBefore: number): number[] {
    if (minutesBefore <= 0) return [];
    const due: number[] = [];
    for (const race of pack.races) {
      if (!race.startTime || pack.results[race.number] || race.status === 'abandoned') continue;
      const start = new Date(race.startTime).getTime();
      const minsToJump = (start - now.getTime()) / 60000;
      if (minsToJump <= 0 || minsToJump > minutesBefore) continue; // already jumped, or not yet in the window
      // Exactly two automatic checks per race: one when it enters the window, one inside the final 3 minutes.
      const stage = minsToJump <= 3 && minutesBefore > 3 ? 'final' : 'initial';
      const key = `${pack.id}:${race.number}:${stage}`;
      if (this.fired.has(key)) continue;
      if (stage === 'final' && !this.fired.has(`${pack.id}:${race.number}:initial`)) this.fired.add(`${pack.id}:${race.number}:initial`);
      this.fired.add(key);
      due.push(race.number);
    }
    return due;
  }

  /** One pass over the saved packs. Returns the number of jobs started (pre-race rechecks plus results checks). */
  async tick(): Promise<number> {
    const now = this.deps.now?.() ?? new Date();
    const settings = this.deps.store.getSettings();
    const minutes = settings.autoRecheckMinutesBeforeRace;
    const autoResults = settings.autoResults !== false;
    let started = 0;
    // Pre-race checks concern meetings on today's or tomorrow's local date; results concern today's or yesterday's.
    const preRaceDates = localDates(now, [0, 1]);
    const resultDates = localDates(now, [-1, 0]);
    // One results job per meeting at a time: a queued or running one will see the same races.
    const activeResults = new Set(
      this.deps.jobs
        .list()
        .filter((j) => j.type === 'results' && (j.status === 'queued' || j.status === 'running') && j.meetingId)
        .map((j) => j.meetingId as string),
    );
    for (const item of this.deps.store.listPacks()) {
      const wantPreRace = preRaceDates.has(item.meeting.date);
      const wantResults = autoResults && resultDates.has(item.meeting.date);
      if (!wantPreRace && !wantResults) continue;
      const pack = this.deps.store.getPack(item.id);
      if (!pack) continue;

      if (wantPreRace) {
        for (const raceNumber of this.dueRaces(pack, now, minutes)) {
          started++;
          this.deps.log?.info(`Auto pre-race check: ${pack.meeting.venue} R${raceNumber}`);
          this.deps.jobs.start('recheck', { meetingId: pack.id, raceNumber, plannedSteps: [['results', 'Results so far'], ['patterns', 'Day patterns'], ['repredict', 'Re-rating']] }, async (job) => {
            const latest = this.deps.store.getPack(pack.id);
            if (!latest) return; // deleted meanwhile
            await recheckMeeting(this.deps.researchDeps(), latest, job, raceNumber);
            const last = latest.history[latest.history.length - 1];
            if (last) last.summary = `Automatic ${last.summary.replace(/^Pre-race check/, 'pre-race check')}`;
            if (this.deps.store.getPack(pack.id)) this.deps.store.savePack(latest);
          });
        }
      }

      if (wantResults && !activeResults.has(pack.id)) {
        const due = dueResultChecks(pack, now, settings);
        if (!due.length) continue;
        started++;
        activeResults.add(pack.id);
        for (const n of due) this.deps.log?.info(`Auto results: ${pack.meeting.venue} R${n} (attempt ${(pack.resultWatch?.[n]?.attempts ?? 0) + 1})`);
        this.deps.jobs.start('results', { meetingId: pack.id, raceNumber: due.length === 1 ? due[0] : undefined, plannedSteps: RESULTS_STEPS }, async (job) => {
          const latest = this.deps.store.getPack(pack.id);
          if (!latest) return; // deleted meanwhile
          const { newly } = await collectAndRerate(this.deps.researchDeps(), latest, job, due, { automatic: true });
          if (newly.length) this.deps.log?.info(`Auto results: ${pack.meeting.venue} R${newly.join(', R')} recorded, remaining races re-rated`);
          if (this.deps.store.getPack(pack.id)) this.deps.store.savePack(latest);
          this.watchCache.delete(pack.id);
        });
      }
    }
    this.lastTickAt = now.toISOString();
    this.nextTickAt = this.timer ? new Date(now.getTime() + this.intervalMs).toISOString() : undefined;
    return started;
  }
}
