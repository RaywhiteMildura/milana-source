import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../app.js';
import { DEMO_DATE, DEMO_MEETING_ID, DEMO_VENUE_SLUG } from '../adapters/demo/index.js';

/**
 * Automatic results, end to end in demo mode. Research the meeting in the
 * morning, move the clock past each race, tick the scheduler and watch the
 * server fetch the result by itself, score it, re-rate the rest of the card and
 * book its next look – without any request from the phone. The demo has a single
 * results source, so the "one source only" confirmation path is exercised too.
 *
 * Demo race times (Melbourne, +11): R1 12:25, R2 13:00, R3 13:35, R4 14:10,
 * R5 14:45, R6 15:20, R7 15:55, R8 16:30, R9 17:05. Results exist for R1–R3.
 */
describe('automatic results (demo mode)', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'racelens-autoresults-'));
  const t = (hhmm: string) => new Date(`${DEMO_DATE}T${hhmm}:00.000+11:00`);
  let clock = t('00:30');
  const built = createApp({ mode: 'demo', dataDir, now: () => clock });
  const { app, store, jobs, scheduler } = built;
  const id = DEMO_MEETING_ID;

  afterAll(() => {
    scheduler.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  /** Results jobs for the demo meeting, newest first. */
  const resultsJobs = () => jobs.list().filter((j) => j.type === 'results' && j.meetingId === id);
  const waitLatest = () => jobs.wait(resultsJobs()[0].id, 60_000);

  it('researches the meeting in the morning: no results, nothing watched', async () => {
    const start = await request(app).post('/api/research').send({ date: DEMO_DATE, venueSlug: DEMO_VENUE_SLUG }).expect(200);
    expect(start.body.meetingId).toBe(id);
    expect((await jobs.wait(start.body.jobId, 60_000)).status).toBe('done');
    const pack = store.getPack(id)!;
    expect(Object.keys(pack.results)).toHaveLength(0);
    expect(pack.resultWatch).toBeUndefined();
    expect(scheduler.status().watching).toEqual([]);
  });

  it('starts no results check until two minutes after the jump (the race-day refresh of the races still to run goes first)', async () => {
    clock = t('12:26'); // R1 jumped at 12:25
    const before = store.getPack(id)!;
    expect(await scheduler.tick()).toBe(1);
    expect(resultsJobs()).toHaveLength(0);
    expect(scheduler.status().lastTickAt).toBe(clock.toISOString());
    // The card was researched at 00:30, so the first tick after 07:30 refreshes every race still to run – not R1, which has jumped.
    const [refresh] = jobs.list().filter((j) => j.type === 'recheck' && j.meetingId === id);
    expect(refresh.raceNumber).toBeUndefined();
    expect((await jobs.wait(refresh.id, 60_000)).status).toBe('done');
    const after = store.getPack(id)!;
    expect(after.predictions[1]).toEqual(before.predictions[1]);
    expect(after.races.find((r) => r.number === 1)!.fetchedAt).toBe(before.races.find((r) => r.number === 1)!.fetchedAt);
    for (const n of [2, 3, 9]) {
      expect(after.races.find((r) => r.number === n)!.fetchedAt).toBe(clock.toISOString());
      expect(after.predictions[n].generatedAt).toBe(clock.toISOString());
    }
    expect(after.history.at(-1)?.summary).toMatch(/^Automatic race-day refresh \(every race still to run\): /);
  });

  it('a tick after race 1 fetches the result, scores it, re-rates the rest of the card and books the next look', async () => {
    const before = store.getPack(id)!;
    clock = t('12:28'); // three minutes after R1
    expect(await scheduler.tick()).toBe(1);
    const [job] = resultsJobs();
    expect(job).toBeDefined();
    expect(job.raceNumber).toBe(1);
    // A second tick while that job is queued or running must not start a duplicate.
    expect(await scheduler.tick()).toBe(0);
    expect(resultsJobs()).toHaveLength(1);

    const done = await jobs.wait(job.id, 60_000);
    expect(done.status).toBe('done');
    expect(done.steps.map((s) => [s.key, s.status])).toEqual([
      ['results', 'done'],
      ['patterns', 'done'],
      ['repredict', 'done'],
    ]);

    const after = store.getPack(id)!;
    const r1 = after.results[1];
    expect(r1).toBeDefined();
    expect(r1.placings[0]).toEqual([6]);
    expect(r1.status).toBe('final');
    expect(r1.confirmedBy).toEqual(['demo-official']);
    expect(r1.scorecard).toBeDefined();
    expect(after.races.find((r) => r.number === 1)!.status).toBe('final');

    const watch = after.resultWatch![1];
    expect(watch.attempts).toBe(1);
    expect(watch.lastCheckedAt).toBe(clock.toISOString());
    // The demo has one results source, so the watcher books a look for a second opinion at the next slot (start + 4 min).
    expect(watch.nextCheckAt).toBe(t('12:29').toISOString());
    expect(watch.note).toBe('Result from Demo Racing Authority (official) only - waiting for a second source (extra check 0 of 3)');
    expect(watch.gaveUp).toBeUndefined();

    const lines = after.history.filter((h) => h.type === 'results');
    expect(lines).toHaveLength(1); // one line for the whole check, not one per race
    expect(lines[0].summary).toContain('Automatic results check');
    expect(lines[0].summary).toContain('R1 result in - Sugarloaf Sprite (6) won');
    expect(lines[0].summary).toContain('R2, R3, R4, R5, R6, R7, R8, R9 re-rated');
    expect(lines[0].raceNumber).toBe(1);

    for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) expect(after.predictions[n].generatedAt > before.predictions[n].generatedAt).toBe(true);
    expect(after.predictions[1].generatedAt).toBe(before.predictions[1].generatedAt); // a resulted race is never re-rated
    expect(after.updatedAt > before.updatedAt).toBe(true); // the phone's poll sees a newer pack

    const status = scheduler.status();
    expect(status.autoResults).toBe(true);
    expect(status.lastTickAt).toBe(clock.toISOString());
    expect(status.watching).toEqual([{ meetingId: id, venue: 'Flemington', raceNumber: 1, attempts: 1, lastCheckedAt: watch.lastCheckedAt, nextCheckAt: watch.nextCheckAt }]);
    // Health exposes the same picture to the app.
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body.scheduler.watching).toEqual(status.watching);
  });

  it('looks three more times for a second source, then accepts the result; nothing is re-rated meanwhile', async () => {
    const before = store.getPack(id)!;
    for (const [time, k] of [
      ['12:29', 1],
      ['12:31', 2],
    ] as const) {
      clock = t(time);
      expect(await scheduler.tick()).toBe(1);
      expect((await waitLatest()).status).toBe('done');
      const w = store.getPack(id)!.resultWatch![1];
      expect(w.attempts).toBe(k + 1);
      expect(w.note).toContain(`extra check ${k} of 3`);
      expect(w.nextCheckAt).toBeDefined();
    }
    clock = t('12:33');
    expect(await scheduler.tick()).toBe(1);
    expect((await waitLatest()).status).toBe('done');

    const after = store.getPack(id)!;
    const w = after.resultWatch![1];
    expect(w.attempts).toBe(4);
    expect(w.note).toBe('One source only');
    expect(w.nextCheckAt).toBeUndefined();
    for (const n of [2, 3, 9]) expect(after.predictions[n].generatedAt).toBe(before.predictions[n].generatedAt);
    const lines = after.history.filter((h) => h.type === 'results');
    expect(lines).toHaveLength(2); // the three "no change" checks collapsed into one line
    expect(lines[1].summary).toBe('Automatic results check R1: still from one source (3 checks so far)');
    expect(scheduler.status().watching).toEqual([]);

    clock = t('12:40');
    expect(await scheduler.tick()).toBe(0); // settled: left alone
  });

  it('respects the autoResults setting', async () => {
    await request(app).put('/api/settings').send({ autoResults: false }).expect(200);
    clock = t('13:03'); // three minutes after R2
    expect(await scheduler.tick()).toBe(0);
    expect(scheduler.status().autoResults).toBe(false);

    await request(app).put('/api/settings').send({ autoResults: true }).expect(200);
    expect(await scheduler.tick()).toBe(1);
    expect((await waitLatest()).status).toBe('done');
    const pack = store.getPack(id)!;
    expect(pack.results[2]?.placings[0]).toEqual([8]);
    expect(pack.history.filter((h) => h.type === 'results').at(-1)?.summary).toContain('R2 result in - Brunswick Bazaar (8) won');
  });

  it('a server that was off all afternoon catches up on every race in one job', async () => {
    const before = store.getPack(id)!;
    clock = t('17:30'); // every race has jumped; the demo publishes results for R1–R3 only
    expect(await scheduler.tick()).toBe(1);
    const job = await waitLatest();
    expect(job.status).toBe('done');
    expect(job.raceNumber).toBeUndefined(); // several races in one job

    const pack = store.getPack(id)!;
    expect(pack.results[3]?.placings[0]).toEqual([2]);
    const line = pack.history.filter((h) => h.type === 'results').at(-1)!;
    // Every race has jumped, so none is re-rated: each keeps (and is scored on) the picks it jumped with.
    expect(line.summary).toMatch(/^Automatic results check: R3 result in - .+ \(2\) won$/);
    for (const n of [3, 4, 5, 6, 7, 8, 9]) expect(pack.predictions[n]).toEqual(before.predictions[n]);
    // R2's one-source result is accepted once the schedule ran out; R4–R9 are still being watched.
    expect(pack.resultWatch![2]).toMatchObject({ note: 'One source only' });
    expect(pack.resultWatch![2].nextCheckAt).toBeUndefined();
    for (const n of [4, 5, 6, 7, 8, 9]) {
      const w = pack.resultWatch![n];
      expect(w.attempts).toBe(1);
      expect(w.lastCheckedAt).toBe(clock.toISOString());
      expect(w.note).toBe('Nothing published yet');
      expect(w.nextCheckAt).toBeDefined();
      expect(w.gaveUp).toBeUndefined();
    }
    const watching = scheduler.status().watching;
    expect(watching.map((w) => w.raceNumber).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(watching.every((w) => w.meetingId === id && w.venue === 'Flemington' && w.attempts === 1)).toBe(true);
    // Sorted by the next look.
    expect(watching.map((w) => w.nextCheckAt)).toEqual([...watching.map((w) => w.nextCheckAt)].sort());
  });

  it('gives up on a race four hours after the jump with a note telling the owner what to do', async () => {
    clock = t('18:15'); // R4 (14:10) is now 4 h 5 min old
    expect(await scheduler.tick()).toBe(1);
    expect((await waitLatest()).status).toBe('done');
    const pack = store.getPack(id)!;
    const w = pack.resultWatch![4];
    expect(w.gaveUp).toBe(true);
    expect(w.nextCheckAt).toBeUndefined();
    expect(w.note).toBe('No result published after 4 hours - enter it manually or press Fetch results');
    expect(scheduler.status().watching.some((x) => x.raceNumber === 4)).toBe(false);
    expect(scheduler.status().watching.some((x) => x.raceNumber === 9)).toBe(true);
  });

  it('a manual result stops the watcher for that race', async () => {
    const pack = store.getPack(id)!;
    const race = pack.races.find((r) => r.number === 9)!;
    const active = race.runners.filter((r) => !r.scratched).map((r) => r.number);
    const attemptsBefore = pack.resultWatch![9].attempts;
    await request(app)
      .post(`/api/packs/${encodeURIComponent(id)}/results/manual`)
      .send({ raceNumber: 9, placings: [[active[0]], [active[1]], [active[2]]] })
      .expect(200);
    expect(scheduler.status().watching.some((x) => x.raceNumber === 9)).toBe(false);
    clock = t('18:50');
    await scheduler.tick();
    if (resultsJobs()[0].status !== 'done') await waitLatest();
    expect(store.getPack(id)!.results[9].source).toBe('manual');
    expect(store.getPack(id)!.resultWatch![9].attempts).toBe(attemptsBefore); // not polled again
  });
});
