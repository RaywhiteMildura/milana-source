import QRCode from 'qrcode';
import { createApp } from './app.js';
import { logger } from './core/logger.js';
import { listenUrls } from './net.js';

const port = Number(process.env.RACELENS_PORT || 4850);
// Personal tool: listen on localhost only unless RACELENS_HOST is set (e.g. 0.0.0.0 to use it from a phone on the same Wi-Fi).
const host = process.env.RACELENS_HOST || '127.0.0.1';
const state = { urls: [] as string[] };
const { app, mode, dataDir, webDir, registry, scheduler, auth } = createApp({ urls: () => state.urls });
scheduler.start();

app.listen(port, host, () => {
  const open = host === '0.0.0.0' || host === '::';
  state.urls = open ? listenUrls(host, port) : [];
  logger.info(`RaceLens listening on http://${open ? 'localhost' : host}:${port} (mode: ${mode})${open ? ' – reachable from other devices on your network' : ''}`);
  logger.info(`Data dir: ${dataDir}`);
  logger.info(`Sources: ${registry.all().map((a) => a.id).join(', ') || 'none'}`);
  logger.info(`Automatic pre-race checks and results are on (change in Settings).`);
  if (auth.required) logger.info('Password login is on (RACELENS_PASSWORD).');
  else if (open) logger.warn('No password set: anyone on this network can open RaceLens. Set RACELENS_PASSWORD to require a login.');
  if (!webDir) logger.warn('Web app not built yet – run `npm run build` (or `npm run dev` for the Vite dev server on :5173).');
  if (open && state.urls.length && process.env.RACELENS_QR !== '0') {
    const url = state.urls[0];
    QRCode.toString(url, { type: 'terminal', small: true })
      .then((qr) => {
        console.log(`\nOn your phone (same Wi-Fi), open ${url}${state.urls.length > 1 ? ` (or ${state.urls.slice(1).join(', ')})` : ''} – or scan:\n`);
        console.log(qr);
      })
      .catch(() => undefined);
  }
});
