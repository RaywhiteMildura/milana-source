import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry, type Mode } from './adapters/index.js';
import { createAuth } from './auth.js';
import type { FetchContext } from './adapters/types.js';
import { HttpClient } from './core/http.js';
import { logger } from './core/logger.js';
import { JobManager } from './jobs/manager.js';
import { AutoRecheckScheduler } from './jobs/scheduler.js';
import { createApi, jsonErrorHandler } from './routes/api.js';
import { Store } from './store/store.js';

export interface AppOptions {
  mode?: Mode;
  dataDir?: string;
  record?: boolean;
  now?: () => Date;
  webDir?: string;
  /** Password that protects the app (default: RACELENS_PASSWORD env). Empty = no login. */
  password?: string;
  /** Hosts allowed in the Host header besides this machine's own (default: RACELENS_ALLOWED_HOSTS env; '*' allows any). */
  allowedHosts?: string[];
  /** URLs phones can use to reach this server (filled in by index.ts once listening). */
  urls?: () => string[];
}

export const VERSION = '0.1.0';

/**
 * Demo mode only: RACELENS_FAKE_NOW=<ISO date-time> starts the server's clock at
 * that instant (and lets it run from there), so the race-day automation can be
 * rehearsed on any day against the bundled meeting. Ignored in live mode.
 */
export function makeClock(mode: Mode, fakeNow = process.env.RACELENS_FAKE_NOW): () => Date {
  if (mode !== 'demo' || !fakeNow) return () => new Date();
  const start = new Date(fakeNow).getTime();
  if (!Number.isFinite(start)) {
    logger.warn(`RACELENS_FAKE_NOW is not a valid date-time: ${fakeNow} – using the real clock`);
    return () => new Date();
  }
  const realStart = Date.now();
  logger.warn(`Demo clock starts at ${new Date(start).toISOString()} (RACELENS_FAKE_NOW)`);
  return () => new Date(start + (Date.now() - realStart));
}

/**
 * Only answer requests addressed to this machine (localhost, its own network
 * addresses, or RACELENS_ALLOWED_HOSTS). Defeats DNS-rebinding pages that try to
 * reach http://127.0.0.1:4850 through a hostname they control.
 */
export function hostGuard(extra: string[] = (process.env.RACELENS_ALLOWED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
  // '*' is for hosted deployments (Fly.io, Render…) where the platform owns the hostname and the password protects the app.
  if (extra.includes('*')) return (_req: Request, _res: Response, next: NextFunction) => next();
  const allowed = new Set(['localhost', '127.0.0.1', '::1', '[::1]', ...extra.map((h) => h.toLowerCase())]);
  try {
    for (const ifaces of Object.values(os.networkInterfaces())) for (const i of ifaces || []) allowed.add(i.address.toLowerCase());
  } catch {
    /* best effort */
  }
  return (req: Request, res: Response, next: NextFunction) => {
    const raw = (req.headers.host || '').toLowerCase();
    const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(':')[0];
    if (!raw || allowed.has(host) || allowed.has(host.replace(/^\[|\]$/g, ''))) return next();
    res.status(421).json({ error: `Host ${raw} is not allowed. Open RaceLens via http://localhost or set RACELENS_ALLOWED_HOSTS.` });
  };
}

export function createApp(opts: AppOptions = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const mode: Mode = opts.mode ?? ((process.env.RACELENS_MODE as Mode) || 'live');
  const dataDir = path.resolve(opts.dataDir ?? process.env.RACELENS_DATA_DIR ?? 'data');
  const now = opts.now ?? makeClock(mode);
  const store = new Store(dataDir);
  const registry = createRegistry(mode);
  const settings = store.getSettings();
  const http = new HttpClient({
    recordDir: opts.record ?? process.env.RACELENS_RECORD === '1' ? path.resolve('fixtures/recorded') : undefined,
    timeoutMs: 15_000,
  });
  const ctx: FetchContext = {
    http,
    log: logger,
    now,
    // Always the current setting, not a snapshot taken at start-up.
    get jurisdiction() {
      return store.getSettings().jurisdiction;
    },
  };
  void settings;
  const jobs = new JobManager();
  const auth = createAuth({ password: opts.password ?? process.env.RACELENS_PASSWORD, secret: store.getSecret(), now });

  const app = express();
  app.disable('x-powered-by');
  // Behind a hosting platform's proxy (Fly.io, Render) the TLS hop is theirs; trust it so secure cookies work.
  if (process.env.RACELENS_TRUST_PROXY === '1' || (opts.allowedHosts ?? (process.env.RACELENS_ALLOWED_HOSTS || '').split(',')).includes('*')) app.set('trust proxy', 1);
  app.use(hostGuard(opts.allowedHosts));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', auth.guard);
  app.use('/api', auth.router);
  const scheduler = new AutoRecheckScheduler({
    store,
    jobs,
    researchDeps: () => ({ registry, ctx, settings: store.getSettings(), now }),
    now,
    log: logger,
  });
  app.use('/api', createApi({ registry, store, ctx, jobs, mode, version: VERSION, now, healthExtras: () => ({ urls: opts.urls?.() ?? [], scheduler: scheduler.status() }) }));
  app.use('/api', jsonErrorHandler);

  // Static web app (built by vite into dist/web). When running from src via tsx, look for ../../dist/web too.
  const candidates = [opts.webDir, path.resolve(here, '../web'), path.resolve(here, '../../dist/web'), path.resolve('dist/web')].filter((p): p is string => !!p);
  const webDir = candidates.find((p) => fs.existsSync(path.join(p, 'index.html')));
  if (webDir) {
    // Hashed assets may be cached; the shell must always be fresh after a rebuild.
    app.use(express.static(webDir, { index: false, maxAge: '1h', setHeaders: (res, filePath) => filePath.endsWith('index.html') && res.setHeader('Cache-Control', 'no-cache') }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  } else {
    app.get('/', (_req, res) => res.type('text').send('RaceLens API is running. Build the web app with `npm run build` or run `npm run dev` for the dev server.'));
  }
  return { app, store, registry, jobs, ctx, mode, dataDir, webDir, scheduler, auth };
}
