import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp, hostGuard, openHostedRefusal } from './app.js';
import { SESSION_COOKIE } from './auth.js';
import { NetworkSnapshot, hostingFromEnv, listenUrls } from './net.js';

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'racelens-hosting-'));
  dirs.push(d);
  return d;
}
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
afterEach(() => vi.unstubAllEnvs());

/** Clears every variable that decides hosting, so the developer's own shell cannot leak into a test. */
function cleanEnv() {
  for (const k of ['RACELENS_ALLOWED_HOSTS', 'RACELENS_TRUST_PROXY', 'RACELENS_PUBLIC_URL', 'RACELENS_ALLOW_OPEN', 'RACELENS_PASSWORD', 'FLY_APP_NAME', 'RENDER', 'RENDER_EXTERNAL_URL']) vi.stubEnv(k, '');
}

const iface = (address: string, family: 'IPv4' | 'IPv6' = 'IPv4', internal = false): os.NetworkInterfaceInfo =>
  ({ address, family, internal, netmask: family === 'IPv4' ? '255.255.255.0' : 'ffff:ffff:ffff:ffff::', mac: '00:00:00:00:00:00', cidr: null, ...(family === 'IPv6' ? { scopeid: 0 } : {}) }) as os.NetworkInterfaceInfo;

describe('hostingFromEnv', () => {
  it('is LAN mode with nothing set', () => {
    expect(hostingFromEnv({})).toEqual({ hosted: false, publicUrl: undefined, trustProxy: false });
  });

  it("treats '*' as hosted but never infers proxy trust from it", () => {
    expect(hostingFromEnv({ RACELENS_ALLOWED_HOSTS: 'office-pc, *' })).toEqual({ hosted: true, publicUrl: undefined, trustProxy: false });
    expect(hostingFromEnv({ RACELENS_ALLOWED_HOSTS: 'office-pc.tail1234.ts.net' }).hosted).toBe(false);
    // An explicit allowedHosts list replaces the variable.
    expect(hostingFromEnv({ RACELENS_ALLOWED_HOSTS: '*' }, ['office-pc']).hosted).toBe(false);
    expect(hostingFromEnv({}, ['*']).hosted).toBe(true);
  });

  it('recognises Fly.io and Render, trusts their proxy and knows their public address', () => {
    expect(hostingFromEnv({ FLY_APP_NAME: 'racelens-owner' })).toEqual({ hosted: true, publicUrl: 'https://racelens-owner.fly.dev', trustProxy: true });
    expect(hostingFromEnv({ RENDER: 'true', RENDER_EXTERNAL_URL: 'https://racelens.onrender.com/' })).toEqual({ hosted: true, publicUrl: 'https://racelens.onrender.com', trustProxy: true });
    expect(hostingFromEnv({ RENDER: 'true' }).publicUrl).toBeUndefined();
  });

  it('prefers RACELENS_PUBLIC_URL and ignores anything that is not an http(s) URL', () => {
    expect(hostingFromEnv({ FLY_APP_NAME: 'racelens-owner', RACELENS_PUBLIC_URL: 'https://races.example.com/' }).publicUrl).toBe('https://races.example.com');
    expect(hostingFromEnv({ FLY_APP_NAME: 'racelens-owner', RACELENS_PUBLIC_URL: 'javascript:alert(1)' }).publicUrl).toBe('https://racelens-owner.fly.dev');
    expect(hostingFromEnv({ RACELENS_PUBLIC_URL: 'not a url' }).publicUrl).toBeUndefined();
    expect(hostingFromEnv({ RACELENS_PUBLIC_URL: 'http://office-pc.tail1234.ts.net:4850' })).toEqual({ hosted: false, publicUrl: 'http://office-pc.tail1234.ts.net:4850', trustProxy: false });
  });

  it('trusts a proxy only when told to (RACELENS_TRUST_PROXY=1) outside Fly/Render', () => {
    expect(hostingFromEnv({ RACELENS_TRUST_PROXY: '1' })).toEqual({ hosted: false, publicUrl: undefined, trustProxy: true });
    expect(hostingFromEnv({ RACELENS_TRUST_PROXY: '0', RACELENS_ALLOWED_HOSTS: '*' }).trustProxy).toBe(false);
  });
});

describe('open hosted server', () => {
  it('refuses to start hosted without a password unless RACELENS_ALLOW_OPEN=1', () => {
    expect(openHostedRefusal({ hosted: true }, false, {})).toMatch(/RACELENS_PASSWORD is not set.*Refusing to start.*RACELENS_ALLOW_OPEN=1/s);
    expect(openHostedRefusal({ hosted: true }, false, { RACELENS_ALLOW_OPEN: '1' })).toBeUndefined();
    expect(openHostedRefusal({ hosted: true }, true, {})).toBeUndefined();
    // LAN mode without a password keeps working (it only warns).
    expect(openHostedRefusal({ hosted: false }, false, {})).toBeUndefined();
  });

  it('the server process exits with the message instead of listening', () => {
    const tsx = path.resolve('node_modules/.bin/tsx');
    const env = { ...process.env, RACELENS_ALLOWED_HOSTS: '*', RACELENS_PASSWORD: '', RACELENS_ALLOW_OPEN: '', FLY_APP_NAME: '', RENDER: '', RACELENS_MODE: 'demo', RACELENS_PORT: '0', RACELENS_DATA_DIR: tmp() };
    const run = spawnSync(tsx, ['src/server/index.ts'], { env, encoding: 'utf8', timeout: 30_000 });
    expect(run.status).toBe(1);
    expect(run.stderr + run.stdout).toMatch(/Refusing to start/);
    expect(run.stdout).not.toMatch(/RaceLens listening/);
  }, 40_000);
});

describe('proxy trust', () => {
  it("is off for RACELENS_ALLOWED_HOSTS=* alone and on for Fly.io, Render or RACELENS_TRUST_PROXY=1", () => {
    cleanEnv();
    vi.stubEnv('RACELENS_ALLOWED_HOSTS', '*');
    expect(createApp({ mode: 'demo', dataDir: tmp(), password: 'pw' }).app.get('trust proxy')).toBeFalsy();
    vi.stubEnv('FLY_APP_NAME', 'racelens-owner');
    expect(createApp({ mode: 'demo', dataDir: tmp(), password: 'pw' }).app.get('trust proxy')).toBe(1);
    cleanEnv();
    vi.stubEnv('RENDER', 'true');
    expect(createApp({ mode: 'demo', dataDir: tmp(), password: 'pw' }).app.get('trust proxy')).toBe(1);
    cleanEnv();
    vi.stubEnv('RACELENS_TRUST_PROXY', '1');
    expect(createApp({ mode: 'demo', dataDir: tmp(), password: 'pw' }).app.get('trust proxy')).toBe(1);
  });
});

describe('GET /api/health addresses', () => {
  const LAN = ['http://192.168.1.23:4850'];

  async function signedInHealth(app: express.Express) {
    const login = await request(app).post('/api/login').send({ password: 'pw' }).expect(200);
    const set = ([] as string[]).concat(login.headers['set-cookie'] ?? []);
    const cookie = set.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0];
    return (await request(app).get('/api/health').set('Cookie', cookie).expect(200)).body as { urls: string[]; publicUrl?: string };
  }

  it('reports the LAN addresses (and no public URL) on a computer at home or in the office', async () => {
    cleanEnv();
    const { app } = createApp({ mode: 'demo', dataDir: tmp(), password: 'pw', urls: () => LAN });
    const health = await signedInHealth(app);
    expect(health.urls).toEqual(LAN);
    expect(health).not.toHaveProperty('publicUrl');
  });

  it('reports no container addresses, only the public URL, when hosted on Fly.io', async () => {
    cleanEnv();
    vi.stubEnv('FLY_APP_NAME', 'racelens-owner');
    vi.stubEnv('RACELENS_ALLOWED_HOSTS', '*');
    const { app } = createApp({ mode: 'demo', dataDir: tmp(), password: 'pw', urls: () => ['http://172.19.4.10:4850'] });
    const health = await signedInHealth(app);
    expect(health.urls).toEqual([]);
    expect(health.publicUrl).toBe('https://racelens-owner.fly.dev');
  });

  it("reports no addresses for a plain docker run with '*' and uses RACELENS_PUBLIC_URL when given", async () => {
    cleanEnv();
    vi.stubEnv('RACELENS_PUBLIC_URL', 'https://races.example.com');
    const { app } = createApp({ mode: 'demo', dataDir: tmp(), password: 'pw', allowedHosts: ['*'], urls: () => ['http://172.17.0.2:4850'] });
    const health = await signedInHealth(app);
    expect(health.urls).toEqual([]);
    expect(health.publicUrl).toBe('https://races.example.com');
  });

  it('keeps the public part of health unchanged for signed-out callers', async () => {
    cleanEnv();
    vi.stubEnv('FLY_APP_NAME', 'racelens-owner');
    const { app } = createApp({ mode: 'demo', dataDir: tmp(), password: 'pw' });
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).not.toHaveProperty('urls');
    expect(res.body).not.toHaveProperty('publicUrl');
  });
});

describe('host guard and phone addresses follow network changes', () => {
  function fakeNetwork() {
    let t = 0;
    let reads = 0;
    let table: NodeJS.Dict<os.NetworkInterfaceInfo[]> = { lo: [iface('127.0.0.1', 'IPv4', true)] };
    const snapshot = new NetworkSnapshot(
      () => {
        reads++;
        return table;
      },
      () => t,
    );
    return {
      snapshot,
      advance: (ms: number) => (t += ms),
      set: (next: typeof table) => (table = next),
      get reads() {
        return reads;
      },
    };
  }

  function guarded(net: ReturnType<typeof fakeNetwork>, extra: string[] = []) {
    const app = express();
    app.use(hostGuard(extra, net.snapshot));
    app.get('/', (_req, res) => res.send('ok'));
    return app;
  }

  it('accepts an address this computer gets after start-up (Tailscale, Wi-Fi, a new DHCP lease)', async () => {
    const net = fakeNetwork();
    const app = guarded(net);
    await request(app).get('/').set('Host', 'localhost:4850').expect(200);
    await request(app).get('/').set('Host', '100.101.102.103:4850').expect(421);
    // Tailscale comes up after RaceLens.
    net.set({ lo: [iface('127.0.0.1', 'IPv4', true)], utun3: [iface('100.101.102.103'), iface('fd7a:115c:a1e0::1', 'IPv6')] });
    net.advance(5000);
    await request(app).get('/').set('Host', '100.101.102.103:4850').expect(200);
    await request(app).get('/').set('Host', '[fd7a:115c:a1e0::1]:4850').expect(200);
    // Still refuses foreign names (DNS rebinding).
    await request(app).get('/').set('Host', 'evil.example.com').expect(421);
  });

  it('re-reads the interfaces at most every 5 s on a miss, so hostile requests cannot force a scan each', async () => {
    const net = fakeNetwork();
    const app = guarded(net);
    for (let i = 0; i < 50; i++) await request(app).get('/').set('Host', `rebind-${i}.evil.example`).expect(421);
    expect(net.reads).toBe(1);
    net.advance(5000);
    await request(app).get('/').set('Host', 'evil.example').expect(421);
    expect(net.reads).toBe(2);
    // Known hosts never trigger a re-read.
    for (let i = 0; i < 10; i++) await request(app).get('/').set('Host', 'localhost').expect(200);
    expect(net.reads).toBe(2);
  });

  it('refreshes its own addresses every 30 s even without a miss, dropping ones that went away', async () => {
    const net = fakeNetwork();
    net.set({ en0: [iface('192.168.1.23')] });
    const app = guarded(net);
    await request(app).get('/').set('Host', '192.168.1.23:4850').expect(200);
    net.set({ en0: [iface('192.168.1.99')] }); // new lease
    net.advance(30_000);
    await request(app).get('/').set('Host', '192.168.1.99:4850').expect(200);
    expect(net.reads).toBe(2);
    await request(app).get('/').set('Host', '192.168.1.23:4850').expect(421);
  });

  it("still lets '*' and RACELENS_ALLOWED_HOSTS names through without looking at the interfaces", async () => {
    const net = fakeNetwork();
    await request(guarded(net, ['Office-PC.tail1234.ts.net '])).get('/').set('Host', 'office-pc.tail1234.ts.net:4850').expect(200);
    await request(guarded(net, [' *'])).get('/').set('Host', 'anything.example').expect(200);
    expect(net.reads).toBe(0);
  });

  it('lists phone URLs from the current interfaces, keeping a Tailscale address on a utun interface', () => {
    const table: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      lo0: [iface('127.0.0.1', 'IPv4', true)],
      en0: [iface('192.168.1.23'), iface('fe80::1', 'IPv6')],
      en1: [iface('169.254.10.10')],
      utun3: [iface('100.101.102.103')],
      utun4: [iface('10.8.0.2')],
      docker0: [iface('172.17.0.1')],
    };
    expect(listenUrls('0.0.0.0', 4850, table)).toEqual(['http://192.168.1.23:4850', 'http://100.101.102.103:4850']);
    expect(listenUrls('192.168.1.23', 4850, table)).toEqual(['http://192.168.1.23:4850']);
  });
});

describe('web app folder', () => {
  it('serves only a built web app, never the unbuilt Vite source page (blank when run from src)', () => {
    cleanEnv();
    const src = tmp();
    fs.writeFileSync(path.join(src, 'index.html'), '<script type="module" src="/main.tsx"></script>');
    fs.writeFileSync(path.join(src, 'main.tsx'), '');
    expect(createApp({ mode: 'demo', dataDir: tmp(), webDir: src }).webDir).not.toBe(src);
    const built = tmp();
    fs.writeFileSync(path.join(built, 'index.html'), '<script type="module" src="/assets/index.js"></script>');
    expect(createApp({ mode: 'demo', dataDir: tmp(), webDir: built }).webDir).toBe(built);
    // Never the source folder, whichever way the server is started.
    expect(createApp({ mode: 'demo', dataDir: tmp() }).webDir).not.toBe(path.resolve('src/web'));
  });
});
