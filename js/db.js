/* IndexedDB layer — carried over from the v0.1 prototype architecture.
   Stores: captures (products), companies (one record per booth/factory/showroom), settings (key/value). */

const DB_NAME = 'milana-source';
const DB_VERSION = 2;

let _dbPromise;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, value) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
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
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClear(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function settingGet(key, fallback) {
  const row = await dbGet('settings', key);
  return row === undefined || row === null ? fallback : row.value;
}

async function settingSet(key, value) {
  return dbPut('settings', { key, value });
}
