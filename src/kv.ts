/* A very small IndexedDB key/value store.
 *
 * Shared by the artwork library (which keeps a folder handle and thumbnails)
 * and the design store (drafts and saved designs). IndexedDB rather than
 * localStorage for two reasons that both matter here: it holds structured
 * clones, which is the only way a FileSystemDirectoryHandle survives a refresh
 * at all, and it is not capped at the few megabytes localStorage gives you,
 * which thumbnails would eat.
 */

const DB_NAME = "studioland-studio";
const STORE = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function kvDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Every key starting with `prefix`. */
export async function kvKeys(prefix: string): Promise<string[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
    req.onsuccess = () =>
      resolve((req.result as IDBValidKey[]).map(String).filter((k) => k.startsWith(prefix)));
    req.onerror = () => reject(req.error);
  });
}
