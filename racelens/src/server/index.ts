import QRCode from 'qrcode';
import { createApp, openHostedRefusal } from './app.js';
import { logger } from './core/logger.js';
import { listenUrls, machineNetwork } from './net.js';

const port = Number(process.env.RACELENS_PORT || 4850);
// Personal tool: listen on localhost only unless RACELENS_HOST is set (e.g. 0.0.0.0 to use it from a phone on the same Wi-Fi).
const host = process.env.RACELENS_HOST || '127.0.0.1';
const open = host === '0.0.0.0' || host === '::';
// Evaluated on every authenticated /api/health (re-reading the interfaces at most every 30 s), so an address the
// computer gets after start-up (Wi-Fi, Tailscale, a new DHCP lease) shows on the Settings phone card. Hosted servers
// report none (app.ts): a container's own address is useless to a phone.
const lanUrls = () => (open ? listenUrls(host, port, machineNetwork.get()) : []);
const { app, mode, dataDir, webDir, registry, scheduler, auth, hosting } = createApp({ urls: lanUrls });

const refusal = openHostedRefusal(hosting, auth.required);
if (refusal) {
  logger.error(refusal);
  process.exit(1);
}
scheduler.start();

app.listen(port, host, () => {
  const urls = hosting.hosted ? [] : lanUrls();
  logger.info(`RaceLens listening on http://${open ? 'localhost' : host}:${port} (mode: ${mode})${open ? ` – reachable from other devices on ${hosting.hosted ? 'the internet' : 'your network'}` : ''}`);
  if (hosting.publicUrl) logger.info(`Public address: ${hosting.publicUrl}`);
  logger.info(`Data dir: ${dataDir}`);
  logger.info(`Sources: ${registry.all().map((a) => a.id).join(', ') || 'none'}`);
  logger.info(`Automatic pre-race checks and results are on (change in Settings).`);
  if (auth.required) {
    logger.info('Password login is on (RACELENS_PASSWORD).');
    if ((process.env.RACELENS_PASSWORD ?? '').length < 8) logger.warn('RACELENS_PASSWORD is shorter than 8 characters – choose a longer one, especially if RaceLens is reachable from the internet.');
  } else if (hosting.hosted) logger.warn('No password set and RACELENS_ALLOW_OPEN=1: anyone on the internet can open RaceLens. Set RACELENS_PASSWORD to require a login.');
  else if (open) logger.warn('No password set: anyone on this network can open RaceLens. Set RACELENS_PASSWORD to require a login.');
  if (!webDir) logger.warn('Web app not built yet – run `npm run build` (or `npm run dev` for the Vite dev server on :5173).');
  if (open && !hosting.hosted && !urls.length) logger.info('No network address yet – Settings → Use RaceLens on your phone shows it once this computer is connected.');
  if (open && urls.length && process.env.RACELENS_QR !== '0') {
    const url = urls[0];
    QRCode.toString(url, { type: 'terminal', small: true })
      .then((qr) => {
        console.log(`\nOn your phone (same Wi-Fi), open ${url}${urls.length > 1 ? ` (or ${urls.slice(1).join(', ')})` : ''} – or scan:\n`);
        console.log(qr);
      })
      .catch(() => undefined);
  }
});
