/**
 * Runs the real service worker (src/web/public/sw.js) against an in-memory
 * Cache Storage and fake network, across several "deploys".
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://racelens.test';
const SW_SOURCE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/sw.js'), 'utf8');

type Handler = (event: unknown) => void;

const typeOf = (pathname: string) => (pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');

function boot() {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
  const openCache = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (r: string | { url: string }) => store.get(keyOf(r))?.clone(),
      put: async (r: string | { url: string }, res: Response) => void store.set(keyOf(r), res),
      delete: async (r: string | { url: string }) => store.delete(keyOf(r)),
      keys: async () => [...store.keys()].map((url) => ({ url })),
    };
  };
  const caches = {
    open: async (name: string) => openCache(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  let site: Record<string, string> = {};
  /** What stands in front of RaceLens answers instead (Tailscale Serve while the Mac restarts it), or 'down' for no network at all. */
  let front: { status: number; body: string } | 'down' | 'stalled' | null = null;
  const fetch = async (r: string | { url: string }) => {
    if (front === 'down') throw new TypeError('Load failed');
    if (front === 'stalled') return new Promise<Response>(() => undefined);
    if (front) return new Response(front.body, { status: front.status, headers: { 'Content-Type': 'text/plain' } });
    const pathname = new URL(keyOf(r)).pathname;
    const body = site[pathname];
    // Like the real server: any path it has no file for gets the app's index.html.
    if (body == null) return site['/'] == null ? new Response('missing', { status: 404 }) : new Response(site['/'], { status: 200, headers: { 'Content-Type': typeOf('/') } });
    return new Response(body, { status: 200, headers: { 'Content-Type': typeOf(pathname) } });
  };
  const timers: Array<() => void> = [];
  const handlers: Record<string, Handler> = {};
  const self = { location: { origin: ORIGIN }, addEventListener: (type: string, fn: Handler) => (handlers[type] = fn), skipWaiting: () => undefined, clients: { claim: async () => undefined } };
  vm.runInNewContext(SW_SOURCE, { self, caches, fetch, Response, URL, Promise, Symbol, console, setTimeout: (fn: () => void) => timers.push(fn) });

  const settle = () => new Promise((r) => setTimeout(r, 0));
  const dispatch = async (pathname: string, mode: 'navigate' | 'no-cors', opts: { fireTimers?: boolean } = {}) => {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    handlers.fetch({ request: { method: 'GET', url: ORIGIN + pathname, mode }, respondWith: (p: Promise<Response>) => (response = p), waitUntil: (p: Promise<unknown>) => pending.push(p) });
    if (opts.fireTimers) {
      await settle();
      timers.splice(0).forEach((fn) => fn());
    }
    const res = await response!;
    await Promise.all(pending);
    await settle(); // let fire-and-forget cache.put calls land
    return res;
  };
  const shell = (hash: string) => `<!doctype html><html><head><script type="module" crossorigin src="/assets/index-${hash}.js"></script><link rel="stylesheet" crossorigin href="/assets/index-${hash}.css"></head><body><div id="root"></div></body></html>`;
  const deploy = (hash: string) => {
    front = null;
    site = { '/': shell(hash), [`/assets/index-${hash}.js`]: `js ${hash}`, [`/assets/index-${hash}.css`]: `css ${hash}` };
  };
  /** Open the app on the phone: the page, then its two hashed assets. */
  const openApp = async (hash: string) => {
    await dispatch('/', 'navigate');
    await dispatch(`/assets/index-${hash}.js`, 'no-cors');
    await dispatch(`/assets/index-${hash}.css`, 'no-cors');
  };
  const lifecycle = (type: 'install' | 'activate') => async () => {
    const pending: Promise<unknown>[] = [];
    handlers[type]({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  };
  const install = lifecycle('install');
  const activate = lifecycle('activate');
  const cached = () => [...stores.values()].flatMap((s) => [...s.keys()].map((k) => new URL(k).pathname)).sort();
  /** What the v2 worker had kept in its cache: the page it last opened under /index.html, and any good answer for an asset (HTML too). */
  const v2Kept = (entries: Record<string, { body: string; type: string }>) =>
    stores.set('racelens-v2', new Map(Object.entries(entries).map(([p, e]) => [`${ORIGIN}${p}`, new Response(e.body, { status: 200, headers: { 'Content-Type': e.type } })])));
  return { stores, deploy, openApp, dispatch, install, activate, cached, shell, v2Kept, setSite: (s: Record<string, string>) => (site = s), setFront: (f: typeof front) => (front = f) };
}

describe('service worker', () => {
  it('keeps only the current deploy’s hashed assets (plus the offline shell) across deploys', async () => {
    const sw = boot();
    for (const hash of ['aaa', 'bbb', 'ccc', 'ddd']) {
      sw.deploy(hash);
      await sw.openApp(hash);
    }
    expect(sw.cached()).toEqual(['/assets/index-ddd.css', '/assets/index-ddd.js', '/index.html']);
  });

  it('serves the cached shell and assets offline, and a fresh page that is not the app shell (a Wi-Fi login page) does not replace it', async () => {
    const sw = boot();
    sw.deploy('aaa');
    await sw.openApp('aaa');
    sw.setSite({ '/': '<!doctype html><p>Sign in to the Wi-Fi</p>' });
    expect(await (await sw.dispatch('/', 'navigate')).text()).toContain('Sign in to the Wi-Fi');
    expect(sw.cached()).toEqual(['/assets/index-aaa.css', '/assets/index-aaa.js', '/index.html']);
    sw.setFront('down');
    expect(await (await sw.dispatch('/', 'navigate')).text()).toBe(sw.shell('aaa'));
    expect(await (await sw.dispatch('/assets/index-aaa.js', 'no-cors')).text()).toBe('js aaa');
  });

  it('opens the cached shell, not the error page, while Tailscale Serve answers 502 (or 404/421)', async () => {
    const sw = boot();
    sw.deploy('aaa');
    await sw.openApp('aaa');
    for (const status of [502, 503, 500, 404, 421]) {
      sw.setFront({ status, body: 'Bad Gateway' });
      const res = await sw.dispatch('/', 'navigate');
      expect(res.status, String(status)).toBe(200);
      expect(await res.text()).toBe(sw.shell('aaa'));
    }
    expect(sw.cached()).toEqual(['/assets/index-aaa.css', '/assets/index-aaa.js', '/index.html']);
  });

  it('passes the error page through when this phone has no cached shell yet, and says it is offline with a Try again button', async () => {
    const sw = boot();
    sw.setFront({ status: 502, body: 'Bad Gateway' });
    const res = await sw.dispatch('/', 'navigate');
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('Bad Gateway');

    sw.setFront('down');
    const offline = await sw.dispatch('/', 'navigate');
    expect(offline.status).toBe(503);
    expect(await offline.text()).toMatch(/Try again/);
  });

  it('opens the cached shell when the network stalls instead of waiting for the browser to give up', async () => {
    const sw = boot();
    sw.deploy('aaa');
    await sw.openApp('aaa');
    sw.setFront('stalled');
    const res = await sw.dispatch('/', 'navigate', { fireTimers: true });
    expect(await res.text()).toBe(sw.shell('aaa'));
  });

  it('never caches an HTML page served for a missing asset (it would blank the app for good)', async () => {
    const sw = boot();
    sw.deploy('bbb');
    // A page from the old deploy asks for its bundle; the server answers with index.html.
    const res = await sw.dispatch('/assets/index-aaa.js', 'no-cors');
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    expect(sw.cached()).toEqual([]);
    await sw.openApp('bbb');
    expect(sw.cached()).toEqual(['/assets/index-bbb.css', '/assets/index-bbb.js', '/index.html']);
  });

  it('drops caches written by an older version of the worker when it activates', async () => {
    const sw = boot();
    sw.stores.set('racelens-v2', new Map([[`${ORIGIN}/assets/index-old.js`, new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })]]));
    sw.deploy('aaa');
    await sw.openApp('aaa');
    await sw.activate();
    expect([...sw.stores.keys()]).toEqual([expect.stringMatching(/^racelens-v\d+$/)]);
    expect([...sw.stores.keys()][0]).not.toBe('racelens-v2');
    expect(sw.cached()).toEqual(['/assets/index-aaa.css', '/assets/index-aaa.js', '/index.html']);
  });

  describe('updating from the v2 worker', () => {
    const html = 'text/html; charset=utf-8';
    const js = 'text/javascript; charset=utf-8';
    const css = 'text/css; charset=utf-8';

    it('still opens offline: v2 kept the app (N1), this version installs with no signal and activates, the next launch (N2) has no signal', async () => {
      const sw = boot();
      sw.deploy('aaa');
      // N1, served by v2: it kept the page and the assets – and, from an older deploy, an HTML page under an asset's name.
      sw.v2Kept({
        '/index.html': { body: sw.shell('aaa'), type: html },
        '/assets/index-aaa.js': { body: 'js aaa', type: js },
        '/assets/index-aaa.css': { body: 'css aaa', type: css },
        '/assets/index-old.js': { body: '<!doctype html>', type: html },
      });
      // The browser's update check after N1 finds this worker; the signal drops before install can fetch anything.
      sw.setFront('down');
      await sw.install();
      await sw.activate();
      expect([...sw.stores.keys()]).toEqual(['racelens-v3']);
      expect(sw.cached()).toEqual(['/assets/index-aaa.css', '/assets/index-aaa.js', '/index.html']);

      // N2: a cold launch at the track with no signal opens the app (which then shows the meetings saved on the phone).
      const res = await sw.dispatch('/', 'navigate');
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(sw.shell('aaa'));
      expect(await (await sw.dispatch('/assets/index-aaa.js', 'no-cors')).text()).toBe('js aaa');
      expect(await (await sw.dispatch('/assets/index-aaa.css', 'no-cors')).text()).toBe('css aaa');
    });

    it('keeps the current shell and assets at install, so N2 opens offline even when v2 had not finished keeping N1’s assets', async () => {
      const sw = boot();
      sw.deploy('bbb');
      // v2 kept the new page, but the bundle it was still downloading never made it into its cache.
      sw.v2Kept({ '/index.html': { body: sw.shell('bbb'), type: html }, '/assets/index-aaa.js': { body: 'js aaa', type: js } });
      await sw.install();
      await sw.activate();
      expect(sw.cached()).toEqual(['/assets/index-bbb.css', '/assets/index-bbb.js', '/index.html']);
      sw.setFront('down');
      expect(await (await sw.dispatch('/', 'navigate')).text()).toBe(sw.shell('bbb'));
      expect(await (await sw.dispatch('/assets/index-bbb.js', 'no-cors')).text()).toBe('js bbb');
    });

    it('carries over no Wi-Fi page and no shell whose script is missing (that would open a blank app): the offline page says so instead', async () => {
      const wifi = boot();
      wifi.v2Kept({ '/index.html': { body: '<!doctype html><p>Sign in to the Wi-Fi</p>', type: html } });
      wifi.setFront('down');
      await wifi.install();
      await wifi.activate();
      expect(wifi.cached()).toEqual([]);

      const sw = boot();
      sw.v2Kept({
        '/index.html': { body: sw.shell('aaa'), type: html },
        '/assets/index-aaa.js': { body: '<!doctype html>', type: html },
        '/assets/index-aaa.css': { body: 'css aaa', type: css },
      });
      sw.setFront({ status: 502, body: 'Bad Gateway' });
      await sw.install();
      await sw.activate();
      expect(sw.cached()).toEqual(['/assets/index-aaa.css']);
      sw.setFront('down');
      const res = await sw.dispatch('/', 'navigate');
      expect(res.status).toBe(503);
      expect(await res.text()).toMatch(/Try again/);
    });
  });
});
