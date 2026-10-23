import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { NOT_SUPPORTED_MESSAGE, REQUEST_STALE_MS, RUNNING_STALE_MS, UPDATE_REQUEST_FILE, UPDATE_STATUS_FILE, updateRouter, type UpdateRouterOptions } from './update.js';

describe('updateRouter (update from the phone)', () => {
  let root: string;
  let updateDir: string;
  let appDir: string;
  let clock: Date;
  const now = () => clock;

  const app = (opts: Partial<UpdateRouterOptions> = {}) => {
    const a = express();
    a.use('/api', updateRouter({ updateDir, appDir, now, ...opts }));
    return a;
  };
  const requestFile = () => path.join(updateDir, UPDATE_REQUEST_FILE);
  const writeStatus = (status: Record<string, unknown>) => fs.writeFileSync(path.join(updateDir, UPDATE_STATUS_FILE), JSON.stringify(status));
  const minutesAgo = (m: number) => new Date(clock.getTime() - m * 60_000).toISOString();

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'racelens-update-'));
    updateDir = path.join(root, 'support');
    appDir = path.join(root, 'app');
    fs.mkdirSync(updateDir);
    fs.mkdirSync(appDir);
    clock = new Date('2026-10-24T01:00:00.000Z');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('is not supported without an update folder (any install but the Mac mini one)', async () => {
    for (const a of [app({ updateDir: undefined }), app({ updateDir: path.join(root, 'missing') })]) {
      const got = await request(a).get('/api/update').expect(200);
      expect(got.body).toEqual({ supported: false, state: 'idle' });
      const post = await request(a).post('/api/update').expect(501);
      expect(post.body).toEqual({ error: NOT_SUPPORTED_MESSAGE });
    }
    expect(fs.readdirSync(updateDir)).toEqual([]);
  });

  it('reports the installed version from VERSION.json, and none when it is missing or broken', async () => {
    let got = await request(app()).get('/api/update').expect(200);
    expect(got.body).toEqual({ supported: true, state: 'idle' });
    fs.writeFileSync(path.join(appDir, 'VERSION.json'), '{ not json');
    got = await request(app()).get('/api/update').expect(200);
    expect(got.body.version).toBeUndefined();
    const version = { commit: '67368c139865b5c84f05bdfc82a8cab55e64710f', branch: 'claude/horse-racing-predictor-ts4iet', installedAt: '2026-10-23T22:00:00.000Z' };
    fs.writeFileSync(path.join(appDir, 'VERSION.json'), JSON.stringify({ ...version, repo: 'RaywhiteMildura/milana-source', extra: 1 }, null, 2));
    got = await request(app()).get('/api/update').expect(200);
    expect(got.body).toEqual({ supported: true, version, state: 'idle' });
    // Shown even where updating is not possible.
    got = await request(app({ updateDir: undefined })).get('/api/update').expect(200);
    expect(got.body).toEqual({ supported: false, version, state: 'idle' });
  });

  it('POST writes the request file (atomically) and then reports it as requested; a second POST is refused', async () => {
    const a = app();
    const post = await request(a).post('/api/update').expect(202);
    expect(post.body.requested).toBe(true);
    expect(post.body.message).toMatch(/few minutes/);
    expect(fs.readdirSync(updateDir)).toEqual([UPDATE_REQUEST_FILE]); // no temp file left behind
    expect(JSON.parse(fs.readFileSync(requestFile(), 'utf8'))).toEqual({ requestedAt: clock.toISOString() });
    const got = await request(a).get('/api/update').expect(200);
    expect(got.body.state).toBe('requested');
    const again = await request(a).post('/api/update').expect(409);
    expect(again.body.error).toMatch(/already been requested/);
  });

  it('follows the status file the updater writes: running, done, failed', async () => {
    const a = app();
    writeStatus({ state: 'running', startedAt: minutesAgo(2), message: 'Downloading…', from: 'aaa' });
    let got = await request(a).get('/api/update').expect(200);
    expect(got.body).toEqual({ supported: true, state: 'running', last: { startedAt: minutesAgo(2), message: 'Downloading…', from: 'aaa' } });
    const busy = await request(a).post('/api/update').expect(409);
    expect(busy.body.error).toMatch(/already updating/);
    expect(fs.existsSync(requestFile())).toBe(false);

    const done = { state: 'done', startedAt: minutesAgo(5), finishedAt: minutesAgo(1), ok: true, message: 'RaceLens is up to date.', from: 'aaa', to: 'bbb' };
    writeStatus(done);
    got = await request(a).get('/api/update').expect(200);
    const { state, ...last } = done;
    expect(got.body).toEqual({ supported: true, state, last });
    await request(a).post('/api/update').expect(202);

    fs.rmSync(requestFile());
    writeStatus({ ...done, state: 'failed', ok: false, message: 'Went back to the version you had.' });
    got = await request(a).get('/api/update').expect(200);
    expect(got.body.state).toBe('failed');
    expect(got.body.last).toMatchObject({ ok: false, message: 'Went back to the version you had.' });
    await request(a).post('/api/update').expect(202);
  });

  it('keeps the previous result visible while a new request waits', async () => {
    writeStatus({ state: 'done', startedAt: minutesAgo(60), finishedAt: minutesAgo(55), ok: true, message: 'Up to date.' });
    fs.writeFileSync(requestFile(), JSON.stringify({ requestedAt: minutesAgo(0) }));
    const got = await request(app()).get('/api/update').expect(200);
    expect(got.body.state).toBe('requested');
    expect(got.body.last.message).toBe('Up to date.');
  });

  it('a stale "running" (the Mac restarted mid-update) does not block for ever', async () => {
    const a = app();
    writeStatus({ state: 'running', startedAt: new Date(clock.getTime() - RUNNING_STALE_MS - 60_000).toISOString(), from: 'aaa' });
    const got = await request(a).get('/api/update').expect(200);
    expect(got.body.state).toBe('failed');
    expect(got.body.last).toMatchObject({ ok: false, from: 'aaa' });
    expect(got.body.last.message).toMatch(/did not finish/);
    await request(a).post('/api/update').expect(202);
    expect(fs.existsSync(requestFile())).toBe(true);
  });

  it('a request nobody picked up is reported, and can be made again', async () => {
    const a = app();
    fs.writeFileSync(requestFile(), JSON.stringify({ requestedAt: new Date(clock.getTime() - REQUEST_STALE_MS - 60_000).toISOString() }));
    const got = await request(a).get('/api/update').expect(200);
    expect(got.body.state).toBe('failed');
    expect(got.body.last.message).toMatch(/did not start the update/);
    await request(a).post('/api/update').expect(202);
    expect(JSON.parse(fs.readFileSync(requestFile(), 'utf8')).requestedAt).toBe(clock.toISOString());
    expect((await request(a).get('/api/update').expect(200)).body.state).toBe('requested');
  });

  it('ignores a broken or unknown status file', async () => {
    for (const content of ['{"state":"runn', JSON.stringify({ state: 'exploded' }), '[]']) {
      fs.writeFileSync(path.join(updateDir, UPDATE_STATUS_FILE), content);
      const got = await request(app()).get('/api/update').expect(200);
      expect(got.body).toEqual({ supported: true, state: 'idle' });
    }
  });

  it('a request file without a readable time falls back to its modification time', async () => {
    fs.writeFileSync(requestFile(), 'please');
    clock = new Date(); // the file's mtime is real time
    expect((await request(app()).get('/api/update').expect(200)).body.state).toBe('requested');
  });

  it('answers 500 (not a crash) when the request cannot be written', async () => {
    fs.mkdirSync(requestFile()); // a folder in the way: the rename fails
    fs.writeFileSync(path.join(requestFile(), 'x'), '');
    const a = app();
    // The folder counts as a pending request only by existing; make it look stale so POST tries to write.
    fs.utimesSync(requestFile(), new Date(0), new Date(0));
    clock = new Date();
    const post = await request(a).post('/api/update').expect(500);
    expect(post.body.error).toMatch(/Could not ask the Mac mini to update/);
    expect(fs.readdirSync(updateDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
