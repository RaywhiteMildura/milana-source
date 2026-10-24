import type { MeetingPack, SchedulerStatus } from '../../shared/types.js';
import type { Store } from '../store/store.js';
import type { JobManager } from './manager.js';
import { collectAndRerate, dueResultChecks, inLateStartGrace, isResultSettled, raceJumped, recheckMeeting, skipResultsJob, type ResearchDeps } from './research.js';

/**
 * Background scheduler. Every minute it looks at the saved packs for the
 * current race days and
 *
 *  - race morning onwards: refreshes the whole card (every race still to run)
 *    about once an hour from 07:30 track time, so a morning scratching or rider
 *    change reaches the picks hours before that race's own checks (cardRefreshDue),
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

/** Which races are due an automatic results check right now – the shared rule lives with the results pass in research.ts. */
export { dueResultChecks };

/** After a results job for a meeting fails (e.g. the disk is full), the scheduler leaves that meeting alone this long before trying again. */
export const RESULTS_RETRY_MS = 5 * 60_000;

/** Race-day refresh of the whole card: at most this often per meeting, and only once the card is this old. */
export const CARD_REFRESH_MS = 60 * 60_000;
/** Track-local time (HH:MM) from which the race-day card refreshes run. */
export const CARD_REFRESH_FROM = '07:30';
/** No card refresh this close to a jump: that race's own pre-race checks are due and must not queue behind it. */
export const CARD_REFRESH_QUIET_MS = 15 * 60_000;

/** Calendar date (YYYY-MM-DD) and 24-hour time (HH:MM) at `now` in an IANA time zone. */
function localClock(now: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const v = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${v('year')}-${v('month')}-${v('day')}`, time: `${v('hour')}:${v('minute')}` };
}

/**
 * Whether the race-day refresh of every race still to run is due. Pure. Due on the meeting's own date from 07:30
 * track time while a race is still to run, once the oldest race card among those races was fetched an hour ago or
 * more (so a pack researched the night before is refreshed on the first tick after 07:30, and a fresh one an hour
 * after its research) – never within 15 minutes of a jump. A race just past its scheduled start that may be running
 * late (inLateStartGrace) still counts as to run, but never holds the refresh back. The scheduler adds the
 * at-most-hourly limit per meeting.
 */
export function cardRefreshDue(pack: MeetingPack, now: Date): boolean {
  const { date, time } = localClock(now, pack.meeting.timezone || 'Australia/Melbourne');
  if (date !== pack.meeting.date || time < CARD_REFRESH_FROM) return false;
  const t = now.getTime();
  const toRun = pack.races.filter((r) => !pack.results[r.number] && r.status !== 'abandoned' && (!raceJumped(r, now) || inLateStartGrace(pack, r, now)));
  if (!toRun.length) return false;
  // Only a jump still to come holds the refresh back: a race past its start has no pre-race checks left to queue.
  const untilJump = (r: (typeof toRun)[number]) => Date.parse(r.startTime ?? '') - t;
  if (toRun.some((r) => untilJump(r) >= 0 && untilJump(r) < CARD_REFRESH_QUIET_MS)) return false;
  const oldest = Math.min(...toRun.map((r) => Date.parse(r.fetchedAt) || 0));
  return t - oldest >= CARD_REFRESH_MS;
}

const RECHECK_STEPS: Array<[string, string]> = [
  ['results', 'Results so far'],
  ['patterns', 'Day patterns'],
  ['repredict', 'Re-rating'],
];

export class AutoRecheckScheduler {
  private timer?: NodeJS.Timeout;
  private firstTimer?: NodeJS.Timeout;
  private intervalMs = 60_000;
  private lastTickAt?: string;
  private nextTickAt?: string;
  /** `${pack}:${race}:${startTime}:initial|final` pre-race stages already fired (a later start time gets its own checks) */
  private fired = new Set<string>();
  /** Watch entries per pack, keyed by the pack's updatedAt so unchanged packs are not re-read on every health poll. */
  private watchCache = new Map<string, { updatedAt: string; entries: SchedulerStatus['watching'] }>();
  /** When the last automatic results job of a meeting failed; cleared by the next one that succeeds. */
  private resultsFailedAt = new Map<string, number>();
  /** Said once that results are due but no results source is enabled (instead of starting a pointless job every minute). */
  private warnedNoResultsSource = false;
  /** When the last race-day card refresh of each meeting was started (also one that failed): at most one per CARD_REFRESH_MS. */
  private cardRefreshedAt = new Map<string, number>();

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
      // Keyed by start time too: a race put back to a later time gets its two checks again before the new jump.
      const base = `${pack.id}:${race.number}:${race.startTime}`;
      const key = `${base}:${stage}`;
      if (this.fired.has(key)) continue;
      if (stage === 'final' && !this.fired.has(`${base}:initial`)) this.fired.add(`${base}:initial`);
      this.fired.add(key);
      due.push(race.number);
    }
    return due;
  }

  /** At most one race-day card refresh per meeting per CARD_REFRESH_MS (a clock set back counts as "long ago"). */
  private cardRefreshAllowed(packId: string, now: Date): boolean {
    const last = this.cardRefreshedAt.get(packId);
    return last === undefined || now.getTime() < last || now.getTime() - last >= CARD_REFRESH_MS;
  }

  /** One pass over the saved packs. Returns the number of jobs started (race-day refreshes, pre-race rechecks and results checks). */
  async tick(): Promise<number> {
    const now = this.deps.now?.() ?? new Date();
    const settings = this.deps.store.getSettings();
    const minutes = settings.autoRecheckMinutesBeforeRace;
    const autoResults = settings.autoResults !== false;
    let started = 0;
    let resultSources: number | undefined;
    const haveResultSources = () => (resultSources ??= this.deps.researchDeps().registry.withCapability('results', settings.disabledSources).length) > 0;
    const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
    // Pre-race checks concern meetings on today's or tomorrow's local date; results concern today's or yesterday's.
    const preRaceDates = localDates(now, [0, 1]);
    const resultDates = localDates(now, [-1, 0]);
    const active = this.deps.jobs.list().filter((j) => (j.status === 'queued' || j.status === 'running') && j.meetingId);
    // One results job per meeting at a time: a queued or running one will see the same races.
    const activeResults = new Set(active.filter((j) => j.type === 'results').map((j) => j.meetingId as string));
    // Meetings with any job queued or running (or started by this tick): the race-day card refresh waits for them.
    const busy = new Set(active.map((j) => j.meetingId as string));
    for (const item of this.deps.store.listPacks()) {
      const wantPreRace = preRaceDates.has(item.meeting.date);
      const wantResults = autoResults && resultDates.has(item.meeting.date);
      if (!wantPreRace && !wantResults) continue;
      const pack = this.deps.store.getPack(item.id);
      if (!pack) continue;

      if (wantPreRace) {
        for (const raceNumber of this.dueRaces(pack, now, minutes)) {
          started++;
          busy.add(pack.id);
          this.deps.log?.info(`Auto pre-race check: ${pack.meeting.venue} R${raceNumber}`);
          this.deps.jobs.start('recheck', { meetingId: pack.id, raceNumber, plannedSteps: RECHECK_STEPS }, async (job) => {
            const latest = this.deps.store.getPack(pack.id);
            if (!latest) return; // deleted meanwhile
            // Queued behind a long job until after the jump: the race keeps the picks it jumped with.
            const race = latest.races.find((r) => r.number === raceNumber);
            if (!race || raceJumped(race, this.deps.now?.() ?? new Date())) {
              this.deps.log?.info(`Auto pre-race check skipped: ${pack.meeting.venue} R${raceNumber} has already jumped`);
              skipResultsJob(job, `R${raceNumber} has already jumped - picks left as they were`);
              return;
            }
            try {
              await recheckMeeting(this.deps.researchDeps(), latest, job, raceNumber);
              const last = latest.history[latest.history.length - 1];
              if (last) last.summary = `Automatic ${last.summary.replace(/^Pre-race check/, 'pre-race check')}`;
              if (this.deps.store.getPack(pack.id)) this.deps.store.savePack(latest);
            } catch (err) {
              this.deps.log?.warn(`Auto pre-race check failed: ${pack.meeting.venue} R${raceNumber}: ${errorText(err)}`);
              throw err;
            }
          });
        }
        // The race-day card refresh only runs with automatic pre-race checks on, never alongside another job of the
        // meeting, and after any results check that is due (that one goes first, the refresh on a later tick).
        if (minutes > 0 && !busy.has(pack.id) && this.cardRefreshAllowed(pack.id, now) && cardRefreshDue(pack, now) && !(wantResults && dueResultChecks(pack, now, settings).length)) {
          started++;
          busy.add(pack.id);
          this.cardRefreshedAt.set(pack.id, now.getTime());
          this.deps.log?.info(`Race-day refresh: ${pack.meeting.venue} (every race still to run)`);
          this.deps.jobs.start('recheck', { meetingId: pack.id, plannedSteps: RECHECK_STEPS }, async (job) => {
            const latest = this.deps.store.getPack(pack.id);
            if (!latest) return; // deleted meanwhile
            // Re-read at run time: a research or pre-race check may have refreshed the card meanwhile.
            if (!cardRefreshDue(latest, this.deps.now?.() ?? new Date())) {
              skipResultsJob(job, 'The race cards are up to date');
              return;
            }
            try {
              await recheckMeeting(this.deps.researchDeps(), latest, job);
              const last = latest.history[latest.history.length - 1];
              if (last) last.summary = last.summary.replace(/^Pre-race check \(all remaining\)/, 'Automatic race-day refresh (every race still to run)');
              if (this.deps.store.getPack(pack.id)) this.deps.store.savePack(latest);
            } catch (err) {
              this.deps.log?.warn(`Race-day refresh failed: ${pack.meeting.venue}: ${errorText(err)}`);
              throw err;
            }
          });
        }
      }

      if (wantResults && !activeResults.has(pack.id)) {
        // A meeting whose last results job failed gets a short rest, not a retry (and an error job) every minute.
        const failedAt = this.resultsFailedAt.get(pack.id);
        if (failedAt !== undefined && now.getTime() - failedAt < RESULTS_RETRY_MS) continue;
        const due = dueResultChecks(pack, now, settings);
        if (!due.length) continue;
        if (!haveResultSources()) {
          if (!this.warnedNoResultsSource) this.deps.log?.warn('Automatic results: races are waiting for a result but every results source is turned off in Settings');
          this.warnedNoResultsSource = true;
          continue;
        }
        this.warnedNoResultsSource = false;
        started++;
        activeResults.add(pack.id);
        for (const n of due) this.deps.log?.info(`Auto results: ${pack.meeting.venue} R${n} (attempt ${(pack.resultWatch?.[n]?.attempts ?? 0) + 1})`);
        this.deps.jobs.start('results', { meetingId: pack.id, raceNumber: due.length === 1 ? due[0] : undefined, plannedSteps: RESULTS_STEPS }, async (job) => {
          const latest = this.deps.store.getPack(pack.id);
          if (!latest) return; // deleted meanwhile
          try {
            // Re-read at run time: a pre-race check, the phone's catch-up or a button press may have looked at these races since the tick.
            const still = dueResultChecks(latest, this.deps.now?.() ?? new Date(), this.deps.store.getSettings());
            if (!still.length) {
              skipResultsJob(job, 'Already checked');
              return;
            }
            const { newly } = await collectAndRerate(this.deps.researchDeps(), latest, job, still, { automatic: true });
            if (this.deps.store.getPack(pack.id)) this.deps.store.savePack(latest);
            this.resultsFailedAt.delete(pack.id);
            if (newly.length) this.deps.log?.info(`Auto results: ${pack.meeting.venue} R${newly.join(', R')} recorded, remaining races re-rated`);
          } catch (err) {
            this.resultsFailedAt.set(pack.id, (this.deps.now?.() ?? new Date()).getTime());
            this.deps.log?.warn(`Auto results failed: ${pack.meeting.venue} R${due.join(', R')} - trying again in ${RESULTS_RETRY_MS / 60_000} min: ${errorText(err)}`);
            throw err; // the job still shows as failed
          } finally {
            this.watchCache.delete(pack.id);
          }
        });
      }
    }
    this.lastTickAt = now.toISOString();
    this.nextTickAt = this.timer ? new Date(now.getTime() + this.intervalMs).toISOString() : undefined;
    return started;
  }
}
