/** 原生 IndexedDB 的极简 promise 封装，无第三方依赖。 */

export function reqPromise<T = unknown>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export function openDatabase(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(`Failed to open IndexedDB "${name}"`));
  });
}

export function txStore(db: IDBDatabase, store: string, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store);
}

export async function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return reqPromise(txStore(db, store, 'readonly').getAll()) as Promise<T[]>;
}

export async function getAllByIndex<T>(db: IDBDatabase, store: string, index: string, key: IDBValidKey): Promise<T[]> {
  return reqPromise(txStore(db, store, 'readonly').index(index).getAll(key)) as Promise<T[]>;
}
