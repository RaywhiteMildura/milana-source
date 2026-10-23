import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';

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
 *   POST /logout → 200 `{ ok: true }` and clears the cookie.
 *
 * HOW IT WORKS:
 * - The session is a cookie `racelens_session` = `<expiresMs>.<sig>` where
 *   sig = base64url(HMAC-SHA256(secret, String(expiresMs))). The secret is the
 *   per-installation value from Store.getSecret(), so sessions survive restarts.
 *   Verification is a timing-safe compare plus an expiry check; no server-side
 *   session table is needed.
 * - Lifetime defaults to 30 days so a phone stays signed in across race days.
 *   When an authenticated request arrives with less than half the lifetime
 *   left, a fresh cookie is issued (sliding renewal), so a phone that is used
 *   every few weeks never has to log in again.
 * - Cookie attributes: HttpOnly; SameSite=Lax; Path=/; Max-Age; and Secure when
 *   the request came over HTTPS (req.secure, or x-forwarded-proto=https from a
 *   hosting platform's proxy).
 * - Passwords are compared with crypto.timingSafeEqual over SHA-256 digests.
 * - Per-IP rate limit (no dependencies): after 5 failed attempts within 10
 *   minutes, /login answers 429 for 60 seconds. The map is pruned of idle
 *   entries and capped at 1000 IPs.
 */
export interface AuthOptions {
  /** The password to require; empty/undefined disables login. */
  password?: string;
  /** Secret used to sign session cookies (stable across restarts). */
  secret: string;
  now?: () => Date;
  /** Cookie lifetime in seconds (default 30 days – phones should stay logged in). */
  maxAgeSeconds?: number;
}

export interface Auth {
  required: boolean;
  guard: RequestHandler;
  router: Router;
}

export const SESSION_COOKIE = 'racelens_session';
const DEFAULT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const MAX_PASSWORD_LENGTH = 200;

// Rate limiting.
const MAX_FAILED_ATTEMPTS = 5;
const FAILURE_WINDOW_MS = 10 * 60_000;
const LOCKOUT_MS = 60_000;
const MAX_TRACKED_IPS = 1000;

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

function sign(secret: string, expiresMs: number): string {
  return crypto.createHmac('sha256', secret).update(String(expiresMs)).digest('base64url');
}

/** Builds the cookie value `<expiresMs>.<sig>`. */
export function createSessionToken(secret: string, expiresMs: number): string {
  return `${expiresMs}.${sign(secret, expiresMs)}`;
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

/** Returns the token's expiry (ms) when it is genuine and not yet expired, otherwise undefined. */
export function verifySessionToken(secret: string, token: string | undefined, nowMs: number): number | undefined {
  if (!token || token.length > 200) return undefined;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return undefined;
  const expiresStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d{1,16}$/.test(expiresStr)) return undefined;
  const expiresMs = Number(expiresStr);
  if (!Number.isSafeInteger(expiresMs)) return undefined;
  if (!safeEqual(sig, sign(secret, expiresMs))) return undefined;
  if (expiresMs <= nowMs) return undefined;
  return expiresMs;
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
 * Per-IP failed-login tracker. Bounded: idle entries are pruned on every
 * attempt and the map never holds more than MAX_TRACKED_IPS entries (the least
 * recently touched are dropped first, since the Map keeps insertion order and
 * every touch re-inserts).
 */
class LoginRateLimiter {
  private readonly attempts = new Map<string, AttemptRecord>();

  /** Milliseconds until the IP may try again, or 0 when it is not locked. */
  lockedFor(ip: string, nowMs: number): number {
    const rec = this.attempts.get(ip);
    if (!rec?.lockedUntil) return 0;
    return rec.lockedUntil > nowMs ? rec.lockedUntil - nowMs : 0;
  }

  recordFailure(ip: string, nowMs: number): void {
    this.prune(nowMs);
    const rec = this.attempts.get(ip) ?? { failures: [] };
    this.attempts.delete(ip); // re-insert so insertion order == recency
    rec.failures = rec.failures.filter((t) => t > nowMs - FAILURE_WINDOW_MS);
    rec.failures.push(nowMs);
    if (rec.failures.length >= MAX_FAILED_ATTEMPTS) rec.lockedUntil = nowMs + LOCKOUT_MS;
    else rec.lockedUntil = undefined;
    this.attempts.set(ip, rec);
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
    // Hard cap: drop the least recently touched entries first.
    while (this.attempts.size >= MAX_TRACKED_IPS) {
      const oldest = this.attempts.keys().next();
      if (oldest.done) break;
      this.attempts.delete(oldest.value);
    }
  }
}

export function createAuth(opts: AuthOptions): Auth {
  const required = !!(opts.password && opts.password.length > 0);
  const password = opts.password ?? '';
  const secret = opts.secret;
  const maxAgeSeconds = Math.max(60, Math.floor(opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS));
  const maxAgeMs = maxAgeSeconds * 1000;
  const nowMs = () => (opts.now ? opts.now() : new Date()).getTime();
  const limiter = new LoginRateLimiter();

  function issueCookie(req: Request, res: Response): void {
    const token = createSessionToken(secret, nowMs() + maxAgeMs);
    res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieAttributes(req, maxAgeSeconds)}`);
  }

  function clearCookie(req: Request, res: Response): void {
    res.append('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttributes(req, 0)}`);
  }

  function sessionExpiry(req: Request): number | undefined {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    return verifySessionToken(secret, token, nowMs());
  }

  const guard: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    if (!required) {
      res.locals.auth = { required: false, authenticated: true };
      return next();
    }
    const expiresMs = sessionExpiry(req);
    const authenticated = expiresMs !== undefined;
    res.locals.auth = { required: true, authenticated };
    if (authenticated) {
      // Sliding renewal: keep phones signed in as long as they keep using the app.
      if (expiresMs - nowMs() < maxAgeMs / 2) issueCookie(req, res);
      return next();
    }
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const path = req.path.length > 1 && req.path.endsWith('/') ? req.path.slice(0, -1) : req.path;
    if (PUBLIC_ROUTES.has(`${method} ${path}`)) return next();
    res.status(401).json({ error: 'Login required', code: 'auth' });
  };

  const router = Router();

  router.get('/auth', (req, res) => {
    const authenticated = !required || sessionExpiry(req) !== undefined;
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
      limiter.recordFailure(ip, t);
      res.status(401).json({ error: 'Wrong password' });
      return;
    }
    limiter.recordSuccess(ip);
    issueCookie(req, res);
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    clearCookie(req, res);
    res.json({ ok: true });
  });

  return { required, guard, router };
}
