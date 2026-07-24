import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openDatabase, txStore, reqPromise } from '../src/local/idb.js';

describe('idb helper', () => {
  it('opens db, creates stores, round-trips a record', async () => {
    const db = await openDatabase('test-db', 1, (d) => {
      d.createObjectStore('items', { keyPath: 'id' });
    });
    const store = txStore(db, 'items', 'readwrite');
    await reqPromise(store.put({ id: 'a', v: 1 }));
    const got = await reqPromise(txStore(db, 'items', 'readonly').get('a')) as { id: string; v: number };
    expect(got.v).toBe(1);
    db.close();
    indexedDB.deleteDatabase('test-db');
  });
});
