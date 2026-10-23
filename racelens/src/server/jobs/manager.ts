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

/** In-memory job manager: runs one job at a time per meeting, keeps recent history. */
export class JobManager {
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

  /** Run `fn` after any in-flight job for the same meeting (keeps pack writes serialised) and return its value. */
  async exclusive<T>(meetingId: string, fn: () => Promise<T> | T): Promise<T> {
    let out!: T;
    const job = this.start('results', { meetingId }, async (job) => {
      job.message('Applying change');
      out = await fn();
    });
    const done = await this.wait(job.id, 120_000);
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
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const j = this.jobs.get(id);
      if (!j) throw new Error('job not found');
      if (j.status === 'done' || j.status === 'error') return j;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('job wait timed out');
  }
}
