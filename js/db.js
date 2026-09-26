/* IndexedDB layer — carried over from the v0.1 prototype architecture.
   Stores: captures (products), companies (one record per booth/factory/showroom), settings (key/value).

   Every write settles: a transaction that is ABORTED (how IndexedDB reports a
   full disk — QuotaExceededError arrives at commit time, without any request
   erroring) rejects instead of hanging the caller forever, and a watchdog
   rejects any write that has not completed in 20 s so the UI can never be
   left waiting on storage with no message. */

const DB_NAME = 'milana-source';
const DB_VERSION = 2;
const TX_WATCHDOG_MS = 20000;

let _dbPromise;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      _dbPromise = null;
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('captures')) {
        const store = db.createObjectStore('captures', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('companyKey', 'companyKey');
        store.createIndex('status', 'status');
        store.createIndex('category', 'category');
        store.createIndex('venue', 'venue');
      }
      if (!db.objectStoreNames.contains('companies')) {
        db.createObjectStore('companies', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onblocked = () => {
      _dbPromise = null;
      reject(new DOMException('Storage is open in another Milana window — close it and try again.', 'BlockedError'));
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab upgrading, or the browser closing the connection under
      // pressure: drop our handle so the next call reopens cleanly
      db.onversionchange = () => { try { db.close(); } catch (e) { /* already closed */ } _dbPromise = null; };
      db.onclose = () => { _dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { _dbPromise = null; reject(req.error || new Error('Could not open storage')); };
  });
  return _dbPromise;
}

/* True for the errors IndexedDB raises when the phone is out of space. */
function isQuotaError(err) {
  const name = err && err.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || /quota|disk|space/i.test(String(err && err.message || ''));
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Storage request failed'));
  });
}

/* Settle a transaction: complete → value; error/abort → the real error;
   silence past the watchdog → a clear error (and the transaction is aborted
   so it cannot commit later behind the user's back). */
function txDone(tx, value) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    const timer = setTimeout(() => {
      try { tx.abort(); } catch (e) { /* already finished */ }
      finish(reject, new DOMException('Saving took too long — the phone may be out of storage.', 'TimeoutError'));
    }, TX_WATCHDOG_MS);
    tx.oncomplete = () => finish(resolve, value);
    tx.onerror = () => finish(reject, tx.error || new Error('Storage write failed'));
    tx.onabort = () => finish(reject, tx.error || new DOMException('Storage write was aborted — the phone may be out of storage.', 'AbortError'));
  });
}

async function dbPut(storeName, value) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  return txDone(tx, value);
}

/* Several writes that must land together (or not at all), e.g. a capture
   plus clearing the in-progress draft. ops: {store, type: 'put'|'delete'|'clear', value?, key?} */
async function dbBatch(ops) {
  if (!ops.length) return;
  const db = await openDB();
  const stores = [...new Set(ops.map(o => o.store))];
  const tx = db.transaction(stores, 'readwrite');
  for (const op of ops) {
    const st = tx.objectStore(op.store);
    if (op.type === 'put') st.put(op.value);
    else if (op.type === 'delete') st.delete(op.key);
    else if (op.type === 'clear') st.clear();
  }
  return txDone(tx);
}

async function dbGet(storeName, key) {
  const db = await openDB();
  return reqP(db.transaction(storeName).objectStore(storeName).get(key));
}

async function dbAll(storeName) {
  const db = await openDB();
  return reqP(db.transaction(storeName).objectStore(storeName).getAll());
}

async function dbRemove(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  return txDone(tx);
}

async function dbClear(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  return txDone(tx);
}

async function settingGet(key, fallback) {
  const row = await dbGet('settings', key);
  return row === undefined || row === null ? fallback : row.value;
}

async function settingSet(key, value) {
  return dbPut('settings', { key, value });
}

async function settingRemove(key) {
  return dbRemove('settings', key);
}
