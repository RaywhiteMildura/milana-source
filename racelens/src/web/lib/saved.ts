/**
 * The phone's own copy of the researched meetings: the last good
 * GET /api/packs (the list) and each GET /api/packs/:id, kept in IndexedDB
 * (a meeting is about 1 MB – too big for localStorage) so that a stalled
 * connection at the track still shows the picks researched that morning,
 * clearly labelled as a saved copy (useRequest's `savedKey`, SavedCopyBanner).
 *
 * Only those two reads are ever kept – never the login, health, settings or
 * anything written – and the copies never outlive this device's sign-in: they
 * are cleared on Sign out and whenever the server says the device is signed out.
 *
 * Page code rather than the service worker: the page knows what it shows, can
 * label it, retry and clear it; the worker never touches /api. Every call fails
 * soft (private mode, storage full, no IndexedDB): there is then no saved copy.
 */

const DB_NAME = 'racelens-saved';
const STORE = 'copies';
/** Meetings kept on the phone; the ones saved longest ago beyond this are dropped. */
const KEEP_PACKS = 8;

export const savedKeys = {
  packList: 'packs',
  pack: (id: string) => `pack:${id}`,
};

export interface SavedCopy<T> {
  data: T;
  /** When this device received it (ISO) */
  savedAt: string;
}

interface Row {
  key: string;
  savedAt: string;
  data: unknown;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
/** Bumped by clearSaved(): an answer that was still on its way then is not saved afterwards. */
let generation = 0;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  const p = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          // Created by something else without our store: start again next time.
          db.close();
          indexedDB.deleteDatabase(DB_NAME);
          return resolve(null);
        }
        db.onversionchange = () => {
          db.close();
          if (dbPromise === p) dbPromise = null;
        };
        // iOS closes the connection of an app left in the background: open a new one next time, or the copies stop updating.
        db.onclose = () => {
          if (dbPromise === p) dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  dbPromise = p;
  // A failed open is tried again on the next call.
  void p.then((db) => {
    if (!db && dbPromise === p) dbPromise = null;
  });
  return p;
}

/** The connection died under us (iOS: InvalidStateError from transaction(), or UnknownError "Connection to Indexed Database server lost"). */
const isDeadConnection = (e: unknown): boolean => {
  const name = (e as { name?: unknown } | null)?.name;
  return name === 'InvalidStateError' || name === 'UnknownError';
};

/**
 * Run `fn` on the database (null when there is none). A connection found dead
 * is dropped, so the next call opens a new one, and `fn` gets one more go on it.
 */
async function withDb<T>(fn: (db: IDBDatabase | null) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const conn = openDb();
    try {
      return await fn(await conn);
    } catch (e) {
      if (!isDeadConnection(e)) throw e;
      if (dbPromise === conn) {
        dbPromise = null;
        void conn.then((db) => db?.close());
      }
      if (attempt > 0) throw e;
    }
  }
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function answer<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Pass to saveCopy() with an answer that was asked for now, so a sign-out meanwhile wins. */
export function savedGeneration(): number {
  return generation;
}

/** Keep `data` as the latest good copy for `key`. */
export async function saveCopy(key: string, data: unknown, gen = generation): Promise<void> {
  try {
    await withDb(async (db) => {
      if (!db || gen !== generation) return;
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put({ key, savedAt: new Date().toISOString(), data } satisfies Row);
      if (key.startsWith('pack:')) {
        // Newest first (this one included): drop the meetings beyond KEEP_PACKS.
        let kept = 0;
        const cursor = store.index('savedAt').openKeyCursor(null, 'prev');
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          if (String(c.primaryKey).startsWith('pack:') && ++kept > KEEP_PACKS) store.delete(c.primaryKey);
          c.continue();
        };
      }
      await finished(tx);
    });
  } catch {
    /* no saved copy this time */
  }
}

export async function readCopy<T>(key: string): Promise<SavedCopy<T> | null> {
  try {
    const row = await withDb(async (db) => (db ? answer<Row | undefined>(db.transaction(STORE).objectStore(STORE).get(key)) : undefined));
    return row ? { data: row.data as T, savedAt: row.savedAt } : null;
  } catch {
    return null;
  }
}

export async function dropCopy(key: string): Promise<void> {
  try {
    await withDb(async (db) => {
      if (!db) return;
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      await finished(tx);
    });
  } catch {
    /* nothing to drop */
  }
}

export async function hasSavedCopies(): Promise<boolean> {
  try {
    return await withDb(async (db) => (db ? (await answer(db.transaction(STORE).objectStore(STORE).count())) > 0 : false));
  } catch {
    return false;
  }
}

/** Forget every saved copy (Sign out, or the server says this device is signed out). */
export async function clearSaved(): Promise<void> {
  generation += 1;
  try {
    await withDb(async (db) => {
      if (!db) return;
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await finished(tx);
    });
  } catch {
    /* nothing to clear */
  }
}
