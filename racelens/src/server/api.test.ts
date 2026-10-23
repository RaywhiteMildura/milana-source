import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { JobProgress, MeetingPack, MeetingSummary } from '../shared/types.js';
import { createApp } from './app.js';
import { DEMO_DATE, DEMO_MEETING_ID, DEMO_VENUE_SLUG } from './adapters/demo/index.js';
import { dueResultChecks } from './jobs/research.js';
import { EXCLUSIVE_WAIT_MS } from './jobs/manager.js';

/**
 * End-to-end API test in demo mode: discovery → research job → pack →
 * pre-race recheck → results → manual result. Uses the bundled demo sources,
 * so it runs offline and deterministically.
 */
describe('RaceLens API (demo mode)', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'racelens-api-'));
  // "Now" is early on race morning so no race has started yet.
  const now = () => new Date(`${DEMO_DATE}T00:30:00.000+11:00`);
  const built = createApp({ mode: 'demo', dataDir, now });
  const app = built.app;

  afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  async function waitJob(id: string): Promise<JobProgress> {
    return built.jobs.wait(id, 60_000);
  }

  let meetingId = '';

  it('health reports demo mode', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mode).toBe('demo');
  });

  it('lists sources', async () => {
    const res = await request(app).get('/api/sources').expect(200);
    expect(res.body.sources.length).toBeGreaterThanOrEqual(4);
    expect(res.body.sources.every((s: { enabled: boolean }) => s.enabled)).toBe(true);
  });

  it('discovers the demo meeting on the demo date only', async () => {
    const res = await request(app).get(`/api/meetings?date=${DEMO_DATE}`).expect(200);
    const meetings: MeetingSummary[] = res.body.meetings;
    expect(meetings.length).toBeGreaterThanOrEqual(1);
    const m = meetings.find((x) => x.venueSlug === DEMO_VENUE_SLUG)!;
    expect(m).toBeDefined();
    expect(m.sources.length).toBeGreaterThanOrEqual(2); // several demo sources agree the meeting exists
    expect(res.body.sourceStatuses.length).toBeGreaterThan(0);
    const none = await request(app).get('/api/meetings?date=2026-10-25').expect(200);
    expect(none.body.meetings).toHaveLength(0);
    await request(app).get('/api/meetings?date=nonsense').expect(400);
    await request(app).get('/api/meetings?date=0002-10-24').expect(400);
    await request(app).get('/api/meetings?date=2026-02-30').expect(400);
    expect(res.body.meetings[0].timezone).toBe('Australia/Melbourne');
  });

  it('runs a full research job and produces a pack with predictions', async () => {
    const start = await request(app).post('/api/research').send({ date: DEMO_DATE, venueSlug: DEMO_VENUE_SLUG }).expect(200);
    expect(start.body.jobId).toBeTruthy();
    meetingId = start.body.meetingId;
    const job = await waitJob(start.body.jobId);
    expect(job.status).toBe('done');
    expect(job.percent).toBe(100);
    expect(job.steps.some((s) => s.key === 'reconcile' && s.status === 'done')).toBe(true);
    expect(job.steps.some((s) => s.key === 'predict' && s.status === 'done')).toBe(true);

    const res = await request(app).get(`/api/packs/${encodeURIComponent(meetingId)}`).expect(200);
    const pack: MeetingPack = res.body;
    expect(pack.races.length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(pack.predictions).length).toBe(pack.races.length);
    expect(pack.verificationScore).toBeGreaterThan(0.5);
    expect(pack.sourceStatuses.some((s) => s.ok)).toBe(true);
    expect(pack.weather?.summary).toBeTruthy();
    expect(pack.news.length).toBeGreaterThan(0);
    // Reconciliation found the deliberate disagreements
    const conflicts = pack.races.flatMap((r) => r.runners.flatMap((x) => x.verification.conflicts));
    expect(conflicts.length).toBeGreaterThan(0);
    // Every prediction is well-formed
    for (const race of pack.races) {
      const p = pack.predictions[race.number];
      expect(p.top.length).toBeGreaterThan(0);
      expect(p.top.length).toBeLessThanOrEqual(6);
      expect(p.ranked.every((r) => !race.runners.find((x) => x.id === r.runnerId)?.scratched)).toBe(true);
      expect(p.confidence.overall).toBeGreaterThanOrEqual(0);
      expect(p.betting.notes.join(' ')).toMatch(/Gambling Help/);
      expect(p.summary.length).toBeGreaterThan(20);
    }
    const list = await request(app).get('/api/packs').expect(200);
    expect(list.body[0].id).toBe(meetingId);
    expect(list.body[0].predictedRaces).toBe(pack.races.length);
  });

  it('returns a single race with its prediction', async () => {
    const res = await request(app).get(`/api/packs/${encodeURIComponent(meetingId)}/races/1`).expect(200);
    expect(res.body.race.number).toBe(1);
    expect(res.body.prediction.raceNumber).toBe(1);
    await request(app).get(`/api/packs/${encodeURIComponent(meetingId)}/races/99`).expect(404);
  });

  it('pre-race recheck of one race records history and keeps form', async () => {
    const before: MeetingPack = (await request(app).get(`/api/packs/${encodeURIComponent(meetingId)}`)).body;
    const start = await request(app).post(`/api/packs/${encodeURIComponent(meetingId)}/recheck`).send({ raceNumber: 5 }).expect(200);
    const job = await waitJob(start.body.jobId);
    expect(job.status).toBe('done');
    const after: MeetingPack = (await request(app).get(`/api/packs/${encodeURIComponent(meetingId)}`)).body;
    expect(after.history.some((h) => h.type === 'recheck' && h.raceNumber === 5)).toBe(true);
    const r5before = before.races.find((r) => r.number === 5)!;
    const r5after = after.races.find((r) => r.number === 5)!;
    const formBefore = r5before.runners.reduce((n, r) => n + r.form.length, 0);
    const formAfter = r5after.runners.reduce((n, r) => n + r.form.length, 0);
    expect(formAfter).toBeGreaterThanOrEqual(formBefore);
    expect(after.predictions[5].generatedAt >= before.predictions[5].generatedAt).toBe(true);
    await request(app).post(`/api/packs/${encodeURIComponent(meetingId)}/recheck`).send({ raceNumber: 42 }).expect(400);
  });

  it('collects results once races have run and detects day patterns', async () => {
    // Move the clock to late afternoon so the first three races have been run.
    const late = createApp({ mode: 'demo', dataDir, now: () => new Date(`${DEMO_DATE}T15:30:00.000+11:00`) });
    const start = await request(late.app).post(`/api/packs/${encodeURIComponent(meetingId)}/recheck`).send({}).expect(200);
    const job = await late.jobs.wait(start.body.jobId, 60_000);
    expect(job.status).toBe('done');
    const pack: MeetingPack = (await request(late.app).get(`/api/packs/${encodeURIComponent(meetingId)}`)).body;
    const resulted = Object.keys(pack.results).map(Number);
    expect(resulted.length).toBeGreaterThanOrEqual(3);
    for (const n of resulted) {
      expect(pack.results[n].scorecard).toBeDefined();
      expect(pack.races.find((r) => r.number === n)!.status).toBe('final');
    }
    expect(pack.dayPatterns.length).toBeGreaterThan(0);
    // Later races carry the patterns and have change notes
    const remaining = pack.races.filter((r) => !pack.results[r.number]);
    expect(remaining.length).toBeGreaterThan(0);
    expect(pack.predictions[remaining[0].number].dayPatternsApplied.length).toBeGreaterThan(0);
    expect(pack.history.filter((h) => h.type === 'results').length).toBeGreaterThanOrEqual(3);
  });

  it('accepts a manual result and scores it', async () => {
    const pack: MeetingPack = (await request(app).get(`/api/packs/${encodeURIComponent(meetingId)}`)).body;
    const race = pack.races.find((r) => !pack.results[r.number])!;
    const active = race.runners.filter((r) => !r.scratched).map((r) => r.number);
    const res = await request(app)
      .post(`/api/packs/${encodeURIComponent(meetingId)}/results/manual`)
      .send({ raceNumber: race.number, placings: [[active[0]], [active[1]], [active[2]]] })
      .expect(200);
    const updated: MeetingPack = res.body;
    expect(updated.results[race.number].source).toBe('manual');
    expect(updated.results[race.number].scorecard).toBeDefined();
    await request(app).post(`/api/packs/${encodeURIComponent(meetingId)}/results/manual`).send({ raceNumber: race.number, placings: [[999]] }).expect(400);
    await request(app).post(`/api/packs/${encodeURIComponent(meetingId)}/results/manual`).send({ raceNumber: race.number, placings: [[]] }).expect(400);
    await request(app).post(`/api/packs/${encodeURIComponent(meetingId)}/results/manual`).send({ raceNumber: race.number, placings: [[active[0]], [active[0]]] }).expect(400);
    await request(app).post(`/api/packs/${encodeURIComponent(meetingId)}/results/manual`).send({ raceNumber: 123, placings: [[1]] }).expect(400);
  });

  it('re-running research keeps results and history, and refuses a pre-race check of a finished race', async () => {
    const before: MeetingPack = (await request(app).get(`/api/packs/${encodeURIComponent(meetingId)}`)).body;
    const resulted = Object.keys(before.results).map(Number);
    expect(resulted.length).toBeGreaterThan(0);
    const start = await request(app).post('/api/research').send({ date: DEMO_DATE, venueSlug: DEMO_VENUE_SLUG, force: true }).expect(200);
    expect((await waitJob(start.body.jobId)).status).toBe('done');
    const after: MeetingPack = (await request(app).get(`/api/packs/${encodeURIComponent(meetingId)}`)).body;
    for (const n of resulted) {
      expect(after.results[n]).toBeDefined();
      expect(after.results[n].scorecard).toBeDefined();
      expect(after.predictions[n]).toBeDefined();
    }
    expect(after.history.length).toBeGreaterThanOrEqual(before.history.length);
    const res = await request(app).post(`/api/packs/${encodeURIComponent(meetingId)}/recheck`).send({ raceNumber: resulted[0] }).expect(400);
    expect(res.body.error).toMatch(/already been run/);
  });

  it('a manual result entered while a job is running is not overwritten by that job', async () => {
    const pack: MeetingPack = (await request(app).get(`/api/packs/${encodeURIComponent(meetingId)}`)).body;
    const race = pack.races.find((r) => !pack.results[r.number])!;
    const active = race.runners.filter((r) => !r.scratched).map((r) => r.number);
    const job = await request(app).post(`/api/packs/${encodeURIComponent(meetingId)}/recheck`).send({}).expect(200);
    const manual = await request(app)
      .post(`/api/packs/${encodeURIComponent(meetingId)}/results/manual`)
      .send({ raceNumber: race.number, placings: [[active[1]], [active[0]], [active[2]]] })
      .expect(200);
    expect(manual.body.results[race.number].source).toBe('manual');
    await waitJob(job.body.jobId);
    const after: MeetingPack = (await request(app).get(`/api/packs/${encodeURIComponent(meetingId)}`)).body;
    expect(after.results[race.number]?.source).toBe('manual');
    expect(after.results[race.number].placings[0]).toEqual([active[1]]);
  });

  it('answers malformed JSON and unknown API routes with JSON errors', async () => {
    const bad = await request(app).post('/api/research').set('content-type', 'application/json').send('{"date": ').expect(400);
    expect(bad.headers['content-type']).toMatch(/json/);
    expect(bad.body.error).toMatch(/Bad request/);
    const missing = await request(app).get('/api/nothing-here').expect(404);
    expect(missing.body.error).toBe('not found');
  });

  it('rejects requests addressed to a foreign host (DNS rebinding) but accepts localhost', async () => {
    await request(app).get('/api/health').set('Host', 'evil.example.com').expect(421);
    await request(app).get('/api/health').set('Host', 'localhost:4850').expect(200);
    await request(app).get('/api/health').set('Host', '127.0.0.1:4850').expect(200);
  });

  it('settings round-trip and validate', async () => {
    const res = await request(app).put('/api/settings').send({ bankroll: 1000, unitAmount: 25, riskProfile: 'aggressive', jurisdiction: 'NSW', bogus: 1 }).expect(200);
    expect(res.body).toMatchObject({ bankroll: 1000, unitAmount: 25, riskProfile: 'aggressive', jurisdiction: 'NSW' });
    expect(res.body.bogus).toBeUndefined();
    const bad = await request(app).put('/api/settings').send({ unitAmount: -5, riskProfile: 'yolo' }).expect(200);
    expect(bad.body.unitAmount).toBe(25);
    expect(bad.body.riskProfile).toBe('aggressive');
  });

  it('probe job checks every source', async () => {
    const start = await request(app).post('/api/sources/probe').expect(200);
    const job = await waitJob(start.body.jobId);
    expect(job.status).toBe('done');
    const res = await request(app).get('/api/sources').expect(200);
    expect(res.body.sources.every((s: { lastStatus?: unknown }) => !!s.lastStatus)).toBe(true);
  });

  it('deletes a pack', async () => {
    await request(app).delete(`/api/packs/${encodeURIComponent(meetingId)}`).expect(200);
    await request(app).get(`/api/packs/${encodeURIComponent(meetingId)}`).expect(404);
  });
});

/**
 * Race-day paths from the phone, in demo mode with a movable clock: the
 * catch-up request (only what the watcher would check, run as an automatic
 * check), re-running research after a result was typed in by hand, and quick
 * changes queued behind a long job. Demo race times (Melbourne, +11): R1 12:25,
 * R2 13:00, R3 13:35 …; one results source publishes R1–R3.
 */
describe('RaceLens API on race day (demo mode, moving clock)', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'racelens-raceday-'));
  const t = (hhmm: string) => new Date(`${DEMO_DATE}T${hhmm}:00.000+11:00`);
  let clock = t('00:30');
  const built = createApp({ mode: 'demo', dataDir, now: () => clock });
  const { app, store, jobs } = built;
  const id = DEMO_MEETING_ID;
  const results = `/api/packs/${encodeURIComponent(id)}/results`;
  const manual = `/api/packs/${encodeURIComponent(id)}/results/manual`;

  afterAll(() => {
    built.scheduler.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const resultsJobs = () => jobs.list().filter((j) => j.type === 'results' && j.meetingId === id);

  it('researches the meeting in the morning', async () => {
    const start = await request(app).post('/api/research').send({ date: DEMO_DATE, venueSlug: DEMO_VENUE_SLUG }).expect(200);
    expect((await jobs.wait(start.body.jobId, 60_000)).status).toBe('done');
  });

  it('catch-up only starts a job for races the watcher itself would check now, as an automatic check', async () => {
    clock = t('12:26'); // R1 jumped a minute ago: too early
    expect((await request(app).post(results).send({ catchup: true }).expect(200)).body).toEqual({ jobId: null, due: [] });
    expect(resultsJobs()).toHaveLength(0);

    clock = t('12:28');
    const first = await request(app).post(results).send({ catchup: true }).expect(200);
    expect(first.body.due).toEqual([1]);
    expect((await jobs.wait(first.body.jobId, 60_000)).status).toBe('done');
    let pack = store.getPack(id)!;
    expect(pack.results[1]?.placings[0]).toEqual([6]);
    expect(pack.history.at(-1)?.summary).toMatch(/^Automatic results check: R1 result in - Sugarloaf Sprite \(6\) won; R2, .+ re-rated$/);
    expect(pack.resultWatch?.[1]).toMatchObject({ attempts: 1, nextCheckAt: t('12:29').toISOString() });

    // Opening the page again straight away: the next look is booked for 12:29, so nothing is started.
    expect((await request(app).post(results).send({ catchup: true }).expect(200)).body).toEqual({ jobId: null, due: [] });
    expect(resultsJobs()).toHaveLength(1);

    // Later catch-ups are automatic looks: they collapse in the history and use the watcher's confirmation budget.
    for (const hhmm of ['12:29', '12:31']) {
      clock = t(hhmm);
      const next = await request(app).post(results).send({ catchup: true }).expect(200);
      expect(next.body.due).toEqual([1]);
      expect((await jobs.wait(next.body.jobId, 60_000)).status).toBe('done');
    }
    pack = store.getPack(id)!;
    expect(pack.history.at(-1)?.summary).toBe('Automatic results check R1: still from one source (2 checks so far)');
    expect(pack.resultWatch?.[1].note).toContain('extra check 2 of 3');
  });

  it('without catchup the endpoint is still the Fetch results button, and catchup is validated', async () => {
    const res = await request(app).post(results).send({}).expect(200);
    expect(Object.keys(res.body)).toEqual(['jobId']);
    expect((await jobs.wait(res.body.jobId, 60_000)).status).toBe('done');
    expect(store.getPack(id)!.history.at(-1)?.summary).toMatch(/^Results check /);
    await request(app).post(results).send({ catchup: 'yes' }).expect(400);
  });

  it('re-running research keeps a result typed in by hand and the watcher memory of unchanged races', async () => {
    clock = t('13:03'); // R2 has run
    const c = await request(app).post(results).send({ catchup: true }).expect(200);
    expect(c.body.due).toEqual(expect.arrayContaining([2]));
    await jobs.wait(c.body.jobId, 60_000);
    const before = store.getPack(id)!;
    const fromSource = before.results[2].placings;
    expect(before.results[2].source).toBe('demo-official');
    // The owner corrects R2 by hand (say a protest the feed has not caught up with): first two swapped.
    const typed = [fromSource[1], fromSource[0], fromSource[2]];
    await request(app).post(manual).send({ raceNumber: 2, placings: typed }).expect(200);
    expect(store.getPack(id)!.resultWatch?.[2]).toMatchObject({ note: 'Result entered by hand' });
    expect(store.getPack(id)!.resultWatch?.[2].nextCheckAt).toBeUndefined();
    const watchR1 = store.getPack(id)!.resultWatch?.[1];

    clock = t('13:05');
    const start = await request(app).post('/api/research').send({ date: DEMO_DATE, venueSlug: DEMO_VENUE_SLUG, force: true }).expect(200);
    expect((await jobs.wait(start.body.jobId, 60_000)).status).toBe('done');
    const after = store.getPack(id)!;
    expect(after.results[2]).toMatchObject({ source: 'manual', placings: typed });
    expect(after.races.find((r) => r.number === 2)!.status).toBe('final');
    expect(after.results[1].source).toBe('demo-official');
    expect(after.resultWatch?.[1]).toEqual(watchR1); // same result found again: the watcher's memory holds
    expect(dueResultChecks(after, clock, { autoResults: true })).toEqual([]);
    const research = after.history.findLastIndex((h) => h.type === 'research');
    expect(after.history.slice(research - 3).some((h) => h.raceNumber === 2 && /^R2 result: /.test(h.summary))).toBe(false);
    expect(after.history.at(-1)?.summary).toMatch(/^R2: kept the result entered by hand \(the sources now say /);
  });

  it('a result saved behind a long job says it is queued (not "job wait timed out"), is applied afterwards, and a retry is not a correction', async () => {
    jobs.exclusiveWaitMs = 100;
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const ahead = jobs.start('results', { meetingId: id }, async () => {
        await gate;
      });
      const race = store.getPack(id)!.races.find((r) => r.number === 3)!;
      const active = race.runners.filter((r) => !r.scratched).map((r) => r.number);
      const placings = [[active[0]], [active[1]], [active[2]]];
      // 202, not an error: the change is accepted and queued, with the job to follow.
      const res = await request(app).post(manual).send({ raceNumber: 3, placings }).expect(202);
      expect(res.body.message).toMatch(/your result for Race 3 is queued and will be saved as soon as it finishes/);
      expect(res.body.queued).toBe(true);
      expect(typeof res.body.jobId).toBe('string');
      expect(store.getPack(id)!.results[3]).toBeUndefined();

      release();
      await jobs.wait(ahead.id);
      expect((await jobs.wait(res.body.jobId)).status).toBe('done');
      expect(store.getPack(id)!.results[3]).toMatchObject({ source: 'manual', placings });

      // The owner, unsure, enters it again: same result, so nothing changes and nothing reads "corrected".
      await request(app).post(manual).send({ raceNumber: 3, placings }).expect(200);
      const lines = store.getPack(id)!.history.filter((h) => h.raceNumber === 3 && h.type === 'results');
      expect(lines).toHaveLength(1);
      expect(lines[0].summary).toMatch(/^R3 result: /);

      // Deleting the meeting behind a long job: the same plain answer, and it is deleted once the job ends.
      let release2!: () => void;
      const gate2 = new Promise<void>((r) => (release2 = r));
      const ahead2 = jobs.start('results', { meetingId: id }, async () => {
        await gate2;
      });
      const del = await request(app).delete(`/api/packs/${encodeURIComponent(id)}`).expect(202);
      expect(del.body.message).toMatch(/will be deleted as soon as that job ends/);
      expect(del.body.queued).toBe(true);
      expect(store.getPack(id)).toBeDefined();
      release2();
      await jobs.wait(ahead2.id);
      await jobs.wait(del.body.jobId);
      expect(store.getPack(id)).toBeUndefined();
    } finally {
      jobs.exclusiveWaitMs = EXCLUSIVE_WAIT_MS;
    }
  });
});
