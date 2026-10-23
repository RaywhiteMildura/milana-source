import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from './app.js';
import { SESSION_COOKIE, createAuth, createSessionToken, parseCookies, verifySessionToken } from './auth.js';

const PASSWORD = 'secret-pass';

/** Mutable clock injected into createApp so tests never sleep. */
function makeClock(start = Date.parse('2026-10-24T08:00:00.000+11:00')) {
  let t = start;
  return {
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
    get ms() {
      return t;
    },
  };
}

/** Pulls `racelens_session=...` out of a Set-Cookie header list; '' when the cookie is absent. */
function sessionCookie(res: request.Response): { pair: string; attrs: string } | undefined {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const line = list.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!line) return undefined;
  const [pair, ...rest] = line.split(';').map((s) => s.trim());
  return { pair, attrs: rest.join('; ') };
}

describe('password login', () => {
  const dirs: string[] = [];
  function tmp(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'racelens-auth-'));
    dirs.push(d);
    return d;
  }
  afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  describe('with a password configured', () => {
    const dataDir = tmp();
    const clock = makeClock();
    const { app } = createApp({ mode: 'demo', dataDir, password: PASSWORD, now: clock.now });
    let cookie = '';

    it('health is public but hides private fields', async () => {
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.authRequired).toBe(true);
      expect(res.body).not.toHaveProperty('dataDir');
      expect(res.body).not.toHaveProperty('scheduler');
    });

    it('rejects API calls without a session', async () => {
      const res = await request(app).get('/api/packs').expect(401);
      expect(res.body).toEqual({ error: 'Login required', code: 'auth' });
      await request(app).put('/api/settings').send({ autoResults: false }).expect(401);
    });

    it('reports auth state', async () => {
      const res = await request(app).get('/api/auth').expect(200);
      expect(res.body).toEqual({ required: true, authenticated: false });
    });

    it('rejects a wrong password and malformed bodies', async () => {
      const wrong = await request(app).post('/api/login').send({ password: 'nope' }).expect(401);
      expect(wrong.body).toEqual({ error: 'Wrong password' });
      expect(sessionCookie(wrong)).toBeUndefined();
      await request(app).post('/api/login').send({ password: 123 }).expect(400);
      await request(app).post('/api/login').send({}).expect(400);
      await request(app).post('/api/login').send({ password: 'x'.repeat(201) }).expect(400);
      await request(app).post('/api/login').expect(400);
    });

    it('logs in with the right password and sets a hardened cookie', async () => {
      const res = await request(app).post('/api/login').send({ password: PASSWORD }).expect(200);
      expect(res.body).toEqual({ ok: true });
      const c = sessionCookie(res);
      expect(c).toBeDefined();
      expect(c!.attrs).toContain('HttpOnly');
      expect(c!.attrs).toContain('SameSite=Lax');
      expect(c!.attrs).toContain('Path=/');
      expect(c!.attrs).toMatch(/Max-Age=2592000/); // 30 days
      expect(c!.attrs).not.toContain('Secure'); // plain http on the LAN
      cookie = c!.pair;
      const [expires, sig] = cookie.slice(SESSION_COOKIE.length + 1).split('.');
      expect(Number(expires)).toBe(clock.ms + 30 * 24 * 3600 * 1000);
      expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url HMAC-SHA256
    });

    it('accepts the cookie on protected routes and reveals private health fields', async () => {
      await request(app).get('/api/packs').set('Cookie', cookie).expect(200);
      const health = await request(app).get('/api/health').set('Cookie', cookie).expect(200);
      expect(health.body.dataDir).toBe(dataDir);
      const auth = await request(app).get('/api/auth').set('Cookie', cookie).expect(200);
      expect(auth.body).toEqual({ required: true, authenticated: true });
      // Other cookies around ours do not confuse the parser.
      await request(app).get('/api/packs').set('Cookie', `theme=dark; ${cookie}; other="quoted=value"`).expect(200);
    });

    it('rejects tampered, forged and expired cookies', async () => {
      const [expires, sig] = cookie.slice(SESSION_COOKIE.length + 1).split('.');
      const flipped = sig.endsWith('A') ? sig.slice(0, -1) + 'B' : sig.slice(0, -1) + 'A';
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${expires}.${flipped}`).expect(401);
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${Number(expires) + 1}.${sig}`).expect(401);
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=garbage`).expect(401);
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=`).expect(401);
      // Signed with a different secret.
      const forged = createSessionToken('0'.repeat(64), Number(expires));
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${forged}`).expect(401);
      // Expired: a token whose expiry is already in the past, correctly signed.
      const secret = fs.readFileSync(path.join(dataDir, '.secret'), 'utf8').trim();
      const stale = createSessionToken(secret, clock.ms - 1);
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${stale}`).expect(401);
    });

    it('renews the cookie once less than half its lifetime is left', async () => {
      const fresh = await request(app).get('/api/packs').set('Cookie', cookie).expect(200);
      expect(sessionCookie(fresh)).toBeUndefined();
      clock.advance(16 * 24 * 3600 * 1000);
      const renewed = await request(app).get('/api/packs').set('Cookie', cookie).expect(200);
      const c = sessionCookie(renewed);
      expect(c).toBeDefined();
      expect(c!.pair).not.toBe(cookie);
      const expires = Number(c!.pair.slice(SESSION_COOKIE.length + 1).split('.')[0]);
      expect(expires).toBe(clock.ms + 30 * 24 * 3600 * 1000);
      // The old cookie eventually expires; the renewed one keeps working.
      clock.advance(15 * 24 * 3600 * 1000);
      await request(app).get('/api/packs').set('Cookie', cookie).expect(401);
      await request(app).get('/api/packs').set('Cookie', c!.pair).expect(200);
      cookie = c!.pair;
    });

    it('logs out by clearing the cookie', async () => {
      const res = await request(app).post('/api/logout').set('Cookie', cookie).expect(200);
      expect(res.body).toEqual({ ok: true });
      const c = sessionCookie(res);
      expect(c).toBeDefined();
      expect(c!.pair).toBe(`${SESSION_COOKIE}=`);
      expect(c!.attrs).toContain('Max-Age=0');
      // The browser drops the cookie; a request without it is unauthenticated again.
      await request(app).get('/api/packs').expect(401);
      // Logout is public, so it also works when already signed out.
      await request(app).post('/api/logout').expect(200);
    });

    it('persists the signing secret so a restart keeps phones signed in', async () => {
      const login = await request(app).post('/api/login').send({ password: PASSWORD }).expect(200);
      const pair = sessionCookie(login)!.pair;
      const secretFile = path.join(dataDir, '.secret');
      expect(fs.readFileSync(secretFile, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
      if (process.platform !== 'win32') expect(fs.statSync(secretFile).mode & 0o777).toBe(0o600);
      const second = createApp({ mode: 'demo', dataDir, password: PASSWORD, now: clock.now });
      await request(second.app).get('/api/packs').set('Cookie', pair).expect(200);
      // A different installation (other data dir) does not accept it.
      const other = createApp({ mode: 'demo', dataDir: tmp(), password: PASSWORD, now: clock.now });
      await request(other.app).get('/api/packs').set('Cookie', pair).expect(401);
    });

    it('marks the cookie Secure behind an https proxy', async () => {
      const hosted = createApp({ mode: 'demo', dataDir: tmp(), password: PASSWORD, now: clock.now, allowedHosts: ['*'] });
      const res = await request(hosted.app).post('/api/login').set('X-Forwarded-Proto', 'https').send({ password: PASSWORD }).expect(200);
      expect(sessionCookie(res)!.attrs).toContain('Secure');
      const plain = await request(hosted.app).post('/api/login').send({ password: PASSWORD }).expect(200);
      expect(sessionCookie(plain)!.attrs).not.toContain('Secure');
    });
  });

  describe('rate limiting', () => {
    it('locks an IP for a minute after five failures within ten minutes', async () => {
      const clock = makeClock();
      const { app } = createApp({ mode: 'demo', dataDir: tmp(), password: PASSWORD, now: clock.now });
      for (let i = 0; i < 5; i++) {
        await request(app).post('/api/login').send({ password: `wrong-${i}` }).expect(401);
        clock.advance(1000);
      }
      const locked = await request(app).post('/api/login').send({ password: 'wrong-6' }).expect(429);
      expect(locked.body).toEqual({ error: 'Too many attempts - wait a minute' });
      // Even the right password is refused while locked, and the lock is not extended by retries.
      await request(app).post('/api/login').send({ password: PASSWORD }).expect(429);
      // The fifth failure was 1 s ago; the lock lasts exactly 60 s from then.
      clock.advance(58_999);
      await request(app).post('/api/login').send({ password: PASSWORD }).expect(429);
      clock.advance(1);
      // Lock lifted: the right password gets in and resets the counter.
      const ok = await request(app).post('/api/login').send({ password: PASSWORD }).expect(200);
      expect(sessionCookie(ok)).toBeDefined();
      await request(app).post('/api/login').send({ password: 'wrong-again' }).expect(401);
    });

    it('forgets failures older than ten minutes', async () => {
      const clock = makeClock();
      const { app } = createApp({ mode: 'demo', dataDir: tmp(), password: PASSWORD, now: clock.now });
      for (let i = 0; i < 4; i++) await request(app).post('/api/login').send({ password: 'wrong' }).expect(401);
      clock.advance(10 * 60_000 + 1);
      for (let i = 0; i < 4; i++) await request(app).post('/api/login').send({ password: 'wrong' }).expect(401);
      await request(app).post('/api/login').send({ password: PASSWORD }).expect(200);
    });

    it('does not count malformed bodies as failed attempts', async () => {
      const clock = makeClock();
      const { app } = createApp({ mode: 'demo', dataDir: tmp(), password: PASSWORD, now: clock.now });
      for (let i = 0; i < 10; i++) await request(app).post('/api/login').send({ password: 42 }).expect(400);
      await request(app).post('/api/login').send({ password: PASSWORD }).expect(200);
    });
  });

  describe('without a password', () => {
    const { app } = createApp({ mode: 'demo', dataDir: tmp() });

    it('everything is open and auth reports not required', async () => {
      const auth = await request(app).get('/api/auth').expect(200);
      expect(auth.body).toEqual({ required: false, authenticated: true });
      await request(app).get('/api/packs').expect(200);
      const health = await request(app).get('/api/health').expect(200);
      expect(health.body.authRequired).toBe(false);
      expect(health.body.dataDir).toBeTruthy();
      const login = await request(app).post('/api/login').send({ password: 'anything' }).expect(200);
      expect(login.body).toEqual({ ok: true });
      expect(sessionCookie(login)).toBeUndefined();
      const logout = await request(app).post('/api/logout').expect(200);
      expect(logout.body).toEqual({ ok: true });
    });

    it('an empty RACELENS_PASSWORD means no login', () => {
      expect(createAuth({ password: '', secret: 'x'.repeat(64) }).required).toBe(false);
      expect(createAuth({ secret: 'x'.repeat(64) }).required).toBe(false);
      expect(createAuth({ password: 'p', secret: 'x'.repeat(64) }).required).toBe(true);
    });
  });

  describe('helpers', () => {
    it('parses Cookie headers', () => {
      expect(parseCookies(undefined)).toEqual({});
      expect(parseCookies('a=1; b=two=2;c="q=x" ; bad; a=dup')).toEqual({ a: '1', b: 'two=2', c: 'q=x' });
      expect(parseCookies(['a=1', 'b=2'])).toEqual({ a: '1', b: '2' });
      expect(parseCookies('p=%E2%9C%93; broken=%E2%9')).toEqual({ p: '✓', broken: '%E2%9' });
    });

    it('verifies tokens strictly', () => {
      const secret = 'f'.repeat(64);
      const now = 1_000_000;
      const good = createSessionToken(secret, now + 1000);
      expect(verifySessionToken(secret, good, now)).toBe(now + 1000);
      expect(verifySessionToken(secret, good, now + 1000)).toBeUndefined(); // expired exactly now
      expect(verifySessionToken('e'.repeat(64), good, now)).toBeUndefined();
      expect(verifySessionToken(secret, undefined, now)).toBeUndefined();
      expect(verifySessionToken(secret, '', now)).toBeUndefined();
      expect(verifySessionToken(secret, '.sig', now)).toBeUndefined();
      expect(verifySessionToken(secret, '12345.', now)).toBeUndefined();
      expect(verifySessionToken(secret, 'abc.def', now)).toBeUndefined();
      expect(verifySessionToken(secret, `${now + 1000}.${'x'.repeat(43)}`, now)).toBeUndefined();
      expect(verifySessionToken(secret, good + 'a'.repeat(300), now)).toBeUndefined();
    });
  });
});
