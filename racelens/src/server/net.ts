import os from 'node:os';

type InterfaceTable = NodeJS.Dict<os.NetworkInterfaceInfo[]>;

/**
 * This machine's network interfaces, re-read lazily instead of only at start-up,
 * so an address acquired later (Wi-Fi connecting after log-on, Tailscale starting
 * after RaceLens, a DHCP lease change) is accepted by the host guard and shown
 * on the Settings phone card without a restart.
 *
 * - `get()` returns the table, re-reading it when it is older than `maxAgeMs` (30 s).
 * - `refreshOnMiss()` re-reads it right away, but at most once per `missIntervalMs`
 *   (5 s): the host guard calls it when a Host header is unknown, and that path is
 *   exactly the DNS-rebinding traffic the guard exists to refuse, so a hostile page
 *   must not be able to trigger an interface enumeration per request.
 */
export class NetworkSnapshot {
  private table: InterfaceTable = {};
  private own = new Set<string>();
  private readAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly read: () => InterfaceTable = () => os.networkInterfaces(),
    private readonly nowMs: () => number = () => Date.now(),
    private readonly maxAgeMs = 30_000,
    private readonly missIntervalMs = 5_000,
  ) {}

  get(): InterfaceTable {
    if (this.nowMs() - this.readAt >= this.maxAgeMs) this.reload();
    return this.table;
  }

  /** Re-reads the table unless it was read less than `missIntervalMs` ago; true when it did. */
  refreshOnMiss(): boolean {
    if (this.nowMs() - this.readAt < this.missIntervalMs) return false;
    this.reload();
    return true;
  }

  /** Every address of this machine, lower-cased (IPv6 without brackets). */
  addresses(): ReadonlySet<string> {
    this.get();
    return this.own;
  }

  private reload(): void {
    this.readAt = this.nowMs();
    try {
      this.table = this.read();
    } catch {
      return; /* best effort: keep the previous table */
    }
    const own = new Set<string>();
    for (const ifaces of Object.values(this.table)) for (const i of ifaces || []) own.add(i.address.toLowerCase());
    this.own = own;
  }
}

/** Shared by the host guard and the phone URLs, so both see the same addresses. */
export const machineNetwork = new NetworkSnapshot();

/** Tailscale hands out addresses from the CGNAT range 100.64.0.0/10 (macOS puts them on a utun interface). */
function isTailscaleAddress(address: string): boolean {
  const m = /^100\.(\d{1,3})\./.exec(address);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

/**
 * The addresses a phone on the same network can use to reach this server.
 * Only meaningful when the server listens on all interfaces (0.0.0.0 / ::).
 */
export function listenUrls(host: string, port: number, interfaces: InterfaceTable = os.networkInterfaces()): string[] {
  const all = host === '0.0.0.0' || host === '::' || host === '';
  if (!all) return [`http://${host.includes(':') ? `[${host}]` : host}:${port}`];
  const urls: string[] = [];
  try {
    for (const [name, ifaces] of Object.entries(interfaces)) {
      for (const i of ifaces || []) {
        if (i.internal || i.family !== 'IPv4') continue;
        // Skip link-local and obvious virtual adapters so the list stays short and useful
        // (but keep a Tailscale address even on a utun interface).
        if (i.address.startsWith('169.254.')) continue;
        if (/docker|veth|br-|vbox|vmnet|utun/i.test(name) && !isTailscaleAddress(i.address)) continue;
        urls.push(`http://${i.address}:${port}`);
      }
    }
  } catch {
    /* best effort */
  }
  return urls;
}

export interface Hosting {
  /**
   * True on a hosting platform / internet-facing container: RACELENS_ALLOWED_HOSTS
   * contains '*', or Fly.io (FLY_APP_NAME) or Render (RENDER) set their variables.
   * Hosted servers advertise no LAN addresses and must have a password (see index.ts).
   */
  hosted: boolean;
  /** The address phones should use: RACELENS_PUBLIC_URL, else the Fly / Render default; undefined when unknown. */
  publicUrl?: string;
  /**
   * Trust one proxy hop (X-Forwarded-For) only where a platform proxy really sits in
   * front: RACELENS_TRUST_PROXY=1, Fly.io or Render. Never inferred from '*', because a
   * bare `docker run` has no proxy and a spoofed X-Forwarded-For would then defeat the
   * login rate limit.
   */
  trustProxy: boolean;
}

/** Comma-separated RACELENS_ALLOWED_HOSTS, trimmed. */
export function allowedHostsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.RACELENS_ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Only an absolute http(s) URL is advertised; anything else is ignored. */
function cleanUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    return u.href.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

/** Reads the hosting situation from the environment; `allowedHosts` replaces RACELENS_ALLOWED_HOSTS when given. */
export function hostingFromEnv(env: NodeJS.ProcessEnv = process.env, allowedHosts: string[] = allowedHostsFromEnv(env)): Hosting {
  const fly = !!env.FLY_APP_NAME?.trim();
  const render = !!env.RENDER?.trim();
  const hosted = allowedHosts.map((h) => h.trim()).includes('*') || fly || render;
  const publicUrl =
    cleanUrl(env.RACELENS_PUBLIC_URL) ??
    (fly ? cleanUrl(`https://${env.FLY_APP_NAME!.trim()}.fly.dev`) : undefined) ??
    (render ? cleanUrl(env.RENDER_EXTERNAL_URL) : undefined);
  return { hosted, publicUrl, trustProxy: env.RACELENS_TRUST_PROXY === '1' || fly || render };
}
