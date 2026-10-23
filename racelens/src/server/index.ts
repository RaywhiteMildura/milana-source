import { createApp } from './app.js';
import { logger } from './core/logger.js';

const port = Number(process.env.RACELENS_PORT || 4850);
// Personal tool: listen on localhost only unless RACELENS_HOST is set (e.g. 0.0.0.0 to use it from a phone on the same Wi-Fi).
const host = process.env.RACELENS_HOST || '127.0.0.1';
const { app, mode, dataDir, webDir, registry, scheduler } = createApp();
scheduler.start();

app.listen(port, host, () => {
  logger.info(`RaceLens listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (mode: ${mode})${host === '0.0.0.0' ? ' – reachable from other devices on your network' : ''}`);
  logger.info(`Data dir: ${dataDir}`);
  logger.info(`Sources: ${registry.all().map((a) => a.id).join(', ') || 'none'}`);
  logger.info('Automatic pre-race checks are on (see Settings → auto-recheck minutes).');
  if (!webDir) logger.warn('Web app not built yet – run `npm run build` (or `npm run dev` for the Vite dev server on :5173).');
});
