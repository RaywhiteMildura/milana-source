import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface HttpOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  method?: 'GET' | 'POST';
  body?: string;
  /** Expected content, used to validate the response. */
  expect?: 'json' | 'text' | 'any';
  /** External cancellation (the orchestrator aborts a source that overran its budget). */
  signal?: AbortSignal;
}

export interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  url: string;
  ms: number;
  text: string;
  json: T | undefined;
  fromCache?: boolean;
  fromFixture?: boolean;
}

export interface HttpClientOptions {
  /** Default timeout per request. */
  timeoutMs?: number;
  userAgent?: string;
  /** Directory to record raw responses into (RACELENS_RECORD=1). */
  recordDir?: string;
  /** Directory to replay from instead of the network (tests). */
  replayDir?: string;
  /** In-memory cache TTL (ms) for identical GETs. 0 disables. */
  cacheTtlMs?: number;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Minimum ms between requests to the same host (politeness). */
  perHostDelayMs?: number;
}

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
  }
}

function keyFor(url: string, opts?: HttpOptions): string {
  const h = crypto.createHash('sha1');
  h.update((opts?.method || 'GET') + ' ' + url + ' ' + (opts?.body || ''));
  return h.digest('hex').slice(0, 20);
}

function safeName(url: string): string {
  const u = new URL(url);
  return (u.hostname + u.pathname).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 120);
}

/**
 * Small resilient HTTP client: timeouts, retries with backoff, in-memory cache,
 * optional record/replay to fixtures so every adapter can be tested offline.
 */
export class HttpClient {
  private cache = new Map<string, { at: number; res: HttpResponse }>();
  private lastHit = new Map<string, number>();
  readonly opts: Required<Pick<HttpClientOptions, 'timeoutMs' | 'userAgent' | 'cacheTtlMs' | 'perHostDelayMs'>> &
    HttpClientOptions;

  constructor(opts: HttpClientOptions = {}) {
    this.opts = {
      timeoutMs: opts.timeoutMs ?? 12000,
      userAgent: opts.userAgent ?? DEFAULT_UA,
      cacheTtlMs: opts.cacheTtlMs ?? 30_000,
      perHostDelayMs: opts.perHostDelayMs ?? 150,
      ...opts,
    };
  }

  async get<T = unknown>(url: string, opts: HttpOptions = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...opts, method: 'GET' });
  }

  /** A view of this client whose every request carries `signal`, so a whole source fetch can be cancelled. */
  bound(signal: AbortSignal): HttpClient {
    const base = this;
    const bound = Object.create(base) as HttpClient;
    bound.request = <T>(url: string, opts: HttpOptions) => base.request<T>(url, { ...opts, signal: opts.signal ?? signal });
    return bound;
  }

  async getJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
    const res = await this.request<T>(url, { ...opts, method: 'GET', expect: 'json' });
    if (!res.ok) throw new HttpError(`HTTP ${res.status} for ${url}`, res.status, url);
    if (res.json === undefined) throw new HttpError(`Non-JSON response from ${url}`, res.status, url);
    return res.json;
  }

  async getText(url: string, opts: HttpOptions = {}): Promise<string> {
    const res = await this.request<unknown>(url, { ...opts, method: 'GET', expect: 'text' });
    if (!res.ok) throw new HttpError(`HTTP ${res.status} for ${url}`, res.status, url);
    return res.text;
  }

  async request<T>(url: string, opts: HttpOptions): Promise<HttpResponse<T>> {
    const key = keyFor(url, opts);
    const method = opts.method || 'GET';

    if (this.opts.replayDir) {
      const fixture = this.findFixture(url, key);
      if (fixture) return fixture as HttpResponse<T>;
      throw new HttpError(`No replay fixture for ${url}`, 0, url);
    }

    if (method === 'GET' && this.opts.cacheTtlMs > 0) {
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.at < this.opts.cacheTtlMs) return { ...hit.res, fromCache: true } as HttpResponse<T>;
    }

    const retries = opts.retries ?? 2;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (opts.signal?.aborted) throw new Error(`Cancelled: ${url}`);
      try {
        const res = await this.once<T>(url, opts);
        // Retry on 5xx / 429 only
        if (!res.ok && (res.status >= 500 || res.status === 429) && attempt < retries) {
          await sleep(300 * 2 ** attempt);
          continue;
        }
        if (res.ok && method === 'GET' && this.opts.cacheTtlMs > 0 && res.text.length <= 256 * 1024) {
          // Small, bounded cache: sweep expired entries on every insert, never more than 200 live entries.
          const cutoff = Date.now() - this.opts.cacheTtlMs;
          for (const [k, v] of this.cache) if (v.at < cutoff) this.cache.delete(k);
          while (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value as string);
          this.cache.set(key, { at: Date.now(), res });
        }
        if (this.opts.recordDir) this.record(url, key, res);
        return res;
      } catch (err) {
        lastErr = err;
        // A timeout already consumed the caller's patience: do not retry it.
        if (err instanceof Error && err.name === 'AbortError') throw new Error(`Timed out after ${opts.timeoutMs ?? this.opts.timeoutMs}ms: ${url}`);
        if (attempt < retries) await sleep(300 * 2 ** attempt);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async once<T>(url: string, opts: HttpOptions): Promise<HttpResponse<T>> {
    const host = new URL(url).hostname;
    const last = this.lastHit.get(host) || 0;
    const wait = last + this.opts.perHostDelayMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastHit.set(host, Date.now());

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.opts.timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const started = Date.now();
    try {
      const f = this.opts.fetchImpl ?? fetch;
      const res = await f(url, {
        method: opts.method || 'GET',
        headers: {
          'User-Agent': this.opts.userAgent,
          Accept: opts.expect === 'json' ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
          'Accept-Language': 'en-AU,en;q=0.9',
          ...(opts.headers || {}),
        },
        body: opts.body,
        signal: controller.signal,
        redirect: 'follow',
      });
      const text = await res.text();
      let json: T | undefined;
      if (opts.expect !== 'text') {
        const trimmed = text.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            json = JSON.parse(trimmed) as T;
          } catch {
            json = undefined;
          }
        }
      }
      return { ok: res.ok, status: res.status, url, ms: Date.now() - started, text, json };
    } catch (err) {
      if (opts.signal?.aborted) throw new Error(`Cancelled: ${url}`);
      throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  private record(url: string, key: string, res: HttpResponse): void {
    try {
      const dir = this.opts.recordDir!;
      fs.mkdirSync(dir, { recursive: true });
      const base = `${safeName(url)}__${key}`;
      fs.writeFileSync(path.join(dir, base + '.meta.json'), JSON.stringify({ url, status: res.status, ms: res.ms, at: new Date().toISOString() }, null, 2));
      fs.writeFileSync(path.join(dir, base + (res.json !== undefined ? '.json' : '.txt')), res.json !== undefined ? JSON.stringify(res.json, null, 2) : res.text);
    } catch {
      /* recording is best-effort */
    }
  }

  private findFixture(url: string, key: string): HttpResponse | undefined {
    const dir = this.opts.replayDir!;
    if (!fs.existsSync(dir)) return undefined;
    const base = `${safeName(url)}__${key}`;
    for (const ext of ['.json', '.txt']) {
      const p = path.join(dir, base + ext);
      if (fs.existsSync(p)) {
        const text = fs.readFileSync(p, 'utf8');
        let json: unknown;
        if (ext === '.json') {
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
        }
        return { ok: true, status: 200, url, ms: 1, text, json, fromFixture: true };
      }
    }
    // Fall back to a routing file: fixtures/<dir>/routes.json maps URL substrings to files
    const routes = path.join(dir, 'routes.json');
    if (fs.existsSync(routes)) {
      try {
        const map = JSON.parse(fs.readFileSync(routes, 'utf8')) as Array<{ match: string; file: string; status?: number }>;
        for (const r of map) {
          if (url.includes(r.match) || new RegExp(r.match).test(url)) {
            const p = path.join(dir, r.file);
            const text = fs.readFileSync(p, 'utf8');
            let json: unknown;
            if (p.endsWith('.json')) {
              try {
                json = JSON.parse(text);
              } catch {
                json = undefined;
              }
            }
            const status = r.status ?? 200;
            return { ok: status >= 200 && status < 300, status, url, ms: 1, text, json, fromFixture: true };
          }
        }
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run promises with a concurrency limit. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Wrap a promise with a timeout; resolves to fallback on timeout. */
export async function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
