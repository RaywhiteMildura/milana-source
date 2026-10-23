import crypto from 'node:crypto';
import fs from 'node:fs';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { Logger } from './adapters/types.js';

/**
 * Optional password login for RaceLens.
 *
 * CONTRACT (used by app.ts and the web app):
 * - `required` is true when a password is configured (RACELENS_PASSWORD).
 * - `guard` runs on every /api request. It always sets
 *   `res.locals.auth = { required, authenticated }`. It lets these paths through
 *   regardless of login: GET /health, GET /auth, POST /login, POST /logout
 *   (HEAD is treated as GET, as Express itself does for routing).
 *   Everything else answers 401 `{ error: 'Login required', code: 'auth' }`
 *   when a password is required and no valid session cookie is present.
 * - `router` serves GET /auth → `{ required, authenticated }`,
 *   POST /login `{ password }` → 200 `{ ok: true }` or 401 `{ error }` (429 when rate limited,
 *   400 when the body is not `{ password: string }` of at most 200 characters),
 *   POST /logout → 200 `{ ok: true }`, clears the cookie and revokes that session server-side.
 *
 * HOW IT WORKS:
 * - The session is a cookie `racelens_session` = `<id>.<issuedMs>.<expiresMs>.<sig>`
 *   where id is random per sign-in (kept across renewals), issuedMs is the sign-in
 *   time and sig = base64url(HMAC-SHA256(key, "<id>.<issuedMs>.<expiresMs>")).
 *   key = HMAC-SHA256(secret, password): the secret is the per-installation value
 *   from Store.getSecret(), so sessions survive restarts, and binding the key to
 *   the configured password means changing RACELENS_PASSWORD signs every device
 *   out (so does deleting data/.secret). Verification is a timing-safe compare
 *   plus expiry checks; no session table is needed.
 * - Lifetime defaults to 30 days so a phone stays signed in across race days.
 *   When an authenticated request arrives with less than half the lifetime
 *   left, a fresh cookie is issued (sliding renewal), but never past
 *   MAX_SESSION_MS (90 days) after sign-in: a copied cookie cannot be kept alive
 *   for ever, and the phone signs in again about once a quarter.
 * - Sign out revokes the session id (every cookie of that sign-in, renewed or
 *   not) until the 90-day maximum. Revocations live in a small JSON file in the
 *   data dir, so a restart does not bring them back. Only a request holding a
 *   valid session can add one, so the list stays tiny (capped at 1000 anyway).
 * - Cookie attributes: HttpOnly; SameSite=Lax; Path=/; Max-Age; and Secure when
 *   the request came over HTTPS (req.secure, or x-forwarded-proto=https from a
 *   hosting platform's proxy).
 * - Passwords are compared with crypto.timingSafeEqual over SHA-256 digests.
 * - Rate limit (no dependencies), see LoginRateLimiter: per address, 5 failed
 *   attempts within 10 minutes lock /login (429) for 60 seconds; on top of that
 *   a global budget of 30 failures within 10 minutes from all addresses pauses
 *   every sign-in for 60 seconds, so rotating addresses does not help an attacker.
 */
export interface AuthOptions {
  /** The password to require; empty/undefined disables login. */
  password?: string;
  /** Secret used to sign session cookies (stable across restarts). */
  secret: string;
  now?: () => Date;
  /** Cookie lifetime in seconds (default 30 days – phones should stay logged in); capped at the 90-day session maximum. */
  maxAgeSeconds?: number;
  /** JSON file that keeps signed-out sessions revoked across restarts (default: in memory only). */
  revocationFile?: string;
  /** Where lockouts and persistence problems are reported (default: silent). */
  log?: Logger;
}

export interface Auth {
  required: boolean;
  guard: RequestHandler;
  router: Router;
}

export const SESSION_COOKIE = 'racelens_session';
const DEFAULT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
/** Absolute session lifetime from sign-in; sliding renewal never goes past it. */
export const MAX_SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_PASSWORD_LENGTH = 200;
const MAX_REVOKED_SESSIONS = 1000;

// Rate limiting.
const MAX_FAILED_ATTEMPTS = 5;
const FAILURE_WINDOW_MS = 10 * 60_000;
const LOCKOUT_MS = 60_000;
const MAX_TRACKED_IPS = 1000;
/** Failures from all addresses within FAILURE_WINDOW_MS that pause every sign-in (see LoginRateLimiter). */
const GLOBAL_MAX_FAILURES = 30;
const GLOBAL_LOCKOUT_MS = 60_000;

/** Public endpoints, keyed as `${METHOD} ${path}`; HEAD is folded into GET before lookup. */
const PUBLIC_ROUTES: ReadonlySet<string> = new Set(['GET /health', 'GET /auth', 'POST /login', 'POST /logout']);

interface AttemptRecord {
  /** Timestamps (ms) of failed attempts inside the failure window. */
  failures: number[];
  /** When set and in the future, every login attempt answers 429. */
  lockedUntil?: number;
}

/** Minimal Cookie header parser – enough for `a=b; c=d` (values may contain '='). */
export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = Array.isArray(header) ? header.join('; ') : header;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue; // first occurrence wins, like browsers send the most specific first
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/** A signed-in device: `id` is random per sign-in and kept by renewals; times are epoch ms. */
export interface Session {
  id: string;
  issuedMs: number;
  expiresMs: number;
}

/**
 * The cookie signing key: bound to the installation secret AND the configured
 * password, so a new RACELENS_PASSWORD (or a new data/.secret) invalidates every
 * cookie issued before.
 */
export function sessionKey(secret: string, password: string): Buffer {
  return crypto.createHmac('sha256', secret).update('racelens-session-v2\0').update(password, 'utf8').digest();
}

export function newSessionId(): string {
  return crypto.randomBytes(16).toString('base64url');
}

function sign(key: string | Buffer, payload: string): string {
  return crypto.createHmac('sha256', key).update(payload).digest('base64url');
}

/** Builds the cookie value `<id>.<issuedMs>.<expiresMs>.<sig>`. */
export function createSessionToken(key: string | Buffer, session: Session): string {
  const payload = `${session.id}.${session.issuedMs}.${session.expiresMs}`;
  return `${payload}.${sign(key, payload)}`;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    // Still do a comparison so the timing does not reveal the length mismatch.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Returns the session when the token is genuine, not expired and within the
 * 90-day maximum from sign-in; otherwise undefined. (Revocation is checked by
 * createAuth, which owns the revocation list.)
 */
export function verifySessionToken(key: string | Buffer, token: string | undefined, nowMs: number): Session | undefined {
  if (!token || token.length > 200) return undefined;
  const parts = token.split('.');
  if (parts.length !== 4) return undefined;
  const [id, issuedStr, expiresStr, sig] = parts;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id) || !/^\d{1,16}$/.test(issuedStr) || !/^\d{1,16}$/.test(expiresStr) || !sig) return undefined;
  const issuedMs = Number(issuedStr);
  const expiresMs = Number(expiresStr);
  if (!Number.isSafeInteger(issuedMs) || !Number.isSafeInteger(expiresMs)) return undefined;
  // The signature covers the exact text, so "0123" and "123" are different tokens.
  if (!safeEqual(sig, sign(key, `${id}.${issuedStr}.${expiresStr}`))) return undefined;
  if (expiresMs <= nowMs) return undefined;
  if (expiresMs > issuedMs + MAX_SESSION_MS || nowMs >= issuedMs + MAX_SESSION_MS) return undefined;
  return { id, issuedMs, expiresMs };
}

function passwordMatches(given: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(given, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function isSecureRequest(req: Request): boolean {
  if (req.secure) return true;
  const forwarded = req.headers['x-forwarded-proto'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim().toLowerCase();
  return first === 'https';
}

function cookieAttributes(req: Request, maxAgeSeconds: number): string {
  const attrs = [`Path=/`, `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax'];
  if (isSecureRequest(req)) attrs.push('Secure');
  return attrs.join('; ');
}

function clientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Failed-login tracker.
 *
 * Per address: 5 failures within 10 minutes lock that address for 60 s (and each
 * further failure while the 10-minute window still holds 5 re-locks it), so one
 * address gets at most ~14 guesses per 10 minutes. The map is bounded: idle
 * entries are pruned on every failure and it never holds more than
 * MAX_TRACKED_IPS entries; unlocked entries are dropped first (least recently
 * touched first, since the Map keeps insertion order and every touch
 * re-inserts), so churn from many addresses cannot erase a lock.
 *
 * Global budget: per-address limits alone do nothing against an attacker who
 * rotates addresses (a proxy pool, an IPv6 /64), so failures from ALL addresses
 * are counted too: GLOBAL_MAX_FAILURES (30) within 10 minutes pause every sign-in
 * for GLOBAL_LOCKOUT_MS (60 s), and each further failure while the window is
 * over budget pauses it again. That caps the whole internet at roughly 40
 * guesses per 10 minutes.
 *
 * Trade-off (deliberate): a distributed attacker can keep NEW sign-ins paused
 * for as long as they keep failing - that is inherent in any global budget. It
 * is kept short and narrow so a stranger cannot lock the owner out for long:
 * one address alone (~14 per window) can never reach the global budget, so a
 * single person on the office Wi-Fi only ever locks themselves; the pause is a
 * minute and lifts on its own once the guessing stops (a restart clears it);
 * 429s are not counted, so retrying never extends it; and it only affects
 * POST /login - phones already signed in keep working throughout.
 */
class LoginRateLimiter {
  private readonly attempts = new Map<string, AttemptRecord>();
  private globalFailures: number[] = [];
  private globalLockedUntil = 0;

  /** Milliseconds until the IP may try again (its own lock or the global pause), or 0 when it may try now. */
  lockedFor(ip: string, nowMs: number): number {
    const rec = this.attempts.get(ip);
    const own = rec?.lockedUntil && rec.lockedUntil > nowMs ? rec.lockedUntil - nowMs : 0;
    const all = this.globalLockedUntil > nowMs ? this.globalLockedUntil - nowMs : 0;
    return Math.max(own, all);
  }

  /** Records a wrong password; returns which lock it engaged ('ip', 'global'), if any, for logging. */
  recordFailure(ip: string, nowMs: number): { ip: boolean; global: boolean } {
    this.prune(nowMs);
    const rec = this.attempts.get(ip) ?? { failures: [] };
    this.attempts.delete(ip); // re-insert so insertion order == recency
    rec.failures = rec.failures.filter((t) => t > nowMs - FAILURE_WINDOW_MS);
    rec.failures.push(nowMs);
    if (rec.failures.length >= MAX_FAILED_ATTEMPTS) rec.lockedUntil = nowMs + LOCKOUT_MS;
    else rec.lockedUntil = undefined;
    this.attempts.set(ip, rec);

    // Only failures that got past the locks are recorded, so this array stays around GLOBAL_MAX_FAILURES + 10.
    this.globalFailures = this.globalFailures.filter((t) => t > nowMs - FAILURE_WINDOW_MS);
    this.globalFailures.push(nowMs);
    const global = this.globalFailures.length >= GLOBAL_MAX_FAILURES;
    if (global) this.globalLockedUntil = nowMs + GLOBAL_LOCKOUT_MS;
    return { ip: rec.lockedUntil !== undefined, global };
  }

  recordSuccess(ip: string): void {
    this.attempts.delete(ip);
  }

  size(): number {
    return this.attempts.size;
  }

  private prune(nowMs: number): void {
    for (const [ip, rec] of this.attempts) {
      const lastFailure = rec.failures[rec.failures.length - 1] ?? 0;
      const idle = lastFailure <= nowMs - FAILURE_WINDOW_MS;
      const unlocked = !rec.lockedUntil || rec.lockedUntil <= nowMs;
      if (idle && unlocked) this.attempts.delete(ip);
    }
    // Hard cap: drop the least recently touched unlocked entries first, then (only if everything is locked) the oldest.
    for (const [ip, rec] of this.attempts) {
      if (this.attempts.size < MAX_TRACKED_IPS) break;
      if (!rec.lockedUntil || rec.lockedUntil <= nowMs) this.attempts.delete(ip);
    }
    while (this.attempts.size >= MAX_TRACKED_IPS) {
      const oldest = this.attempts.keys().next();
      if (oldest.done) break;
      this.attempts.delete(oldest.value);
    }
  }
}

/**
 * Signed-out sessions, by a hash of the session id, each kept until the latest
 * moment any cookie of that sign-in could still be valid (sign-in + 90 days).
 * Persisted to `file` (written atomically, mode 0600) so a restart does not
 * resurrect them. Bounded: expired entries are dropped on every change, and past
 * MAX_REVOKED_SESSIONS the ones closest to expiry go first.
 */
class RevokedSessions {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly file: string | undefined,
    private readonly log: Logger | undefined,
    nowMs: number,
  ) {
    if (!file) return;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { revoked?: Record<string, unknown> };
      for (const [k, v] of Object.entries(data?.revoked ?? {})) {
        if (typeof v === 'number' && v > nowMs && /^[A-Za-z0-9_-]{43}$/.test(k)) this.entries.set(k, v);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') log?.warn(`Could not read the signed-out sessions list (${file}); starting with an empty one`);
    }
  }

  private static hash(id: string): string {
    return crypto.createHash('sha256').update(id).digest('base64url');
  }

  has(id: string, nowMs: number): boolean {
    const until = this.entries.get(RevokedSessions.hash(id));
    return until !== undefined && until > nowMs;
  }

  add(id: string, untilMs: number, nowMs: number): void {
    for (const [k, v] of this.entries) if (v <= nowMs) this.entries.delete(k);
    this.entries.set(RevokedSessions.hash(id), untilMs);
    if (this.entries.size > MAX_REVOKED_SESSIONS) {
      const soonest = [...this.entries].sort((a, b) => a[1] - b[1]).slice(0, this.entries.size - MAX_REVOKED_SESSIONS);
      for (const [k] of soonest) this.entries.delete(k);
    }
    this.save();
  }

  private save(): void {
    if (!this.file) return;
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, revoked: Object.fromEntries(this.entries) }), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log?.warn(`Could not save the signed-out sessions list (${this.file}): ${err instanceof Error ? err.message : String(err)}`);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

export function createAuth(opts: AuthOptions): Auth {
  const required = !!(opts.password && opts.password.length > 0);
  const password = opts.password ?? '';
  const key = sessionKey(opts.secret, password);
  const maxAgeSeconds = Math.min(Math.max(60, Math.floor(opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS)), MAX_SESSION_MS / 1000);
  const maxAgeMs = maxAgeSeconds * 1000;
  const nowMs = () => (opts.now ? opts.now() : new Date()).getTime();
  const limiter = new LoginRateLimiter();
  const revoked = new RevokedSessions(required ? opts.revocationFile : undefined, opts.log, nowMs());

  function issueCookie(req: Request, res: Response, session: Session): void {
    const token = createSessionToken(key, session);
    const seconds = Math.max(1, Math.floor((session.expiresMs - nowMs()) / 1000));
    res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieAttributes(req, seconds)}`);
  }

  function clearCookie(req: Request, res: Response): void {
    res.append('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttributes(req, 0)}`);
  }

  function currentSession(req: Request): Session | undefined {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const t = nowMs();
    const session = verifySessionToken(key, token, t);
    return session && !revoked.has(session.id, t) ? session : undefined;
  }

  const guard: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    if (!required) {
      res.locals.auth = { required: false, authenticated: true };
      return next();
    }
    const session = currentSession(req);
    res.locals.auth = { required: true, authenticated: !!session };
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const path = req.path.length > 1 && req.path.endsWith('/') ? req.path.slice(0, -1) : req.path;
    const route = `${method} ${path}`;
    if (session) {
      // Sliding renewal keeps phones signed in while they are used, but never past 90 days from sign-in
      // (and not on the way out: /logout clears the cookie).
      const t = nowMs();
      if (route !== 'POST /logout' && session.expiresMs - t < maxAgeMs / 2) {
        const expiresMs = Math.min(t + maxAgeMs, session.issuedMs + MAX_SESSION_MS);
        if (expiresMs > session.expiresMs) issueCookie(req, res, { ...session, expiresMs });
      }
      return next();
    }
    if (PUBLIC_ROUTES.has(route)) return next();
    res.status(401).json({ error: 'Login required', code: 'auth' });
  };

  const router = Router();

  router.get('/auth', (req, res) => {
    const authenticated = !required || currentSession(req) !== undefined;
    res.json({ required, authenticated });
  });

  router.post('/login', (req, res) => {
    if (!required) {
      res.json({ ok: true });
      return;
    }
    const ip = clientIp(req);
    const t = nowMs();
    if (limiter.lockedFor(ip, t) > 0) {
      res.status(429).json({ error: 'Too many attempts - wait a minute' });
      return;
    }
    const body: unknown = req.body;
    const given = body && typeof body === 'object' ? (body as { password?: unknown }).password : undefined;
    if (typeof given !== 'string' || given.length > MAX_PASSWORD_LENGTH) {
      res.status(400).json({ error: `Body must be { password: string } of at most ${MAX_PASSWORD_LENGTH} characters` });
      return;
    }
    if (!passwordMatches(given, password)) {
      const locked = limiter.recordFailure(ip, t);
      if (locked.global) opts.log?.warn(`Login: ${GLOBAL_MAX_FAILURES}+ wrong passwords in 10 minutes from several addresses (latest ${ip}); all sign-ins paused for a minute`);
      else if (locked.ip) opts.log?.warn(`Login: repeated wrong passwords from ${ip}; that address is locked for a minute`);
      res.status(401).json({ error: 'Wrong password' });
      return;
    }
    limiter.recordSuccess(ip);
    issueCookie(req, res, { id: newSessionId(), issuedMs: t, expiresMs: t + maxAgeMs });
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    // Revoke the session itself (every cookie of this sign-in), not just the browser's copy.
    const session = required ? currentSession(req) : undefined;
    if (session) revoked.add(session.id, session.issuedMs + MAX_SESSION_MS, nowMs());
    clearCookie(req, res);
    res.json({ ok: true });
  });

  return { required, guard, router };
}
