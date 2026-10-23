import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

/**
 * Updating RaceLens from the phone (the Mac mini installation only).
 *
 * CONTRACT (with scripts/mac/install.sh and scripts/mac/self-update.sh):
 * - install.sh, when RaceLens was installed by the one-line installer, sets up a second LaunchAgent
 *   (au.racelens.updater) and writes RACELENS_UPDATE_DIR (the support folder) into config.env, which run.sh
 *   loads into the server's environment. That folder existing is what makes updates "supported".
 * - POST /update only writes `<updateDir>/update-request` (temp file + rename). launchd sees it and starts
 *   self-update.sh. The server never runs the update itself: install.sh restarts the server's own service,
 *   which would kill an update started from inside it.
 * - self-update.sh writes `<updateDir>/update-status.json`
 *   { state: 'running'|'done'|'failed', startedAt, finishedAt, ok, message, from, to } (from/to: commit ids),
 *   writing 'running' before it removes the request, so the phone never sees a gap.
 * - bootstrap.sh records the installed version in `<appDir>/VERSION.json` { commit, branch, installedAt, repo }.
 *
 * GET  /update → 200 { supported, version?, state, last? }
 *   state: 'requested' while the request file exists; else the status file's state; else 'idle'.
 *   A request nobody picked up for REQUEST_STALE_MS, or a 'running' status older than RUNNING_STALE_MS (the Mac
 *   restarted mid-update), is reported as 'failed' with a plain-English `last.message`, so the phone never waits
 *   for ever.
 * POST /update → 202 { requested: true, message } | 409 { error } (already requested / running, unless stale)
 *   | 501 { error } when updates are not supported here | 500 { error } when the request cannot be written.
 *
 * Mount it behind the auth guard (it adds no auth of its own): app.use('/api', updateRouter({ ... })).
 */

export const UPDATE_REQUEST_FILE = 'update-request';
export const UPDATE_STATUS_FILE = 'update-status.json';
export const VERSION_FILE = 'VERSION.json';
/** A 'running' status older than this is a leftover (self-update.sh itself gives up after 25 minutes). */
export const RUNNING_STALE_MS = 30 * 60_000;
/** launchd starts the updater within seconds (at the latest two minutes, its safety-net interval). */
export const REQUEST_STALE_MS = 10 * 60_000;

export const NOT_SUPPORTED_MESSAGE = 'Updating from the phone works on the Mac mini installation only.';
const REQUESTED_MESSAGE =
  'Update requested. The Mac mini is now downloading and installing the latest RaceLens. This takes a few minutes; RaceLens keeps working meanwhile and restarts by itself at the end.';
const STALE_REQUEST_MESSAGE =
  'The Mac mini did not start the update. Try again; if it still does not start, run the one-line install command on the Mac mini once.';
const STALE_RUNNING_MESSAGE = 'The last update did not finish (was the Mac mini restarted?). You can try again.';

export type UpdateState = 'idle' | 'requested' | 'running' | 'failed' | 'done';

export interface InstalledVersion {
  commit?: string;
  branch?: string;
  installedAt?: string;
}

export interface UpdateResult {
  startedAt?: string;
  finishedAt?: string;
  ok?: boolean;
  message?: string;
  from?: string;
  to?: string;
}

export interface UpdateInfo {
  supported: boolean;
  version?: InstalledVersion;
  state: UpdateState;
  last?: UpdateResult;
}

export interface UpdateRouterOptions {
  /** The support folder from RACELENS_UPDATE_DIR; unset (or missing on disk) = updates not supported here. */
  updateDir?: string;
  /** The app folder that holds VERSION.json (the racelens folder: dist/server/../..). */
  appDir: string;
  /** Real time, please – the status file's times come from the Mac's clock, not a demo clock. */
  now?: () => Date;
}

type Json = Record<string, unknown>;

function readJson(file: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined;
  } catch {
    return undefined;
  }
}

function strings<K extends string>(obj: Json, keys: readonly K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const k of keys) if (typeof obj[k] === 'string' && obj[k]) out[k] = obj[k] as string;
  return out;
}

function mtimeMs(file: string): number | undefined {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
}

/** When something happened: the ISO time written in the file, else the file's modification time. */
function whenMs(iso: unknown, file: string): number | undefined {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : mtimeMs(file);
}

export function updateRouter(opts: UpdateRouterOptions): Router {
  const r = Router();
  const now = opts.now ?? (() => new Date());
  const dir = opts.updateDir ? path.resolve(opts.updateDir) : undefined;
  const requestFile = dir && path.join(dir, UPDATE_REQUEST_FILE);
  const statusFile = dir && path.join(dir, UPDATE_STATUS_FILE);

  const supported = (): boolean => {
    try {
      return !!dir && fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  };

  const version = (): InstalledVersion | undefined => {
    const v = readJson(path.join(opts.appDir, VERSION_FILE));
    if (!v) return undefined;
    const picked = strings(v, ['commit', 'branch', 'installedAt'] as const);
    return Object.keys(picked).length ? picked : undefined;
  };

  /** The pending request, if any, and whether it is too old to still be waiting for. */
  const pendingRequest = (): { stale: boolean } | undefined => {
    if (!requestFile || !fs.existsSync(requestFile)) return undefined;
    const at = whenMs(readJson(requestFile)?.requestedAt, requestFile);
    return { stale: at !== undefined && now().getTime() - at > REQUEST_STALE_MS };
  };

  const lastStatus = (): { state: 'running' | 'done' | 'failed'; last: UpdateResult; stale: boolean } | undefined => {
    if (!statusFile) return undefined;
    const s = readJson(statusFile);
    if (!s || (s.state !== 'running' && s.state !== 'done' && s.state !== 'failed')) return undefined;
    const last: UpdateResult = strings(s, ['startedAt', 'finishedAt', 'message', 'from', 'to'] as const);
    if (typeof s.ok === 'boolean') last.ok = s.ok;
    const at = whenMs(s.startedAt, statusFile);
    const stale = s.state === 'running' && at !== undefined && now().getTime() - at > RUNNING_STALE_MS;
    return { state: s.state, last, stale };
  };

  const info = (): UpdateInfo => {
    const v = version();
    const base = v ? { version: v } : {};
    if (!supported()) return { supported: false, ...base, state: 'idle' };
    const status = lastStatus();
    const request = pendingRequest();
    if (request && !request.stale) return { supported: true, ...base, state: 'requested', ...(status && { last: status.last }) };
    if (request) return { supported: true, ...base, state: 'failed', last: { ok: false, message: STALE_REQUEST_MESSAGE } };
    if (!status) return { supported: true, ...base, state: 'idle' };
    if (status.stale) return { supported: true, ...base, state: 'failed', last: { ...status.last, ok: false, message: STALE_RUNNING_MESSAGE } };
    return { supported: true, ...base, state: status.state, last: status.last };
  };

  r.get('/update', (_req, res) => {
    res.json(info());
  });

  r.post('/update', (_req, res) => {
    if (!supported() || !dir || !requestFile) {
      res.status(501).json({ error: NOT_SUPPORTED_MESSAGE });
      return;
    }
    const current = info();
    if (current.state === 'requested') {
      res.status(409).json({ error: 'An update has already been requested – the Mac mini starts it within a minute or two.' });
      return;
    }
    if (current.state === 'running') {
      res.status(409).json({ error: 'RaceLens is already updating. This takes a few minutes – it restarts by itself when it is done.' });
      return;
    }
    // Written next to the request file and renamed into place, so launchd only ever sees a complete file.
    const tmp = path.join(dir, `.${UPDATE_REQUEST_FILE}.${process.pid}.${Date.now()}.tmp`);
    try {
      fs.writeFileSync(tmp, JSON.stringify({ requestedAt: now().toISOString() }) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, requestFile);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      res.status(500).json({ error: `Could not ask the Mac mini to update (${(err as NodeJS.ErrnoException).code ?? 'write failed'}).` });
      return;
    }
    res.status(202).json({ requested: true, message: REQUESTED_MESSAGE });
  });

  return r;
}
