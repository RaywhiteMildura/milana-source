import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import fs from 'node:fs';
import { STATUS_CODES } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
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
 * The settings that publish this server to other devices through a proxy or a
 * name, beyond plain LAN mode: RACELENS_TRUST_PROXY=1 (a proxy such as Tailscale
 * Serve passes requests on), named RACELENS_ALLOWED_HOSTS, RACELENS_PUBLIC_URL.
 * Empty when there are none.
 */
export function publishedVia(hosting: Partial<Pick<Hosting, 'trustProxy' | 'publicUrl'>>, allowedHosts: string[] = allowedHostsFromEnv()): string[] {
  const named = allowedHosts.map((h) => h.trim()).filter((h) => h && h !== '*');
  return [
    ...(hosting.trustProxy ? ['RACELENS_TRUST_PROXY=1'] : []),
    ...(named.length ? [`RACELENS_ALLOWED_HOSTS=${named.join(',')}`] : []),
    ...(hosting.publicUrl ? [`RACELENS_PUBLIC_URL=${hosting.publicUrl}`] : []),
  ];
}

/**
 * Without a password index.ts refuses to start (unless RACELENS_ALLOW_OPEN=1 says
 * it is deliberate) when the server is
 * - hosted (RACELENS_ALLOWED_HOSTS has '*', or Fly.io / Render): open to the internet;
 * - published through a proxy or a name (publishedVia): e.g. the Mac mini behind
 *   Tailscale Serve when its Keychain could not be read, which would otherwise
 *   serve the whole API to every device on the tailnet.
 * Returns the message to print, or undefined when it is fine to start. Plain LAN
 * mode (RACELENS_HOST=0.0.0.0 alone, as `npm run start:phone` with "Enter for no
 * password") only warns.
 */
export function openHostedRefusal(
  hosting: Pick<Hosting, 'hosted'> & Partial<Pick<Hosting, 'trustProxy' | 'publicUrl'>>,
  authRequired: boolean,
  env: NodeJS.ProcessEnv = process.env,
  allowedHosts: string[] = allowedHostsFromEnv(env),
): string | undefined {
  if (authRequired || env.RACELENS_ALLOW_OPEN === '1') return undefined;
  if (hosting.hosted) {
    return (
      'RaceLens is running as a hosted server (RACELENS_ALLOWED_HOSTS=*, Fly.io or Render) but RACELENS_PASSWORD is not set, ' +
      'so anyone on the internet could read and change your packs and settings. Refusing to start. ' +
      'Set a password (fly secrets set RACELENS_PASSWORD=..., the Render dashboard, or docker run -e RACELENS_PASSWORD=...). ' +
      '(RACELENS_ALLOW_OPEN=1 would start it without one, open to anyone who finds the address.)'
    );
  }
  const via = publishedVia(hosting, allowedHosts);
  if (!via.length) return undefined;
  return (
    `RaceLens is set up to be reached from other devices through a proxy or a name (${via.join(', ')}) but RACELENS_PASSWORD is empty, ` +
    'so anyone who can reach that address could read and change your packs and settings. Refusing to start. ' +
    'On the Mac mini the password comes from the Keychain: if the Keychain was still locked (just after a restart), the service ' +
    'tries again by itself every 10 seconds and starts as soon as it can read the password. If this keeps repeating, store one with ' +
    '`bash ~/RaceLens/app/scripts/mac/install.sh --new-password`. Anywhere else set RACELENS_PASSWORD (scripts/start-phone.sh and ' +
    'scripts\\start-phone.cmd ask for it). RACELENS_ALLOW_OPEN=1 starts it without a password anyway.'
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

/** The host name of a Host / X-Forwarded-Host value: lower-case, without the port (an IPv6 address keeps its brackets). */
function hostnameOf(raw: string | string[] | undefined): string {
  const value = (Array.isArray(raw) ? raw[0] : raw || '').split(',')[0].trim().toLowerCase();
  return value.startsWith('[') ? value.slice(0, value.indexOf(']') + 1) : value.split(':')[0];
}

/** The host name of an absolute http(s) URL (RACELENS_PUBLIC_URL, an Origin header), or undefined. */
function urlHostname(raw: string | undefined): string | undefined {
  try {
    const u = new URL(raw ?? '');
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Only answer requests addressed to this machine (localhost, its own network
 * addresses, or RACELENS_ALLOWED_HOSTS). Defeats DNS-rebinding pages that try to
 * reach http://127.0.0.1:4850 through a hostname they control.
 */
export function hostGuard(extra: string[] = allowedHostsFromEnv(), network: NetworkSnapshot = machineNetwork) {
  const names = extra.map((h) => h.trim().toLowerCase()).filter(Boolean);
  // '*' is for hosted deployments (Fly.io, Render…) where the platform owns the hostname and the password protects
  // the app (index.ts refuses to start hosted without one; createApp drops '*' when there is none).
  if (names.includes('*')) return (_req: Request, _res: Response, next: NextFunction) => next();
  const fixed = new Set(['localhost', '127.0.0.1', '::1', '[::1]', ...names]);
  return (req: Request, res: Response, next: NextFunction) => {
    const raw = (req.headers.host || '').toLowerCase();
    const host = hostnameOf(raw);
    const bare = host.replace(/^\[|\]$/g, '');
    if (!raw || fixed.has(host) || fixed.has(bare)) return next();
    // This machine's own addresses are re-read lazily (every 30 s, and on a miss at most every 5 s), so an address
    // acquired after start-up (Wi-Fi, Tailscale, a new DHCP lease) works without a restart.
    if (network.addresses().has(bare) || (network.refreshOnMiss() && network.addresses().has(bare))) return next();
    res.status(421).json({ error: `Host ${raw} is not allowed. Open RaceLens via http://localhost or set RACELENS_ALLOWED_HOSTS.` });
  };
}

/**
 * Refuses state-changing API requests (anything but GET / HEAD / OPTIONS) that
 * another web site makes the browser send - a page that POSTs to
 * http://192.168.1.23:4850/api/... in no-cors mode, which matters most when no
 * password is set. The browser names the page in Origin; it must be this server:
 * the Host header, the X-Forwarded-Host a trusted proxy passes on (Tailscale Serve
 * may hand over Host 127.0.0.1:4850), a RACELENS_ALLOWED_HOSTS name or the
 * RACELENS_PUBLIC_URL host. Host names are compared, not ports: a page on another
 * port of the same machine is the owner's own (the Vite dev server on :5173
 * proxies to :4850); what this stops is other sites. `Origin: null` (sandboxed
 * frames, file pages) and Sec-Fetch-Site: cross-site are refused too. Requests
 * without an Origin (curl, scripts, server-to-server) are no browser page and pass.
 */
export function crossSiteGuard(opts: { names?: string[]; publicUrl?: string; trustProxy?: boolean } = {}): RequestHandler {
  const names = new Set((opts.names ?? []).map((h) => h.trim().toLowerCase()).filter((h) => h && h !== '*'));
  const publicHost = urlHostname(opts.publicUrl);
  if (publicHost) names.add(publicHost);
  const ours = (req: Request, origin: string): boolean => {
    const host = urlHostname(origin);
    if (!host) return false;
    if (names.has(host) || host === hostnameOf(req.headers.host)) return true;
    return !!opts.trustProxy && req.headers['x-forwarded-host'] !== undefined && host === hostnameOf(req.headers['x-forwarded-host']);
  };
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    if (req.headers['sec-fetch-site'] !== 'cross-site' && (origin === undefined || ours(req, origin))) return next();
    res.status(403).json({ error: 'Refused: this request came from another web site. Open RaceLens itself and try again.', code: 'cross-site' });
  };
}

/** Sent with every answer: never inside another site's frame, no MIME sniffing, no Referer to other sites. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
}

/** Bodies under this size go out as they are: compressing them saves next to nothing. */
const COMPRESS_MIN_BYTES = 1024;
/** Text worth compressing: the API's JSON and the web app's HTML, JS, CSS, SVG and manifest - never an event stream. */
const COMPRESSIBLE = /^\s*(?:text\/(?!event-stream)|application\/(?:json|javascript|xml|manifest\+json)|image\/svg\+xml)/i;

/**
 * The encoding to answer with for an Accept-Encoding header: brotli when the client
 * takes it (browsers do over https, e.g. through Tailscale Serve) at least as
 * gladly as gzip, else gzip ('*' counts as gzip), else none. q=0 refuses one.
 */
export function pickEncoding(header: string | string[] | undefined): 'br' | 'gzip' | undefined {
  const q = new Map<string, number>();
  for (const part of (Array.isArray(header) ? header.join(',') : (header ?? '')).split(',')) {
    const [name, ...params] = part.split(';').map((s) => s.trim().toLowerCase());
    if (!name) continue;
    const given = params.find((p) => p.startsWith('q='));
    const value = given === undefined ? 1 : Number(given.slice(2));
    q.set(name, Number.isFinite(value) ? value : 0);
  }
  const br = q.get('br') ?? 0;
  const gzip = q.get('gzip') ?? q.get('x-gzip') ?? q.get('*') ?? 0;
  if (br > 0 && br >= gzip) return 'br';
  return gzip > 0 ? 'gzip' : undefined;
}

type BodyChunk = string | Uint8Array;
/** A copy: the writer may reuse its buffer once write() has returned, and this one is kept until end(). */
const toBuffer = (chunk: BodyChunk, encoding?: BufferEncoding): Buffer => (typeof chunk === 'string' ? Buffer.from(chunk, encoding ?? 'utf8') : Buffer.from(chunk));

/**
 * Compresses text answers of 1 KB or more (brotli or gzip, whichever the client
 * accepts; Vary: Accept-Encoding on every compressible answer). A meeting pack
 * is ~1.2 MB of JSON - about 85 KB as brotli, 140 KB as gzip - and the phone
 * fetches it again after every automatic check over 4G; the app's own script is
 * 360 KB. Every body here is small enough to hold in memory (res.json sends one
 * buffer; express.static streams files of a few hundred KB), so it is collected,
 * compressed off the main thread by node:zlib and sent with an exact
 * Content-Length - no chunking, no back-pressure to manage. Left alone: HEAD,
 * 204 / 206 / 304, already-encoded bodies, Cache-Control: no-transform, binary
 * types (images, fonts) and anything whose headers went out before the body
 * (a stream that called writeHead itself).
 */
export function compression(minBytes = COMPRESS_MIN_BYTES): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'HEAD') return next();
    const encoding = pickEncoding(req.headers['accept-encoding']);
    const write = res.write as (...args: unknown[]) => boolean;
    const end = res.end as (...args: unknown[]) => Response;
    // 'ended': the collected body is being compressed and sent; anything written after that is dropped, as it would
    // be after a real end (a second end() must not send an empty answer ahead of the compressed one).
    let state: 'undecided' | 'pass' | 'collect' | 'ended' = 'undecided';
    const chunks: Buffer[] = [];

    // Decided on the first piece of the body, when the status and headers are final but not yet sent.
    const decide = () => {
      state = 'pass';
      if (res.headersSent || !COMPRESSIBLE.test(String(res.getHeader('Content-Type') ?? ''))) return;
      if (/\bno-transform\b/i.test(String(res.getHeader('Cache-Control') ?? ''))) return;
      res.vary('Accept-Encoding');
      const status = res.statusCode;
      if (!encoding || status < 200 || status === 204 || status === 206 || status === 304) return;
      if (String(res.getHeader('Content-Encoding') ?? 'identity').toLowerCase() !== 'identity') return;
      const length = res.getHeader('Content-Length');
      if (length !== undefined && Number(length) < minBytes) return;
      state = 'collect';
    };

    res.write = function (this: Response, chunk: BodyChunk, ...rest: unknown[]) {
      if (state === 'undecided') decide();
      if (state === 'pass') return write.call(this, chunk, ...rest);
      if (state === 'ended') return false;
      if (chunk != null) chunks.push(toBuffer(chunk, typeof rest[0] === 'string' ? (rest[0] as BufferEncoding) : undefined));
      const callback = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
      if (callback) process.nextTick(callback);
      return true;
    } as Response['write'];

    res.end = function (this: Response, ...args: unknown[]) {
      if (state === 'undecided') decide();
      if (state === 'pass') return end.apply(this, args);
      if (state === 'ended') return this;
      state = 'ended';
      const chunk = typeof args[0] === 'function' ? undefined : (args[0] as BodyChunk | null | undefined);
      if (chunk != null) chunks.push(toBuffer(chunk, typeof args[1] === 'string' ? (args[1] as BufferEncoding) : undefined));
      const callback = args.find((a) => typeof a === 'function');
      const body = Buffer.concat(chunks);
      const send = (out: Buffer, as?: 'br' | 'gzip') => {
        if (as) {
          res.setHeader('Content-Encoding', as);
          res.setHeader('Content-Length', out.length);
        }
        end.call(res, out, callback);
      };
      if (body.length < minBytes) send(body);
      else if (encoding === 'br') {
        const params = { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length };
        zlib.brotliCompress(body, { params }, (err, out) => (err ? send(body) : send(out, 'br')));
      } else zlib.gzip(body, (err, out) => (err ? send(body) : send(out, 'gzip')));
      return this;
    } as Response['end'];
    next();
  };
}

/**
 * The app's last error handler: whatever went wrong outside the API router (a
 * broken JSON body sent to a page, a static file that vanished during a rebuild)
 * is logged here and answered plainly - never with Express's default page, which
 * shows the stack trace and this computer's folder names (/Users/<name>/...) to
 * anyone, signed in or not, whenever NODE_ENV is not "production".
 */
export function plainErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err); // Express then only closes the connection
  const e = err as { status?: unknown; statusCode?: unknown } | undefined;
  const given = Number(e?.status ?? e?.statusCode);
  const status = Number.isInteger(given) && given >= 400 && given < 600 ? given : 500;
  if (status >= 500) logger.error(`${req.method} ${req.path} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  else logger.debug(`${req.method} ${req.path}: ${status} ${err instanceof Error ? err.message : String(err)}`);
  const message = status >= 500 ? 'Something went wrong' : (STATUS_CODES[status] ?? 'Bad request');
  if (req.path.startsWith('/api/')) res.status(status).json({ error: message });
  else res.status(status).type('text').send(message);
}

/** True for a path that names a file (its last segment has an extension) or anything under /assets/. */
const isFilePath = (p: string): boolean => p.startsWith('/assets/') || /\.[^/]*$/.test(p);

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
  const allowedHosts = opts.allowedHosts ?? allowedHostsFromEnv();
  const hosting: Hosting = { ...hostingFromEnv(process.env, allowedHosts), ...opts.hosting };
  const publicHost = urlHostname(hosting.publicUrl);
  // '*' switches the host guard off, which only the password makes safe: an open server (RACELENS_ALLOW_OPEN=1)
  // keeps the guard - this machine's own addresses, the named hosts and the public address - against DNS rebinding.
  const guardHosts = [...(auth.required ? allowedHosts : allowedHosts.filter((h) => h.trim() !== '*')), ...(publicHost ? [publicHost] : [])];

  const app = express();
  app.disable('x-powered-by');
  // Only where a platform proxy really sits in front (RACELENS_TRUST_PROXY=1, Fly.io, Render) is X-Forwarded-For
  // trusted for req.ip (the login rate limit keys on it). Secure cookies do not need it: auth reads x-forwarded-proto.
  if (hosting.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(hostGuard(guardHosts));
  app.use(compression());
  app.use('/api', crossSiteGuard({ names: allowedHosts, publicUrl: hosting.publicUrl, trustProxy: hosting.trustProxy }));
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
    // The app shell for a page the browser opens - never for a missing file: a stale /assets/*.js answered with
    // index.html would be cached by the service worker as the app's script (a blank app until its cache is cleared).
    app.get(/^(?!\/api\/).*/, (req, res, next) => {
      if (isFilePath(req.path) || !req.accepts('html')) return next();
      res.sendFile(path.join(webDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } });
    });
  } else {
    app.get('/', (_req, res) => res.type('text').send('RaceLens API is running. Build the web app with `npm run build` or run `npm run dev` for the dev server.'));
  }
  app.use((_req: Request, res: Response) => res.status(404).type('text').send('Not found'));
  app.use(plainErrorHandler);
  return { app, store, registry, jobs, ctx, mode, dataDir, webDir, scheduler, auth, hosting };
}
