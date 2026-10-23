import os from 'node:os';

/**
 * The addresses a phone on the same network can use to reach this server.
 * Only meaningful when the server listens on all interfaces (0.0.0.0 / ::).
 */
export function listenUrls(host: string, port: number): string[] {
  const all = host === '0.0.0.0' || host === '::' || host === '';
  if (!all) return [`http://${host.includes(':') ? `[${host}]` : host}:${port}`];
  const urls: string[] = [];
  try {
    for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
      for (const i of ifaces || []) {
        if (i.internal || i.family !== 'IPv4') continue;
        // Skip link-local and obvious virtual adapters so the list stays short and useful.
        if (i.address.startsWith('169.254.') || /docker|veth|br-|vbox|vmnet|utun/i.test(name)) continue;
        urls.push(`http://${i.address}:${port}`);
      }
    }
  } catch {
    /* best effort */
  }
  return urls;
}
