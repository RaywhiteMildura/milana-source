import type { Page } from '@playwright/test';

/** The keys of the meeting copies the page keeps on the phone (src/web/lib/saved.ts), without creating the store if there is none. */
export const savedKeysOnPhone = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open('racelens-saved');
        // Nothing saved yet: do not create the database (the app would then find it without its store).
        req.onupgradeneeded = () => req.transaction?.abort();
        req.onerror = () => resolve([]);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('copies')) {
            db.close();
            return resolve([]);
          }
          const keys = db.transaction('copies').objectStore('copies').getAllKeys();
          keys.onsuccess = () => {
            db.close();
            resolve(keys.result.map(String));
          };
          keys.onerror = () => {
            db.close();
            resolve([]);
          };
        };
      }),
  );
