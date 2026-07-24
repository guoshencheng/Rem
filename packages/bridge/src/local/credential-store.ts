import { openDatabase, reqPromise, txStore } from './idb.js';
import { REM_AGENT_DB_VERSION, STORE_CREDENTIAL, upgradeRemAgentDb } from './schema.js';

export interface ProviderCredential {
  provider: string;
  apiKey: string;
  model?: string;
  baseURL?: string;
}

const KEY = 'active';

export class CredentialStore {
  constructor(private dbName = 'rem-agent') {}

  private async db(): Promise<IDBDatabase> {
    return openDatabase(this.dbName, REM_AGENT_DB_VERSION, upgradeRemAgentDb);
  }

  async load(): Promise<ProviderCredential | null> {
    const db = await this.db();
    try {
      const v = await reqPromise(txStore(db, STORE_CREDENTIAL, 'readonly').get(KEY));
      return (v as ProviderCredential | undefined) ?? null;
    } finally {
      db.close();
    }
  }

  async save(credential: ProviderCredential): Promise<void> {
    const db = await this.db();
    try {
      await reqPromise(txStore(db, STORE_CREDENTIAL, 'readwrite').put(credential, KEY));
    } finally {
      db.close();
    }
  }

  async clear(): Promise<void> {
    const db = await this.db();
    try {
      await reqPromise(txStore(db, STORE_CREDENTIAL, 'readwrite').delete(KEY));
    } finally {
      db.close();
    }
  }
}
