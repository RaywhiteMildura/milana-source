import { createApp } from './app.js';
import { logger } from './core/logger.js';

const port = Number(process.env.RACELENS_PORT || 4850);
const { app, mode, dataDir, webDir, registry, scheduler } = createApp();
scheduler.start();

app.listen(port, () => {
  logger.info(`RaceLens listening on http://localhost:${port} (mode: ${mode})`);
  logger.info(`Data dir: ${dataDir}`);
  logger.info(`Sources: ${registry.all().map((a) => a.id).join(', ') || 'none'}`);
  logger.info('Automatic pre-race checks are on (see Settings → auto-recheck minutes).');
  if (!webDir) logger.warn('Web app not built yet – run `npm run build` (or `npm run dev` for the Vite dev server on :5173).');
});
