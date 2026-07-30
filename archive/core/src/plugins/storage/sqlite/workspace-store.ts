import Database from 'better-sqlite3';
import type { WorkspaceRecord, WorkspaceStore } from '../../../sdk/storage-provider.js';
import { wrapSqliteError } from './errors.js';

interface WorkspaceRow {
  path: string;
  created_at: number;
}

export class SqliteWorkspaceStore implements WorkspaceStore {
  constructor(private db: Database.Database) {}

  async list(): Promise<WorkspaceRecord[]> {
    try {
      const rows = this.db
        .prepare('SELECT path, created_at FROM workspaces ORDER BY created_at ASC')
        .all() as WorkspaceRow[];
      return rows.map((r) => ({ path: r.path, createdAt: r.created_at }));
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', 'Failed to list workspaces');
    }
  }

  async add(path: string): Promise<WorkspaceRecord> {
    try {
      const existing = this.db
        .prepare('SELECT path, created_at FROM workspaces WHERE path = ?')
        .get(path) as WorkspaceRow | undefined;
      if (existing) {
        throw new Error(`Workspace already exists: ${path}`);
      }

      const createdAt = Date.now();
      this.db
        .prepare('INSERT INTO workspaces (path, created_at) VALUES (?, ?)')
        .run(path, createdAt);
      return { path, createdAt };
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) {
        throw err;
      }
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to add workspace ${path}`);
    }
  }

  async remove(path: string): Promise<void> {
    try {
      const result = this.db.prepare('DELETE FROM workspaces WHERE path = ?').run(path);
      if (result.changes === 0) {
        throw new Error(`Workspace not found: ${path}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        throw err;
      }
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to remove workspace ${path}`);
    }
  }
}
