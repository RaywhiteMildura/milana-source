import QRCode from 'qrcode';
import { createApp, openHostedRefusal, publishedVia } from './app.js';
import { logger } from './core/logger.js';
import { allowedHostsFromEnv, listenUrls, machineNetwork } from './net.js';

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
  } else {
    // Reaching this point without a password means RACELENS_ALLOW_OPEN=1 (hosted / published) or plain LAN mode.
    const via = publishedVia(hosting);
    if (hosting.hosted) logger.warn('No password set and RACELENS_ALLOW_OPEN=1: anyone on the internet can open RaceLens. Set RACELENS_PASSWORD to require a login.');
    else if (via.length) logger.warn(`No password set and RACELENS_ALLOW_OPEN=1: anyone who can reach RaceLens through ${via.join(', ')} can open it. Set RACELENS_PASSWORD to require a login.`);
    else if (open) {
      logger.warn('NO PASSWORD SET: anyone on this network can open RaceLens and change its settings, packs and results.');
      logger.warn('Set RACELENS_PASSWORD to require a login (scripts/start-phone.sh and scripts\\start-phone.cmd ask for one at start-up).');
    }
    if (allowedHostsFromEnv().some((h) => h.trim() === '*')) {
      logger.warn("RACELENS_ALLOWED_HOSTS=* is not honoured without a password: RaceLens answers only this machine's own addresses, the names in RACELENS_ALLOWED_HOSTS and the RACELENS_PUBLIC_URL host.");
    }
  }
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
