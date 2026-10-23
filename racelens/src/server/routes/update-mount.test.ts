import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

// The phone's Update button goes through the real app: behind the login, and "not supported" off the Mac mini.
describe('update route mounted in the app', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-upd-'));
    dirs.push(d);
    return d;
  };
  const saved = process.env.RACELENS_UPDATE_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.RACELENS_UPDATE_DIR;
    else process.env.RACELENS_UPDATE_DIR = saved;
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('needs the login when a password is set', async () => {
    const { app } = createApp({ mode: 'demo', dataDir: tmp(), password: 'secret-pass' });
    await request(app).get('/api/update').expect(401);
    await request(app).post('/api/update').expect(401);
  });

  it('says updates are not supported off the Mac mini, and requests one when the updater folder exists', async () => {
    delete process.env.RACELENS_UPDATE_DIR;
    const { app } = createApp({ mode: 'demo', dataDir: tmp(), password: '' });
    const off = await request(app).get('/api/update').expect(200);
    expect(off.body.supported).toBe(false);
    await request(app).post('/api/update').expect(501);

    const support = tmp();
    process.env.RACELENS_UPDATE_DIR = support;
    const { app: mac } = createApp({ mode: 'demo', dataDir: tmp(), password: '' });
    expect((await request(mac).get('/api/update').expect(200)).body.supported).toBe(true);
    await request(mac).post('/api/update').expect(202);
    expect(fs.existsSync(path.join(support, 'update-request'))).toBe(true);
    await request(mac).post('/api/update').expect(409);
  });
});
