import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry, type Mode } from './adapters/index.js';
import type { FetchContext } from './adapters/types.js';
import { HttpClient } from './core/http.js';
import { logger } from './core/logger.js';
import { JobManager } from './jobs/manager.js';
import { AutoRecheckScheduler } from './jobs/scheduler.js';
import { createApi } from './routes/api.js';
import { Store } from './store/store.js';

export interface AppOptions {
  mode?: Mode;
  dataDir?: string;
  record?: boolean;
  now?: () => Date;
  webDir?: string;
}

export const VERSION = '0.1.0';

export function createApp(opts: AppOptions = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const mode: Mode = opts.mode ?? ((process.env.RACELENS_MODE as Mode) || 'live');
  const dataDir = path.resolve(opts.dataDir ?? process.env.RACELENS_DATA_DIR ?? 'data');
  const store = new Store(dataDir);
  const registry = createRegistry(mode);
  const settings = store.getSettings();
  const http = new HttpClient({
    recordDir: opts.record ?? process.env.RACELENS_RECORD === '1' ? path.resolve('fixtures/recorded') : undefined,
    timeoutMs: 15_000,
  });
  const ctx: FetchContext = { http, log: logger, now: opts.now ?? (() => new Date()), jurisdiction: settings.jurisdiction };
  const jobs = new JobManager();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createApi({ registry, store, ctx, jobs, mode, version: VERSION, now: opts.now }));

  // Static web app (built by vite into dist/web). When running from src via tsx, look for ../../dist/web too.
  const candidates = [opts.webDir, path.resolve(here, '../web'), path.resolve(here, '../../dist/web'), path.resolve('dist/web')].filter((p): p is string => !!p);
  const webDir = candidates.find((p) => fs.existsSync(path.join(p, 'index.html')));
  if (webDir) {
    app.use(express.static(webDir, { index: 'index.html', maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.type('text').send('RaceLens API is running. Build the web app with `npm run build` or run `npm run dev` for the dev server.'));
  }
  const scheduler = new AutoRecheckScheduler({
    store,
    jobs,
    researchDeps: () => ({ registry, ctx, settings: store.getSettings(), now: opts.now }),
    now: opts.now,
    log: logger,
  });
  return { app, store, registry, jobs, ctx, mode, dataDir, webDir, scheduler };
}
