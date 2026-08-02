import type Database from 'better-sqlite3';
import { AGENT_DDL } from './agent-ddl.js';
import { DELIVERY_DDL } from './delivery-ddl.js';

export function migrateAgentIdentity(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(agent_threads)').all() as { name: string }[];
  if (!columns.some(({ name }) => name === 'agent_profile_id')) {
    db.exec(DELIVERY_DDL);
    return;
  }
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => rebuildAgentTables(db))();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) throw new Error('Foreign key check failed after schema v11 migration');
}

function rebuildAgentTables(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_agent_threads_primary;
    DROP INDEX IF EXISTS idx_agent_threads_organizer;
    DROP INDEX IF EXISTS idx_agent_threads_persistent_profile;
    CREATE TABLE agent_threads_v11 (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_id TEXT NOT NULL,
      role TEXT NOT NULL, lifecycle TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    INSERT INTO agent_threads_v11
      SELECT id, session_id,
        CASE agent_profile_id WHEN 'default-primary' THEN 'default' ELSE agent_profile_id END,
        role, lifecycle, created_at, updated_at
      FROM agent_threads;
    DROP TABLE agent_threads;
    ALTER TABLE agent_threads_v11 RENAME TO agent_threads;
  `);
  db.exec(AGENT_DDL);
  db.exec(DELIVERY_DDL);
  db.exec('DROP TABLE IF EXISTS agent_profiles;');
}
