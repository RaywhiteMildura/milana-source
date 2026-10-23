import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry, type Mode } from './adapters/index.js';
import { createAuth } from './auth.js';
import type { FetchContext } from './adapters/types.js';
import { HttpClient } from './core/http.js';
import { logger } from './core/logger.js';
import { JobManager } from './jobs/manager.js';
import { AutoRecheckScheduler } from './jobs/scheduler.js';
import { allowedHostsFromEnv, hostingFromEnv, machineNetwork, type Hosting, type NetworkSnapshot } from './net.js';
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
  /** LAN URLs phones can use to reach this server (index.ts); never reported when the server is hosted. */
  urls?: () => string[];
  /** Hosting situation (default: read from the environment with hostingFromEnv, using `allowedHosts` when given). */
  hosting?: Partial<Hosting>;
}

/**
 * Hosted (RACELENS_ALLOWED_HOSTS has '*', or Fly.io / Render) without a password
 * means the whole API is open to the internet: index.ts refuses to start then,
 * unless RACELENS_ALLOW_OPEN=1 says it is deliberate. Returns the message to print,
 * or undefined when it is fine to start. LAN mode without a password only warns.
 */
export function openHostedRefusal(hosting: Pick<Hosting, 'hosted'>, authRequired: boolean, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!hosting.hosted || authRequired || env.RACELENS_ALLOW_OPEN === '1') return undefined;
  return (
    'RaceLens is running as a hosted server (RACELENS_ALLOWED_HOSTS=*, Fly.io or Render) but RACELENS_PASSWORD is not set, ' +
    'so anyone on the internet could read and change your packs and settings. Refusing to start. ' +
    'Set a password (fly secrets set RACELENS_PASSWORD=..., the Render dashboard, or docker run -e RACELENS_PASSWORD=...), ' +
    'or set RACELENS_ALLOW_OPEN=1 if it really is on a private network you trust.'
  );
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
export function hostGuard(extra: string[] = allowedHostsFromEnv(), network: NetworkSnapshot = machineNetwork) {
  const names = extra.map((h) => h.trim().toLowerCase()).filter(Boolean);
  // '*' is for hosted deployments (Fly.io, Render…) where the platform owns the hostname and the password protects
  // the app (index.ts refuses to start hosted without one).
  if (names.includes('*')) return (_req: Request, _res: Response, next: NextFunction) => next();
  const fixed = new Set(['localhost', '127.0.0.1', '::1', '[::1]', ...names]);
  return (req: Request, res: Response, next: NextFunction) => {
    const raw = (req.headers.host || '').toLowerCase();
    const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(':')[0];
    const bare = host.replace(/^\[|\]$/g, '');
    if (!raw || fixed.has(host) || fixed.has(bare)) return next();
    // This machine's own addresses are re-read lazily (every 30 s, and on a miss at most every 5 s), so an address
    // acquired after start-up (Wi-Fi, Tailscale, a new DHCP lease) works without a restart.
    if (network.addresses().has(bare) || (network.refreshOnMiss() && network.addresses().has(bare))) return next();
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
  const auth = createAuth({
    password: opts.password ?? process.env.RACELENS_PASSWORD,
    secret: store.getSecret(),
    now,
    revocationFile: path.join(dataDir, '.revoked-sessions.json'),
    log: logger,
  });
  const hosting: Hosting = { ...hostingFromEnv(process.env, opts.allowedHosts), ...opts.hosting };

  const app = express();
  app.disable('x-powered-by');
  // Only where a platform proxy really sits in front (RACELENS_TRUST_PROXY=1, Fly.io, Render) is X-Forwarded-For
  // trusted for req.ip (the login rate limit keys on it). Secure cookies do not need it: auth reads x-forwarded-proto.
  if (hosting.trustProxy) app.set('trust proxy', 1);
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
  // Hosted: the container's own addresses are unreachable for a phone, so only the public URL is reported.
  const healthExtras = () => ({ urls: hosting.hosted ? [] : (opts.urls?.() ?? []), publicUrl: hosting.publicUrl, scheduler: scheduler.status() });
  app.use('/api', createApi({ registry, store, ctx, jobs, mode, version: VERSION, now, healthExtras }));
  app.use('/api', jsonErrorHandler);

  // Static web app (built by vite into dist/web). When running from src via tsx, look for ../../dist/web too.
  const candidates = [opts.webDir, path.resolve(here, '../web'), path.resolve(here, '../../dist/web'), path.resolve('dist/web')].filter((p): p is string => !!p);
  // Only a BUILT web app: running from src (tsx) finds src/web/index.html too, which is the unbuilt Vite page (blank in a browser).
  const webDir = candidates.find((p) => fs.existsSync(path.join(p, 'index.html')) && !fs.existsSync(path.join(p, 'main.tsx')));
  if (webDir) {
    // Hashed assets may be cached; the shell must always be fresh after a rebuild.
    app.use(express.static(webDir, { index: false, maxAge: '1h', setHeaders: (res, filePath) => filePath.endsWith('index.html') && res.setHeader('Cache-Control', 'no-cache') }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  } else {
    app.get('/', (_req, res) => res.type('text').send('RaceLens API is running. Build the web app with `npm run build` or run `npm run dev` for the dev server.'));
  }
  return { app, store, registry, jobs, ctx, mode, dataDir, webDir, scheduler, auth, hosting };
}
