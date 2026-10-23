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
  /** raceKey → ISO of last automatic recheck */
  private lastRun = new Map<string, string>();

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
      if (minsToJump > minutesBefore || minsToJump < -2) continue; // not yet, or already jumped
      const key = `${pack.id}:${race.number}`;
      const last = this.lastRun.get(key);
      // One automatic check per race inside the window, plus one more inside the final 3 minutes.
      const lastMins = last ? (now.getTime() - new Date(last).getTime()) / 60000 : Infinity;
      if (lastMins === Infinity || (minsToJump <= 3 && lastMins > 2.5 && lastMins < minutesBefore)) due.push(race.number);
    }
    return due;
  }

  async tick(): Promise<number> {
    const now = this.deps.now?.() ?? new Date();
    const settings = this.deps.store.getSettings();
    const minutes = settings.autoRecheckMinutesBeforeRace;
    let started = 0;
    for (const item of this.deps.store.listPacks()) {
      const pack = this.deps.store.getPack(item.id);
      if (!pack) continue;
      const due = this.dueRaces(pack, now, minutes);
      for (const raceNumber of due) {
        this.lastRun.set(`${pack.id}:${raceNumber}`, now.toISOString());
        started++;
        this.deps.log?.info(`Auto pre-race check: ${pack.meeting.venue} R${raceNumber}`);
        this.deps.jobs.start('recheck', { meetingId: pack.id, raceNumber, plannedSteps: [['results', 'Results so far'], ['patterns', 'Day patterns'], ['repredict', 'Re-rating']] }, async (job) => {
          const latest = this.deps.store.getPack(pack.id) || pack;
          await recheckMeeting(this.deps.researchDeps(), latest, job, raceNumber);
          latest.history[latest.history.length - 1].summary = `Automatic ${latest.history[latest.history.length - 1].summary.replace(/^Pre-race check/, 'pre-race check')}`;
          this.deps.store.savePack(latest);
        });
      }
    }
    return started;
  }
}
