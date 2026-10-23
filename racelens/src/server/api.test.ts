import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { JobProgress, MeetingPack, MeetingSummary } from '../shared/types.js';
import { createApp } from './app.js';
import { DEMO_DATE, DEMO_VENUE_SLUG } from './adapters/demo/index.js';

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
