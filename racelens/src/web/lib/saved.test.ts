/**
 * The phone's saved copies (lib/saved.ts) against a small in-memory IndexedDB
 * whose connection can be lost the way iOS loses it while the app sits in the
 * background: the copies must keep updating on a new connection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Req {
  result?: unknown;
  error?: unknown;
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
}

const later = (fn: () => void) => void setTimeout(fn, 0);

function fakeIndexedDB() {
  const rows = new Map<string, unknown>();
  const conns: Array<{ closed: boolean; onclose: (() => void) | null }> = [];
  let created = false;
  /** The next transaction fails with this (and its connection is gone). */
  let nextTxError: DOMException | null = null;

  const connection = () => {
    const db = {
      closed: false,
      onclose: null as (() => void) | null,
      onversionchange: null as (() => void) | null,
      objectStoreNames: { contains: (name: string) => created && name === 'copies' },
      createObjectStore: () => ((created = true), { createIndex: () => undefined }),
      close: () => void (db.closed = true),
      transaction: () => {
        if (db.closed) throw new DOMException('The database connection is closing.', 'InvalidStateError');
        const fail = nextTxError;
        nextTxError = null;
        if (fail?.name === 'UnknownError') db.closed = true;
        const tx: { error: unknown; oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore: () => unknown } = { error: null, objectStore: () => store };
        const request = (run: () => unknown) => {
          const req: Req = {};
          later(() => {
            if (fail) return (req.error = fail), req.onerror?.();
            req.result = run();
            req.onsuccess?.();
          });
          return req;
        };
        const store = {
          put: (row: { key: string }) => request(() => rows.set(row.key, structuredClone(row))),
          get: (key: string) => request(() => rows.get(key)),
          count: () => request(() => rows.size),
          clear: () => request(() => rows.clear()),
          delete: (key: string) => request(() => rows.delete(key)),
          index: () => ({ openKeyCursor: () => request(() => null) }),
        };
        later(() => later(() => (fail ? ((tx.error = fail), tx.onabort?.()) : tx.oncomplete?.())));
        return tx;
      },
    };
    conns.push(db);
    return db;
  };

  const idb = {
    opens: 0,
    open: () => {
      idb.opens += 1;
      const req: Req = {};
      later(() => {
        req.result = connection();
        if (!created) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
    deleteDatabase: () => undefined,
    /** iOS drops every connection of the backgrounded app – telling the page (a close event) or not. */
    lose: (closeEvent: boolean) => {
      for (const c of conns) {
        c.closed = true;
        if (closeEvent) c.onclose?.();
      }
    },
    failNextTransaction: (name: 'UnknownError' | 'QuotaExceededError') =>
      void (nextTxError = new DOMException(name === 'UnknownError' ? 'Connection to Indexed Database server lost. Refresh the page to try again' : 'The quota has been exceeded.', name)),
  };
  return idb;
}

let idb: ReturnType<typeof fakeIndexedDB>;
let saved: typeof import('./saved');

beforeEach(async () => {
  idb = fakeIndexedDB();
  vi.stubGlobal('indexedDB', idb);
  vi.resetModules();
  saved = await import('./saved');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saved copies when iOS closes the database in the background', () => {
  it('keeps saving and reading on a new connection after a close event', async () => {
    await saved.saveCopy('packs', ['morning']);
    idb.lose(true);
    await saved.saveCopy('packs', ['afternoon']);
    expect((await saved.readCopy('packs'))?.data).toEqual(['afternoon']);
    expect(idb.opens).toBe(2);
  });

  it('reopens at once when the connection turns out dead without one (InvalidStateError)', async () => {
    await saved.saveCopy('packs', ['morning']);
    idb.lose(false);
    expect((await saved.readCopy('packs'))?.data).toEqual(['morning']);
    await saved.saveCopy('packs', ['afternoon']);
    expect((await saved.readCopy('packs'))?.data).toEqual(['afternoon']);
    expect(await saved.hasSavedCopies()).toBe(true);
    expect(idb.opens).toBe(2);
  });

  it('reopens after "Connection to Indexed Database server lost" (UnknownError), but not for other failures', async () => {
    await saved.saveCopy('packs', ['morning']);
    idb.failNextTransaction('UnknownError');
    await saved.saveCopy('packs', ['afternoon']);
    expect((await saved.readCopy('packs'))?.data).toEqual(['afternoon']);
    expect(idb.opens).toBe(2);

    // Storage full: no saved copy this time, and no reason to reopen.
    idb.failNextTransaction('QuotaExceededError');
    await saved.saveCopy('packs', ['evening']);
    expect((await saved.readCopy('packs'))?.data).toEqual(['afternoon']);
    expect(idb.opens).toBe(2);
  });
});
