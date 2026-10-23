import type { JobProgress, JobStep, JobStepStatus } from '../../shared/types.js';
import { uid } from '../../shared/util.js';

export type JobRunner = (job: JobHandle) => Promise<void>;

/** Handle given to a running job to report progress. */
export class JobHandle {
  constructor(public readonly progress: JobProgress, private readonly onChange: () => void) {}

  step(key: string, label: string): JobStep {
    let s = this.progress.steps.find((x) => x.key === key);
    if (!s) {
      s = { key, label, status: 'pending' };
      this.progress.steps.push(s);
    }
    this.onChange();
    return s;
  }

  start(key: string, label: string, detail?: string): void {
    const s = this.step(key, label);
    s.status = 'running';
    s.startedAt = new Date().toISOString();
    if (detail) s.detail = detail;
    this.progress.message = label;
    this.recompute();
  }

  finish(key: string, status: Exclude<JobStepStatus, 'pending' | 'running'>, detail?: string): void {
    const s = this.progress.steps.find((x) => x.key === key);
    if (!s) return;
    s.status = status;
    s.endedAt = new Date().toISOString();
    if (detail !== undefined) s.detail = detail;
    this.recompute();
  }

  message(msg: string): void {
    this.progress.message = msg;
    this.onChange();
  }

  private recompute(): void {
    const steps = this.progress.steps;
    const done = steps.filter((s) => ['done', 'warn', 'error', 'skipped'].includes(s.status)).length;
    this.progress.percent = steps.length ? Math.round((done / steps.length) * 100) : 0;
    this.onChange();
  }
}

/**
 * How long a quick change to a meeting (a result typed in by hand, deleting the
 * meeting) waits for a job already running for that meeting before the request
 * answers "queued". Phone-sized on purpose: a phone that sleeps or switches app
 * mid-request can drop a long request, and a minutes-long spinner reads as a hang.
 * The change is never dropped: it stays queued and is applied as soon as the job
 * ahead finishes, and the caller gets the job id to follow it.
 */
export const EXCLUSIVE_WAIT_MS = 20_000;

/** exclusive() ran out of waiting while the change was still queued behind another job; it will still be applied. */
export class StillQueuedError extends Error {
  constructor(public readonly jobId: string) {
    super('Another job for this meeting is still running – the change is queued and will be applied as soon as it finishes');
    this.name = 'StillQueuedError';
  }
}

/** In-memory job manager: runs one job at a time per meeting, keeps recent history. */
export class JobManager {
  /** How long exclusive() waits by default (EXCLUSIVE_WAIT_MS; tests shorten it). */
  exclusiveWaitMs = EXCLUSIVE_WAIT_MS;
  private jobs = new Map<string, JobProgress>();
  private order: string[] = [];
  private running = new Map<string, Promise<void>>();

  constructor(private readonly maxHistory = 50) {}

  start(type: JobProgress['type'], meta: { meetingId?: string; raceNumber?: number; plannedSteps?: Array<[string, string]> }, run: JobRunner): JobProgress {
    const progress: JobProgress = {
      id: uid('job_'),
      type,
      meetingId: meta.meetingId,
      raceNumber: meta.raceNumber,
      status: 'queued',
      steps: (meta.plannedSteps || []).map(([key, label]) => ({ key, label, status: 'pending' as JobStepStatus })),
      startedAt: new Date().toISOString(),
      percent: 0,
      message: 'Queued',
    };
    this.jobs.set(progress.id, progress);
    this.order.unshift(progress.id);
    // Evict only finished jobs, oldest first; a queued or running job must stay pollable.
    if (this.order.length > this.maxHistory) {
      for (let i = this.order.length - 1; i >= 0 && this.order.length > this.maxHistory; i--) {
        const j = this.jobs.get(this.order[i]);
        if (j && (j.status === 'done' || j.status === 'error')) {
          this.jobs.delete(this.order[i]);
          this.order.splice(i, 1);
        }
      }
    }

    const handle = new JobHandle(progress, () => undefined);
    const key = meta.meetingId || progress.id;
    const previous = this.running.get(key) || Promise.resolve();
    const p = previous
      .catch(() => undefined)
      .then(async () => {
        progress.status = 'running';
        progress.message = 'Starting…';
        try {
          await run(handle);
          progress.status = 'done';
          progress.percent = 100;
          if (!progress.message || progress.message === 'Starting…') progress.message = 'Done';
        } catch (err) {
          progress.status = 'error';
          progress.error = err instanceof Error ? err.message : String(err);
          progress.message = 'Failed: ' + progress.error;
          for (const s of progress.steps) if (s.status === 'running') s.status = 'error';
        } finally {
          progress.endedAt = new Date().toISOString();
          if (this.running.get(key) === p) this.running.delete(key);
        }
      });
    this.running.set(key, p);
    return progress;
  }

  /**
   * Run `fn` after any in-flight job for the same meeting (keeps pack writes serialised) and return its value.
   * Throws StillQueuedError when `fn` has not run within the wait (`waitMs`, default exclusiveWaitMs); it still runs later.
   */
  async exclusive<T>(meetingId: string, fn: () => Promise<T> | T, opts: { label?: string; waitMs?: number } = {}): Promise<T> {
    let out!: T;
    const job = this.start('results', { meetingId }, async (job) => {
      job.message(opts.label ?? 'Applying change');
      out = await fn();
    });
    const done = await this.settled(job.id, opts.waitMs ?? this.exclusiveWaitMs);
    if (!done) throw new StillQueuedError(job.id);
    if (done.status === 'error') throw new Error(done.error || 'failed');
    return out;
  }

  get(id: string): JobProgress | undefined {
    return this.jobs.get(id);
  }

  list(): JobProgress[] {
    return this.order.map((id) => this.jobs.get(id)!).filter(Boolean);
  }

  /** Await completion (tests). */
  async wait(id: string, timeoutMs = 60_000): Promise<JobProgress> {
    const done = await this.settled(id, timeoutMs);
    if (!done) throw new Error('job wait timed out');
    return done;
  }

  /** The finished job, or undefined when it is still queued or running after `timeoutMs`. */
  private async settled(id: string, timeoutMs: number): Promise<JobProgress | undefined> {
    const started = Date.now();
    for (;;) {
      const j = this.jobs.get(id);
      if (!j) throw new Error('job not found');
      if (j.status === 'done' || j.status === 'error') return j;
      if (Date.now() - started >= timeoutMs) return undefined;
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}
