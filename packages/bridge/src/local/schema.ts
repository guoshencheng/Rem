export const REM_AGENT_DB_VERSION = 2;

export const STORE_SESSIONS = 'sessions';
export const STORE_TODOS = 'todos';
export const STORE_RULES = 'rules';
export const STORE_ARCHIVES = 'archives';
export const STORE_WORKSPACES = 'workspaces';
export const STORE_CREDENTIAL = 'credential';

/** 幂等创建 rem-agent 数据库的全部 object store，供各打开方共用。 */
export function upgradeRemAgentDb(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
    const sessions = db.createObjectStore(STORE_SESSIONS, { keyPath: 'sessionId' });
    sessions.createIndex('workspace', 'workspace', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE_TODOS)) {
    db.createObjectStore(STORE_TODOS, { keyPath: 'sessionId' });
  }
  if (!db.objectStoreNames.contains(STORE_RULES)) {
    const rules = db.createObjectStore(STORE_RULES, { keyPath: 'id', autoIncrement: true });
    rules.createIndex('source', 'source', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE_ARCHIVES)) {
    const archives = db.createObjectStore(STORE_ARCHIVES, { keyPath: 'id' });
    archives.createIndex('sessionId', 'sessionId', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE_WORKSPACES)) {
    db.createObjectStore(STORE_WORKSPACES, { keyPath: 'path' });
  }
  if (!db.objectStoreNames.contains(STORE_CREDENTIAL)) {
    db.createObjectStore(STORE_CREDENTIAL);
  }
}
