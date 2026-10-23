import { describe, expect, it } from 'vitest';
import { EXCLUSIVE_WAIT_MS, JobManager, StillQueuedError } from './manager.js';

describe('JobManager.exclusive', () => {
  it('waits for the job ahead and returns the value', async () => {
    const jobs = new JobManager();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    jobs.start('results', { meetingId: 'm' }, async () => {
      await gate;
    });
    const order: string[] = [];
    const p = jobs.exclusive('m', () => {
      order.push('change');
      return 42;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual([]); // still queued behind the running job
    release();
    expect(await p).toBe(42);
    expect(order).toEqual(['change']);
  });

  it('gives up waiting with a StillQueuedError (not a generic timeout), and the change is still applied once the job ahead ends', async () => {
    const jobs = new JobManager();
    expect(jobs.exclusiveWaitMs).toBe(EXCLUSIVE_WAIT_MS);
    // Short enough that a phone request never hangs; the change is queued (not lost) when a long job is ahead.
    expect(EXCLUSIVE_WAIT_MS).toBeGreaterThanOrEqual(10_000);
    expect(EXCLUSIVE_WAIT_MS).toBeLessThanOrEqual(30_000);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ahead = jobs.start('results', { meetingId: 'm' }, async () => {
      await gate;
    });
    let applied = false;
    const err = await jobs
      .exclusive(
        'm',
        () => {
          applied = true;
        },
        { waitMs: 60 },
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StillQueuedError);
    const queued = jobs.get((err as StillQueuedError).jobId)!;
    expect(queued.status).toBe('queued');
    expect(applied).toBe(false);
    release();
    await jobs.wait(ahead.id);
    expect((await jobs.wait(queued.id)).status).toBe('done');
    expect(applied).toBe(true);
  });

  it('passes on a failure of the change itself', async () => {
    const jobs = new JobManager();
    await expect(
      jobs.exclusive('m', () => {
        throw new Error('pack not found');
      }),
    ).rejects.toThrow('pack not found');
  });
});
