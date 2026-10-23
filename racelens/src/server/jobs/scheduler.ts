import type { MeetingPack } from '../../shared/types.js';
import type { Store } from '../store/store.js';
import type { JobManager } from './manager.js';
import { recheckMeeting, type ResearchDeps } from './research.js';

/**
 * Auto pre-race checks. Every minute, look at today's saved packs and run a
 * recheck for any race that jumps within `autoRecheckMinutesBeforeRace`
 * minutes and has not been rechecked in that window. Also collects results
 * for races that finished in the last hour so day patterns update themselves.
 */
export interface SchedulerDeps {
  store: Store;
  jobs: JobManager;
  researchDeps: () => ResearchDeps;
  now?: () => Date;
  log?: { info(msg: string): void; warn(msg: string): void };
}

export class AutoRecheckScheduler {
  private timer?: NodeJS.Timeout;
  /** `${pack}:${race}:initial|final` stages already fired */
  private fired = new Set<string>();

  constructor(private readonly deps: SchedulerDeps) {}

  start(intervalMs = 60_000): void {
    this.stop();
    this.timer = setInterval(() => void this.tick().catch((err) => this.deps.log?.warn(`auto-recheck tick failed: ${err instanceof Error ? err.message : err}`)), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Decide which races are due for an automatic check. Pure, for tests. */
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

  async tick(): Promise<number> {
    const now = this.deps.now?.() ?? new Date();
    const settings = this.deps.store.getSettings();
    const minutes = settings.autoRecheckMinutesBeforeRace;
    let started = 0;
    // Only meetings on today's or tomorrow's local date can have races inside the window.
    const localDates = new Set(['Australia/Perth', 'Australia/Melbourne', 'Australia/Brisbane'].flatMap((tz) => [0, 1].map((d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now.getTime() + d * 86400000)))));
    for (const item of this.deps.store.listPacks()) {
      if (!localDates.has(item.meeting.date)) continue;
      const pack = this.deps.store.getPack(item.id);
      if (!pack) continue;
      const due = this.dueRaces(pack, now, minutes);
      for (const raceNumber of due) {
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
    return started;
  }
}
