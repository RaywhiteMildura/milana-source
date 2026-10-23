import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import request from 'supertest';
import type { MeetingPack } from '../shared/types.js';
import { compression, createApp, crossSiteGuard, pickEncoding, plainErrorHandler } from './app.js';
import { SESSION_COOKIE } from './auth.js';
import { logger } from './core/logger.js';

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'racelens-http-'));
  dirs.push(d);
  return d;
}
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
afterEach(() => vi.unstubAllEnvs());

/** Clears every variable that decides hosting, so the developer's own shell cannot leak into a test. */
function cleanEnv() {
  for (const k of ['RACELENS_ALLOWED_HOSTS', 'RACELENS_TRUST_PROXY', 'RACELENS_PUBLIC_URL', 'RACELENS_ALLOW_OPEN', 'RACELENS_PASSWORD', 'FLY_APP_NAME', 'RENDER', 'RENDER_EXTERNAL_URL']) vi.stubEnv(k, '');
}

/** A built-looking web app: index.html over 1 KB, a big script, a stylesheet and a PNG. */
function webApp(): string {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.mkdirSync(path.join(dir, 'icons'));
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><title>RaceLens</title><script type="module" src="/assets/index-abc123.js"></script>${'<!-- shell -->'.repeat(100)}`);
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), `export const app = ${JSON.stringify(Array.from({ length: 4000 }, (_, i) => `component-${i}`))};\n`);
  fs.writeFileSync(path.join(dir, 'icons', 'icon-192.png'), Buffer.alloc(4096, 7));
  return dir;
}

/** A meeting pack-sized JSON answer (the real ones are ~1.2 MB): saved straight into the store. */
function bigPack(app: ReturnType<typeof createApp>): string {
  const runners = Array.from({ length: 3000 }, (_, i) => ({ number: (i % 16) + 1, name: `Runner ${i}`, jockey: `J ${i % 40}`, form: '1x23-4561', odds: { win: 2 + (i % 30), place: 1.2 } }));
  app.store.savePack({ id: 'test-big', runners } as unknown as MeetingPack);
  return '/api/packs/test-big';
}

/** A request over a real socket, so the body arrives exactly as sent (supertest would decompress it). */
async function raw(app: express.Express, pathname: string, headers: Record<string, string> = {}, method = 'GET') {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      http
        .request({ host: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
          res.on('error', reject);
        })
        .on('error', reject)
        .end();
    });
  } finally {
    server.close();
  }
}

describe('compressed answers', () => {
  cleanEnv();
  const built = createApp({ mode: 'demo', dataDir: tmp(), webDir: webApp() });
  const url = bigPack(built);

  it('gzips a large API answer for a client that accepts gzip, and it unzips to the same JSON', async () => {
    const plain = await raw(built.app, url);
    expect(plain.status).toBe(200);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(Number(plain.headers['content-length'])).toBe(plain.body.length);
    expect(plain.headers.vary).toMatch(/Accept-Encoding/i);

    const gz = await raw(built.app, url, { 'Accept-Encoding': 'gzip, deflate' });
    expect(gz.status).toBe(200);
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gz.headers.vary).toMatch(/Accept-Encoding/i);
    expect(gz.headers['content-type']).toMatch(/application\/json/);
    expect(Number(gz.headers['content-length'])).toBe(gz.body.length); // the compressed length, not the original one
    expect(gz.body.length).toBeLessThan(plain.body.length / 5);
    expect(JSON.parse(zlib.gunzipSync(gz.body).toString('utf8'))).toEqual(JSON.parse(plain.body.toString('utf8')));
  });

  it('prefers brotli when the client takes it (phones over https do), and honours q=0', async () => {
    const plain = await raw(built.app, url);
    const br = await raw(built.app, url, { 'Accept-Encoding': 'gzip, deflate, br, zstd' });
    expect(br.headers['content-encoding']).toBe('br');
    expect(zlib.brotliDecompressSync(br.body).equals(plain.body)).toBe(true);
    expect((await raw(built.app, url, { 'Accept-Encoding': 'br;q=0, gzip' })).headers['content-encoding']).toBe('gzip');
    expect((await raw(built.app, url, { 'Accept-Encoding': 'identity' })).headers['content-encoding']).toBeUndefined();
    expect((await raw(built.app, url, { 'Accept-Encoding': 'gzip;q=0' })).headers['content-encoding']).toBeUndefined();
  });

  it('leaves tiny answers, HEAD and 304 alone', async () => {
    const auth = await raw(built.app, '/api/auth', { 'Accept-Encoding': 'gzip, br' });
    expect(auth.status).toBe(200);
    expect(auth.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(auth.body.toString('utf8'))).toEqual({ required: false, authenticated: true });

    const plain = await raw(built.app, url);
    const head = await raw(built.app, url, { 'Accept-Encoding': 'gzip' }, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers['content-encoding']).toBeUndefined();
    expect(head.headers['content-length']).toBe(plain.headers['content-length']);
    expect(head.body.length).toBe(0);

    const etag = String(plain.headers.etag);
    const notModified = await raw(built.app, url, { 'Accept-Encoding': 'gzip', 'If-None-Match': etag });
    expect(notModified.status).toBe(304);
    expect(notModified.headers['content-encoding']).toBeUndefined();
    expect(notModified.body.length).toBe(0);
  });

  it('compresses the web app shell and its script, but not images or byte ranges', async () => {
    const js = await raw(built.app, '/assets/index-abc123.js', { 'Accept-Encoding': 'gzip' });
    expect(js.status).toBe(200);
    expect(js.headers['content-encoding']).toBe('gzip');
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.headers['cache-control']).toMatch(/max-age=3600/);
    expect(zlib.gunzipSync(js.body).toString('utf8')).toBe(fs.readFileSync(path.join(built.webDir!, 'assets', 'index-abc123.js'), 'utf8'));

    const shell = await raw(built.app, '/', { 'Accept-Encoding': 'br', Accept: 'text/html' });
    expect(shell.headers['content-encoding']).toBe('br');
    expect(shell.headers['cache-control']).toBe('no-cache');
    expect(zlib.brotliDecompressSync(shell.body).toString('utf8')).toContain('/assets/index-abc123.js');

    const png = await raw(built.app, '/icons/icon-192.png', { 'Accept-Encoding': 'gzip' });
    expect(png.status).toBe(200);
    expect(png.headers['content-encoding']).toBeUndefined();
    expect(png.body.length).toBe(4096);

    const range = await raw(built.app, '/assets/index-abc123.js', { 'Accept-Encoding': 'gzip', Range: 'bytes=0-99' });
    expect(range.status).toBe(206);
    expect(range.headers['content-encoding']).toBeUndefined();
    expect(range.body.length).toBe(100);
  });

  it('works through supertest and fetch-style clients that decompress by themselves', async () => {
    const res = await request(built.app).get(url).set('Accept-Encoding', 'gzip').expect(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.body.runners).toHaveLength(3000);
  });

  it('passes through a body whose headers were already sent and anything marked no-transform', async () => {
    const app = express();
    app.use(compression());
    app.get('/stream', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('x'.repeat(5000));
      res.end('y'.repeat(5000));
    });
    app.get('/no-transform', (_req, res) => res.set('Cache-Control', 'no-transform').type('text').send('z'.repeat(5000)));
    const stream = await raw(app, '/stream', { 'Accept-Encoding': 'gzip' });
    expect(stream.headers['content-encoding']).toBeUndefined();
    expect(stream.body.toString()).toBe('x'.repeat(5000) + 'y'.repeat(5000));
    const keep = await raw(app, '/no-transform', { 'Accept-Encoding': 'gzip' });
    expect(keep.headers['content-encoding']).toBeUndefined();
    expect(keep.body.length).toBe(5000);
  });

  it('reads Accept-Encoding the way browsers and proxies write it', () => {
    expect(pickEncoding(undefined)).toBeUndefined();
    expect(pickEncoding('')).toBeUndefined();
    expect(pickEncoding('gzip, deflate')).toBe('gzip');
    expect(pickEncoding('gzip, deflate, br')).toBe('br');
    expect(pickEncoding('br;q=0.5, gzip;q=1.0')).toBe('gzip');
    expect(pickEncoding('BR')).toBe('br');
    expect(pickEncoding('*')).toBe('gzip');
    expect(pickEncoding('gzip;q=0, *')).toBeUndefined();
    expect(pickEncoding('deflate, identity')).toBeUndefined();
    expect(pickEncoding(['gzip', 'br'])).toBe('br');
  });
});

describe('the app shell is only for pages, never for missing files', () => {
  cleanEnv();
  const { app } = createApp({ mode: 'demo', dataDir: tmp(), webDir: webApp() });

  it('serves index.html to page loads', async () => {
    const res = await request(app).get('/').set('Accept', 'text/html,application/xhtml+xml,*/*;q=0.8').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('/assets/index-abc123.js');
    await request(app).get('/meeting/flemington').set('Accept', 'text/html').expect(200);
    await request(app).get('/').expect(200); // no Accept header at all (curl)
  });

  it('answers 404, not index.html, for a missing script, any missing file or a request that does not want HTML', async () => {
    for (const p of ['/assets/index-OLDBUILD.js', '/assets/index-OLDBUILD.css', '/assets/nothing', '/icons/missing.png', '/favicon.ico', '/robots.txt']) {
      const res = await request(app).get(p).set('Accept', '*/*');
      expect(res.status, p).toBe(404);
      expect(res.headers['content-type'], p).toMatch(/text\/plain/);
      expect(res.text, p).not.toContain('<script');
    }
    await request(app).get('/meeting/flemington').set('Accept', 'application/json').expect(404);
    await request(app).post('/meeting/flemington').set('Accept', 'text/html').expect(404);
    // Real files still load.
    await request(app).get('/assets/index-abc123.js').expect(200).expect('Content-Type', /javascript/);
  });
});

describe('cross-site requests', () => {
  const MAC = 'mac-mini.tail1234.ts.net';

  /** The Mac mini behind Tailscale Serve, exactly as scripts/mac/install.sh configures it. */
  function macMini() {
    cleanEnv();
    vi.stubEnv('RACELENS_TRUST_PROXY', '1');
    vi.stubEnv('RACELENS_ALLOWED_HOSTS', MAC);
    vi.stubEnv('RACELENS_PUBLIC_URL', `https://${MAC}`);
    return createApp({ mode: 'demo', dataDir: tmp(), password: 'race-day-pw' });
  }

  const sessionFrom = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0];

  it('lets the phone through Tailscale Serve sign in and change settings (Host = the ts.net name)', async () => {
    const { app } = macMini();
    const phone = { Origin: `https://${MAC}`, Host: MAC, 'X-Forwarded-Host': MAC, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '100.101.1.2', 'Sec-Fetch-Site': 'same-origin' };
    const login = await request(app).post('/api/login').set(phone).send({ password: 'race-day-pw' }).expect(200);
    const cookie = sessionFrom(login);
    await request(app).put('/api/settings').set(phone).set('Cookie', cookie).send({ autoResults: true }).expect(200);
    await request(app).post('/api/logout').set(phone).set('Cookie', cookie).expect(200);
  });

  it('also when the proxy hands over Host 127.0.0.1:<port>, with or without X-Forwarded-Host', async () => {
    const { app } = macMini();
    const viaLoopback = { Origin: `https://${MAC}`, Host: '127.0.0.1:4850', 'X-Forwarded-Host': MAC, 'X-Forwarded-Proto': 'https', 'Sec-Fetch-Site': 'same-origin' };
    const cookie = sessionFrom(await request(app).post('/api/login').set(viaLoopback).send({ password: 'race-day-pw' }).expect(200));
    await request(app).put('/api/settings').set(viaLoopback).set('Cookie', cookie).send({ autoResults: true }).expect(200);
    // The ts.net name is a RACELENS_ALLOWED_HOSTS name and the RACELENS_PUBLIC_URL host, so it is ours either way.
    await request(app).post('/api/logout').set({ Origin: `https://${MAC}`, Host: '127.0.0.1:4850' }).expect(200);
  });

  it('refuses another site, a null origin and anything the browser calls cross-site, before it reaches the API', async () => {
    const { app } = macMini();
    for (const origin of ['https://evil.example', 'null', `https://${MAC}.evil.example`, `http://evil-${MAC}`, 'file://']) {
      const res = await request(app).post('/api/login').set({ Origin: origin, Host: MAC, 'X-Forwarded-Host': MAC }).send({ password: 'race-day-pw' });
      expect(res.status, origin).toBe(403);
      expect(res.body.code, origin).toBe('cross-site');
      expect(res.headers['set-cookie'], origin).toBeUndefined();
    }
    await request(app).post('/api/login').set({ Host: MAC, 'Sec-Fetch-Site': 'cross-site' }).send({ password: 'race-day-pw' }).expect(403);
  });

  it('protects an open LAN server (npm run start:phone with no password) from a page on another site', async () => {
    cleanEnv();
    const { app } = createApp({ mode: 'demo', dataDir: tmp() });
    // The reviewer's request: a no-cors POST from https://evil.example.
    const evil = await request(app).post('/api/sources/probe').set({ Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'text/plain' }).send('{}');
    expect(evil.status).toBe(403);
    expect(evil.body.jobId).toBeUndefined();
    await request(app).put('/api/settings').set('Origin', 'https://evil.example').send({ autoResults: false }).expect(403);
    await request(app).delete('/api/packs/anything').set('Origin', 'https://evil.example').expect(403);
    // Without trust in a proxy, X-Forwarded-Host proves nothing.
    await request(app).put('/api/settings').set({ Origin: 'https://evil.example', Host: '127.0.0.1:4850', 'X-Forwarded-Host': 'evil.example' }).send({}).expect(403);
    // Reading is not affected (the browser does not let the other site see the answer anyway).
    await request(app).get('/api/settings').set('Origin', 'https://evil.example').expect(200);
  });

  it('keeps the app itself, the dev server proxy, curl and scripts working', async () => {
    cleanEnv();
    const { app } = createApp({ mode: 'demo', dataDir: tmp() });
    await request(app).put('/api/settings').set({ Origin: 'http://localhost:4851', Host: 'localhost:4851', 'Sec-Fetch-Site': 'same-origin' }).send({ autoResults: true }).expect(200);
    await request(app).put('/api/settings').set({ Origin: 'http://127.0.0.1:4850', Host: '127.0.0.1:4850' }).send({ autoResults: true }).expect(200);
    await request(app).put('/api/settings').set({ Origin: 'http://[::1]:4850', Host: '[::1]:4850' }).send({ autoResults: true }).expect(200);
    // npm run dev: Vite on :5173 proxies /api to :4850 with changeOrigin, so only the port differs.
    await request(app).put('/api/settings').set({ Origin: 'http://localhost:5173', Host: 'localhost:4850', 'Sec-Fetch-Site': 'same-origin' }).send({ autoResults: true }).expect(200);
    // No Origin: curl, the Mac's status script, server-to-server.
    await request(app).put('/api/settings').send({ autoResults: true }).expect(200);
  });

  it('accepts a LAN address origin that matches the Host the phone used', async () => {
    const app = express();
    app.use(crossSiteGuard({}));
    app.post('/x', (_req, res) => res.send('ok'));
    await request(app).post('/x').set({ Origin: 'http://192.168.1.23:4850', Host: '192.168.1.23:4850' }).expect(200);
    await request(app).post('/x').set({ Origin: 'http://192.168.1.99:4850', Host: '192.168.1.23:4850' }).expect(403);
    await request(app).options('/x').set({ Origin: 'https://evil.example' }).expect((res) => expect(res.status).not.toBe(403));
  });
});

describe('security headers', () => {
  it('are on every answer: API, app shell, files, refusals and errors', async () => {
    cleanEnv();
    const { app } = createApp({ mode: 'demo', dataDir: tmp(), webDir: webApp() });
    const answers = [
      await request(app).get('/api/health'),
      await request(app).get('/'),
      await request(app).get('/assets/index-abc123.js'),
      await request(app).get('/assets/missing.js'),
      await request(app).get('/').set('Host', 'evil.example'), // 421 from the host guard
      await request(app).post('/api/settings').set('Origin', 'https://evil.example'), // 403
      await request(app).post('/').set('Content-Type', 'application/json').send('{"bad": '), // 400
    ];
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200, 404, 421, 403, 400]);
    for (const res of answers) {
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('same-origin');
    }
  });
});

describe('error answers', () => {
  it('never show a stack trace or the folders on this computer, whatever NODE_ENV is', async () => {
    cleanEnv();
    const webDir = webApp();
    const { app } = createApp({ mode: 'demo', dataDir: tmp(), webDir });
    expect(app.get('env')).not.toBe('production'); // the default error page would print the stack here
    const bad = await request(app).post('/').set('Content-Type', 'application/json').send('{"bad": ').expect(400);
    expect(bad.text).toBe('Bad Request');
    const encoded = await request(app).post('/').set({ 'Content-Type': 'application/json', 'Content-Encoding': 'bogus' }).send('{}');
    expect(encoded.status).toBe(415);
    expect(encoded.text).toBe('Unsupported Media Type');
    // The shell vanishing mid-rebuild.
    fs.rmSync(path.join(webDir, 'index.html'));
    const gone = await request(app).get('/').set('Accept', 'text/html').expect(404);
    for (const res of [bad, encoded, gone]) {
      expect(res.text).not.toMatch(/ at |node_modules|\/home\/|\/Users\/|<pre>/);
      expect(res.text).not.toContain(webDir);
    }
    // The API keeps its JSON errors.
    const api = await request(app).post('/api/research').set('Content-Type', 'application/json').send('{"date": ').expect(400);
    expect(api.body.error).toMatch(/^Bad request/);
  });

  it('logs a server fault and answers "Something went wrong" (JSON under /api)', async () => {
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const app = express();
    app.get('/page', () => {
      throw new Error('EACCES: permission denied, open /Users/owner/RaceLens/app/dist/web/index.html');
    });
    app.get('/api/thing', () => {
      throw new Error('boom at /Users/owner/RaceLens');
    });
    app.use(plainErrorHandler);
    const page = await request(app).get('/page').expect(500);
    expect(page.text).toBe('Something went wrong');
    const api = await request(app).get('/api/thing').expect(500);
    expect(api.body).toEqual({ error: 'Something went wrong' });
    expect(logged).toHaveBeenCalledTimes(2);
    expect(String(logged.mock.calls[0][0])).toContain('EACCES'); // the details stay in the server log
    logged.mockRestore();
  });
});
