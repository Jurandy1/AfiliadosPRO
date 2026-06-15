const DB_NAME = "AfiliaDb";
const DB_VERSION = 1;
const STORE_NAME = "periodCache";

let dbPromise = null;

function initDB() {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.resolve(null);
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.warn("Erro ao abrir IndexedDB. Cache local offline desativado.");
        resolve(null);
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  }
  return dbPromise;
}

export async function idbGet(key) {
  const db = await initDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch (err) {
      resolve(null);
    }
  });
}

export async function idbSet(key, val) {
  const db = await initDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(val, key);

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch (err) {
      resolve();
    }
  });
}

export async function idbClear() {
  const db = await initDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch (err) {
      resolve();
    }
  });
}
