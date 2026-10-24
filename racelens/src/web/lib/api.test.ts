/**
 * The request helper's time limits and wording, against a fake network and
 * fake timers: a slow discovery of the day's meetings on the Mac is waited for,
 * and a request that went out but got no answer is not blamed on Tailscale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, SLOW_MESSAGE, UNREACHABLE_MESSAGE, UnreachableError } from './api';

/** How the fake server answers: after `after` ms, never, or the network refuses the request (Tailscale off). */
let reply: { after: number; body: unknown } | 'never' | 'refused';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('fetch', (_path: string, init: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      if (reply === 'refused') return reject(new TypeError('Load failed'));
      if (reply === 'never') return;
      const { after, body } = reply;
      setTimeout(() => resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })), after);
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Settles `p` into what it gave, and says whether it has settled yet. */
function watch<T>(p: Promise<T>) {
  const out: { done: boolean; value?: T; error?: unknown } = { done: false };
  p.then(
    (value) => Object.assign(out, { done: true, value }),
    (error) => Object.assign(out, { done: true, error }),
  );
  return out;
}

const MEETINGS = { date: '2026-10-24', meetings: [], sourceStatuses: [], fromCache: false };

describe('request time limits', () => {
  it('waits for the meetings while the Mac discovers them from the live sources (well past the usual 15 s)', async () => {
    reply = { after: 30_000, body: MEETINGS };
    const got = watch(api.getMeetings('2026-10-24'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(got).toEqual({ done: true, value: MEETINGS });
  });

  it('gives up on the meetings only after 45 s, saying RaceLens may still be working – not that the Mac is unreachable', async () => {
    reply = 'never';
    const got = watch(api.getMeetings('2026-10-24'));
    await vi.advanceTimersByTimeAsync(44_999);
    expect(got.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(got.error).toBeInstanceOf(UnreachableError);
    expect(got.error).toMatchObject({ timedOut: true, message: SLOW_MESSAGE });
  });

  it('starting research (which may discover the meetings first) gets the same time', async () => {
    reply = { after: 40_000, body: { jobId: 'job_1', meetingId: 'm1' } };
    const got = watch(api.research({ date: '2026-10-24', venueSlug: 'flemington' }));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(got).toEqual({ done: true, value: { jobId: 'job_1', meetingId: 'm1' } });
  });

  it('other reads still give up after 15 s', async () => {
    reply = 'never';
    const got = watch(api.getSettings());
    await vi.advanceTimersByTimeAsync(15_000);
    expect(got.error).toMatchObject({ timedOut: true, message: SLOW_MESSAGE });
  });

  it('a request the network refuses (Tailscale off, no signal) keeps the Tailscale wording', async () => {
    reply = 'refused';
    const got = watch(api.getMeetings('2026-10-24'));
    await vi.advanceTimersByTimeAsync(0);
    expect(got.error).toBeInstanceOf(UnreachableError);
    expect(got.error).toMatchObject({ timedOut: false, message: UNREACHABLE_MESSAGE });
  });
});
