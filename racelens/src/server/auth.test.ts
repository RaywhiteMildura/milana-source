import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from './app.js';
import { MAX_SESSION_MS, SESSION_COOKIE, createAuth, createSessionToken, newSessionId, parseCookies, sessionKey, verifySessionToken } from './auth.js';

const PASSWORD = 'secret-pass';
const DAY = 24 * 3600 * 1000;

/** `racelens_session=<id>.<issuedMs>.<expiresMs>.<sig>` → its parts. */
function tokenParts(pair: string) {
  const [id, issued, expires, sig] = pair.slice(SESSION_COOKIE.length + 1).split('.');
  return { id, issued: Number(issued), expires: Number(expires), sig };
}

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
      const t = tokenParts(cookie);
      expect(t.id).toMatch(/^[A-Za-z0-9_-]{22}$/); // 128 random bits
      expect(t.issued).toBe(clock.ms);
      expect(t.expires).toBe(clock.ms + 30 * DAY);
      expect(t.sig).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url HMAC-SHA256
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
      const { id, issued, expires, sig } = tokenParts(cookie);
      const flipped = sig.endsWith('A') ? sig.slice(0, -1) + 'B' : sig.slice(0, -1) + 'A';
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${id}.${issued}.${expires}.${flipped}`).expect(401);
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${id}.${issued}.${expires + 1}.${sig}`).expect(401);
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${id}.${issued - 1}.${expires}.${sig}`).expect(401);
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${id}.0${issued}.${expires}.${sig}`).expect(401);
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=garbage`).expect(401);
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=`).expect(401);
      const secret = fs.readFileSync(path.join(dataDir, '.secret'), 'utf8').trim();
      // Signed with a different secret, or with this secret but another password.
      const forged = createSessionToken(sessionKey('0'.repeat(64), PASSWORD), { id, issuedMs: issued, expiresMs: expires });
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${forged}`).expect(401);
      const otherPassword = createSessionToken(sessionKey(secret, 'not-the-password'), { id, issuedMs: issued, expiresMs: expires });
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${otherPassword}`).expect(401);
      // The old `<expiresMs>.<sig>` format (signed with the bare secret, not bound to the password) is refused.
      const legacySig = crypto.createHmac('sha256', secret).update(String(expires)).digest('base64url');
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${expires}.${legacySig}`).expect(401);
      // Expired: a token whose expiry is already in the past, correctly signed.
      const key = sessionKey(secret, PASSWORD);
      const stale = createSessionToken(key, { id: newSessionId(), issuedMs: clock.ms - DAY, expiresMs: clock.ms - 1 });
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${stale}`).expect(401);
      // Correctly signed but claiming a lifetime beyond the 90-day maximum.
      const tooLong = createSessionToken(key, { id: newSessionId(), issuedMs: clock.ms - DAY, expiresMs: clock.ms - DAY + MAX_SESSION_MS + 1 });
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${tooLong}`).expect(401);
      // Control: a correctly signed, current token is accepted.
      const good = createSessionToken(key, { id: newSessionId(), issuedMs: clock.ms, expiresMs: clock.ms + DAY });
      await request(app).get('/api/packs').set('Cookie', `${SESSION_COOKIE}=${good}`).expect(200);
    });

    it('renews the cookie once less than half its lifetime is left', async () => {
      const fresh = await request(app).get('/api/packs').set('Cookie', cookie).expect(200);
      expect(sessionCookie(fresh)).toBeUndefined();
      clock.advance(16 * 24 * 3600 * 1000);
      const renewed = await request(app).get('/api/packs').set('Cookie', cookie).expect(200);
      const c = sessionCookie(renewed);
      expect(c).toBeDefined();
      expect(c!.pair).not.toBe(cookie);
      const before = tokenParts(cookie);
      const after = tokenParts(c!.pair);
      expect(after.expires).toBe(clock.ms + 30 * DAY);
      // Same sign-in: the session id and sign-in time carry over, so the 90-day maximum still counts from sign-in.
      expect(after.id).toBe(before.id);
      expect(after.issued).toBe(before.issued);
      // The old cookie eventually expires; the renewed one keeps working.
      clock.advance(15 * 24 * 3600 * 1000);
      await request(app).get('/api/packs').set('Cookie', cookie).expect(401);
      await request(app).get('/api/packs').set('Cookie', c!.pair).expect(200);
      cookie = c!.pair;
    });

    it('logs out by clearing the cookie and revoking the session on the server', async () => {
      // Sign in, then let the cookie renew once so there are two cookies of the same sign-in.
      const login = await request(app).post('/api/login').send({ password: PASSWORD }).expect(200);
      const first = sessionCookie(login)!.pair;
      clock.advance(16 * DAY);
      const renewed = sessionCookie(await request(app).get('/api/packs').set('Cookie', first).expect(200))!.pair;
      // Another device's session is unaffected by this sign-out.
      const other = sessionCookie(await request(app).post('/api/login').send({ password: PASSWORD }).expect(200))!.pair;

      const res = await request(app).post('/api/logout').set('Cookie', renewed).expect(200);
      expect(res.body).toEqual({ ok: true });
      const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      expect(set).toHaveLength(1); // no renewal on the way out, just the clearing cookie
      const c = sessionCookie(res);
      expect(c).toBeDefined();
      expect(c!.pair).toBe(`${SESSION_COOKIE}=`);
      expect(c!.attrs).toContain('Max-Age=0');
      // The browser drops the cookie; a request without it is unauthenticated again.
      await request(app).get('/api/packs').expect(401);
      // A copy of the cookie replayed after sign-out is refused, and so is the older copy from before the renewal.
      await request(app).get('/api/packs').set('Cookie', renewed).expect(401);
      await request(app).get('/api/packs').set('Cookie', first).expect(401);
      expect((await request(app).get('/api/auth').set('Cookie', renewed)).body).toEqual({ required: true, authenticated: false });
      await request(app).get('/api/packs').set('Cookie', other).expect(200);
      // A restart does not resurrect it (the revocation is kept in the data dir).
      const restarted = createApp({ mode: 'demo', dataDir, password: PASSWORD, now: clock.now });
      await request(restarted.app).get('/api/packs').set('Cookie', renewed).expect(401);
      await request(restarted.app).get('/api/packs').set('Cookie', other).expect(200);
      if (process.platform !== 'win32') expect(fs.statSync(path.join(dataDir, '.revoked-sessions.json')).mode & 0o777).toBe(0o600);
      // Logout is public, so it also works when already signed out, and a forged cookie adds nothing to the list.
      await request(app).post('/api/logout').expect(200);
      const before = fs.readFileSync(path.join(dataDir, '.revoked-sessions.json'), 'utf8');
      await request(app).post('/api/logout').set('Cookie', `${SESSION_COOKIE}=${newSessionId()}.1.2.${'x'.repeat(43)}`).expect(200);
      expect(fs.readFileSync(path.join(dataDir, '.revoked-sessions.json'), 'utf8')).toBe(before);
      cookie = other;
    });

    it('changing the password signs every device out', async () => {
      const login = await request(app).post('/api/login').send({ password: PASSWORD }).expect(200);
      const pair = sessionCookie(login)!.pair;
      const changed = createApp({ mode: 'demo', dataDir, password: 'a-completely-new-password', now: clock.now });
      await request(changed.app).get('/api/packs').set('Cookie', pair).expect(401);
      await request(changed.app).get('/api/packs').set('Cookie', cookie).expect(401);
      expect((await request(changed.app).get('/api/auth').set('Cookie', pair)).body).toEqual({ required: true, authenticated: false });
      // Signing in with the new password works; the old password no longer does.
      await request(changed.app).post('/api/login').send({ password: PASSWORD }).expect(401);
      await request(changed.app).post('/api/login').send({ password: 'a-completely-new-password' }).expect(200);
      // Same password again (a plain restart): still signed in.
      const same = createApp({ mode: 'demo', dataDir, password: PASSWORD, now: clock.now });
      await request(same.app).get('/api/packs').set('Cookie', pair).expect(200);
    });

    it('sliding renewal never keeps a session past 90 days from sign-in', async () => {
      const c90 = makeClock();
      const fresh = createApp({ mode: 'demo', dataDir: tmp(), password: PASSWORD, now: c90.now });
      const signedInAt = c90.ms;
      let pair = sessionCookie(await request(fresh.app).post('/api/login').send({ password: PASSWORD }).expect(200))!.pair;
      // Used every fortnight: renewed whenever under half the lifetime is left, but capped at sign-in + 90 days.
      while (c90.ms + 14 * DAY < signedInAt + MAX_SESSION_MS) {
        c90.advance(14 * DAY);
        const res = await request(fresh.app).get('/api/packs').set('Cookie', pair).expect(200);
        const next = sessionCookie(res);
        if (next) {
          const t = tokenParts(next.pair);
          expect(t.issued).toBe(signedInAt);
          expect(t.expires).toBeLessThanOrEqual(signedInAt + MAX_SESSION_MS);
          expect(Number(/Max-Age=(\d+)/.exec(next.attrs)![1]) * 1000).toBeLessThanOrEqual(t.expires - c90.ms);
          pair = next.pair;
        }
      }
      expect(tokenParts(pair).expires).toBe(signedInAt + MAX_SESSION_MS);
      // Close to the cap no new cookie is issued on every request.
      const near = await request(fresh.app).get('/api/packs').set('Cookie', pair).expect(200);
      expect(sessionCookie(near)).toBeUndefined();
      c90.advance(signedInAt + MAX_SESSION_MS - c90.ms - 1);
      await request(fresh.app).get('/api/packs').set('Cookie', pair).expect(200);
      c90.advance(1);
      await request(fresh.app).get('/api/packs').set('Cookie', pair).expect(401);
      // Signing in again starts a new 90-day session.
      await request(fresh.app).post('/api/login').send({ password: PASSWORD }).expect(200);
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

    it('marks the cookie Secure behind an https proxy (no proxy trust needed for that)', async () => {
      const hosted = createApp({ mode: 'demo', dataDir: tmp(), password: PASSWORD, now: clock.now, allowedHosts: ['*'] });
      const res = await request(hosted.app).post('/api/login').set('X-Forwarded-Proto', 'https').send({ password: PASSWORD }).expect(200);
      expect(sessionCookie(res)!.attrs).toContain('Secure');
      const plain = await request(hosted.app).post('/api/login').send({ password: PASSWORD }).expect(200);
      expect(sessionCookie(plain)!.attrs).not.toContain('Secure');
    });
  });

  describe('rate limiting', () => {
    /** Wrong password from a given X-Forwarded-For address; returns the status. */
    const attempt = async (app: Parameters<typeof request>[0], xff: string, password = 'wrong') =>
      (await request(app).post('/api/login').set('X-Forwarded-For', xff).send({ password })).status;

    it('ignores a spoofed X-Forwarded-For unless a platform proxy is trusted, even with RACELENS_ALLOWED_HOSTS=*', async () => {
      const clock = makeClock();
      const { app } = createApp({ mode: 'demo', dataDir: tmp(), password: PASSWORD, now: clock.now, allowedHosts: ['*'] });
      expect(app.get('trust proxy')).toBeFalsy();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        statuses.push(await attempt(app, `10.0.0.${i + 1}`));
        clock.advance(1000);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    });

    it('caps failures from all addresses together, so rotating addresses does not help', async () => {
      const clock = makeClock();
      const { app } = createApp({ mode: 'demo', dataDir: tmp(), password: PASSWORD, now: clock.now, allowedHosts: ['*'], hosting: { trustProxy: true } });
      expect(app.get('trust proxy')).toBe(1);
      const counts: Record<number, number> = {};
      for (let i = 0; i < 300; i++) {
        const status = await attempt(app, `203.0.${Math.floor(i / 250)}.${(i % 250) + 1}`);
        counts[status] = (counts[status] ?? 0) + 1;
        clock.advance(1000);
      }
      // 30 guesses, then a pause; each further guess after a pause pauses it again (~1 a minute).
      expect(counts[401]).toBeGreaterThanOrEqual(30);
      expect(counts[401]).toBeLessThanOrEqual(36);
      expect(counts[429]).toBe(300 - counts[401]);
      // While paused even the owner's right password waits; a minute after the guessing stops it works.
      expect(await attempt(app, '198.51.100.7', PASSWORD)).toBe(429);
      clock.advance(60_000);
      expect(await attempt(app, '198.51.100.7', PASSWORD)).toBe(200);
    });

    it('one address alone can never pause sign-ins for everybody else', async () => {
      const clock = makeClock();
      const { app } = createApp({ mode: 'demo', dataDir: tmp(), password: PASSWORD, now: clock.now, hosting: { trustProxy: true } });
      // A stranger keeps guessing every 5 s for half an hour: only their own address is locked.
      let accepted = 0;
      for (let i = 0; i < 360; i++) {
        if ((await attempt(app, '192.0.2.66')) === 401) accepted++;
        clock.advance(5000);
      }
      expect(accepted).toBeLessThan(60);
      expect(await attempt(app, '192.0.2.66', PASSWORD)).toBe(429);
      expect(await attempt(app, '198.51.100.7', PASSWORD)).toBe(200);
    });

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
      const key = sessionKey('f'.repeat(64), PASSWORD);
      const now = 1_000_000;
      const id = newSessionId();
      const session = { id, issuedMs: now - 5000, expiresMs: now + 1000 };
      const good = createSessionToken(key, session);
      expect(verifySessionToken(key, good, now)).toEqual(session);
      expect(verifySessionToken(key, good, now + 1000)).toBeUndefined(); // expired exactly now
      expect(verifySessionToken(sessionKey('e'.repeat(64), PASSWORD), good, now)).toBeUndefined();
      expect(verifySessionToken(sessionKey('f'.repeat(64), 'other'), good, now)).toBeUndefined();
      expect(verifySessionToken(key, undefined, now)).toBeUndefined();
      expect(verifySessionToken(key, '', now)).toBeUndefined();
      expect(verifySessionToken(key, '.sig', now)).toBeUndefined();
      expect(verifySessionToken(key, '12345.', now)).toBeUndefined();
      expect(verifySessionToken(key, 'abc.def', now)).toBeUndefined();
      expect(verifySessionToken(key, `${id}.${now}.${now + 1000}.${'x'.repeat(43)}`, now)).toBeUndefined();
      expect(verifySessionToken(key, `${id}.${now}.${now + 1000}`, now)).toBeUndefined();
      expect(verifySessionToken(key, good + 'a'.repeat(300), now)).toBeUndefined();
      // Never valid 90 days or more after sign-in, whatever the expiry says.
      const capped = createSessionToken(key, { id, issuedMs: now, expiresMs: now + MAX_SESSION_MS });
      expect(verifySessionToken(key, capped, now + MAX_SESSION_MS - 1)).toBeDefined();
      expect(verifySessionToken(key, capped, now + MAX_SESSION_MS)).toBeUndefined();
      expect(verifySessionToken(key, createSessionToken(key, { id, issuedMs: now, expiresMs: now + MAX_SESSION_MS + 1 }), now)).toBeUndefined();
    });

    it('derives a different signing key for every password and installation', () => {
      const a = sessionKey('f'.repeat(64), 'one');
      expect(a.equals(sessionKey('f'.repeat(64), 'one'))).toBe(true);
      expect(a.equals(sessionKey('f'.repeat(64), 'two'))).toBe(false);
      expect(a.equals(sessionKey('e'.repeat(64), 'one'))).toBe(false);
    });
  });
});
