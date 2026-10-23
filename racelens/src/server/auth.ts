import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';

/**
 * Optional password login for RaceLens.
 *
 * CONTRACT (used by app.ts and the web app):
 * - `required` is true when a password is configured (RACELENS_PASSWORD).
 * - `guard` runs on every /api request. It always sets
 *   `res.locals.auth = { required, authenticated }`. It lets these paths through
 *   regardless of login: GET /health, GET /auth, POST /login, POST /logout.
 *   Everything else answers 401 `{ error: 'Login required', code: 'auth' }`
 *   when a password is required and no valid session cookie is present.
 * - `router` serves GET /auth → `{ required, authenticated }`,
 *   POST /login `{ password }` → 200 `{ ok: true }` or 401 `{ error }` (429 when rate limited),
 *   POST /logout → 200 `{ ok: true }` and clears the cookie.
 *
 * This file is a stub that implements "no password configured"; the real
 * implementation (HMAC-signed session cookie, timing-safe compare, per-IP
 * rate limiting) replaces it.
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

export function createAuth(opts: AuthOptions): Auth {
  const required = !!(opts.password && opts.password.length > 0);
  const guard = (_req: Request, res: Response, next: NextFunction) => {
    res.locals.auth = { required, authenticated: !required };
    if (!required) return next();
    res.status(401).json({ error: 'Login required', code: 'auth' });
  };
  const router = Router();
  router.get('/auth', (_req, res) => res.json({ required, authenticated: !required }));
  router.post('/login', (_req, res) => res.status(required ? 401 : 200).json(required ? { error: 'Login is not implemented yet' } : { ok: true }));
  router.post('/logout', (_req, res) => res.json({ ok: true }));
  return { required, guard, router };
}
