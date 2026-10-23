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
  const fetch = async (r: string | { url: string }) => {
    const body = site[new URL(keyOf(r)).pathname];
    return body == null ? new Response('missing', { status: 404 }) : new Response(body, { status: 200 });
  };
  const handlers: Record<string, Handler> = {};
  const self = { location: { origin: ORIGIN }, addEventListener: (type: string, fn: Handler) => (handlers[type] = fn), skipWaiting: () => undefined, clients: { claim: async () => undefined } };
  vm.runInNewContext(SW_SOURCE, { self, caches, fetch, Response, URL, Promise, console });

  const dispatch = async (pathname: string, mode: 'navigate' | 'no-cors') => {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    handlers.fetch({ request: { method: 'GET', url: ORIGIN + pathname, mode }, respondWith: (p: Promise<Response>) => (response = p), waitUntil: (p: Promise<unknown>) => pending.push(p) });
    const res = await response!;
    await Promise.all(pending);
    await new Promise((r) => setTimeout(r, 0)); // let fire-and-forget cache.put calls land
    return res;
  };
  const shell = (hash: string) => `<!doctype html><html><head><script type="module" crossorigin src="/assets/index-${hash}.js"></script><link rel="stylesheet" crossorigin href="/assets/index-${hash}.css"></head><body><div id="root"></div></body></html>`;
  const deploy = (hash: string) => {
    site = { '/': shell(hash), [`/assets/index-${hash}.js`]: `js ${hash}`, [`/assets/index-${hash}.css`]: `css ${hash}` };
  };
  /** Open the app on the phone: the page, then its two hashed assets. */
  const openApp = async (hash: string) => {
    await dispatch('/', 'navigate');
    await dispatch(`/assets/index-${hash}.js`, 'no-cors');
    await dispatch(`/assets/index-${hash}.css`, 'no-cors');
  };
  const activate = async () => {
    const pending: Promise<unknown>[] = [];
    handlers.activate({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  };
  const cached = () => [...stores.values()].flatMap((s) => [...s.keys()].map((k) => new URL(k).pathname)).sort();
  return { stores, deploy, openApp, dispatch, activate, cached, setSite: (s: Record<string, string>) => (site = s) };
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

  it('serves the cached shell and assets offline, and keeps everything when the fresh page is not the app shell', async () => {
    const sw = boot();
    sw.deploy('aaa');
    await sw.openApp('aaa');
    sw.setSite({ '/': '<!doctype html><p>Bad gateway</p>' });
    await sw.dispatch('/', 'navigate');
    expect(sw.cached()).toEqual(['/assets/index-aaa.css', '/assets/index-aaa.js', '/index.html']);
    expect(await (await sw.dispatch('/assets/index-aaa.js', 'no-cors')).text()).toBe('js aaa');
  });

  it('drops caches written by an older version of the worker when it activates', async () => {
    const sw = boot();
    sw.stores.set('racelens-v1', new Map([[`${ORIGIN}/assets/index-old.js`, new Response('old')]]));
    sw.deploy('aaa');
    await sw.openApp('aaa');
    await sw.activate();
    expect([...sw.stores.keys()]).toEqual([expect.stringMatching(/^racelens-v\d+$/)]);
    expect([...sw.stores.keys()][0]).not.toBe('racelens-v1');
    expect(sw.cached()).toEqual(['/assets/index-aaa.css', '/assets/index-aaa.js', '/index.html']);
  });
});
