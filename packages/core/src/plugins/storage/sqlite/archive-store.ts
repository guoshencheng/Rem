import Database from 'better-sqlite3';
import type { ArchiveRecord, ArchiveStore } from '../../../sdk/storage-provider.js';
import type { ModelMessage, LanguageModelUsage } from '../../../types.js';
import { wrapSqliteError } from './errors.js';

interface ArchiveRow {
  id: string;
  session_id: string;
  compressed_at: string;
  version: number;
  parent_archive_id: string | null;
  conversation_snapshot: string;
  summary: string;
  token_usage_before: string | null;
  token_usage_after: string | null;
  metadata: string | null;
}

export class SqliteArchiveStore implements ArchiveStore {
  constructor(private db: Database.Database) {}

  async save(record: ArchiveRecord): Promise<void> {
    try {
      this.db
        .prepare(
          `INSERT INTO archived_messages
            (id, session_id, compressed_at, version, parent_archive_id,
             conversation_snapshot, summary, token_usage_before, token_usage_after, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          record.sessionId,
          record.compressedAt.toISOString(),
          record.version,
          record.parentArchiveId ?? null,
          JSON.stringify(record.conversationSnapshot),
          record.summary,
          record.tokenUsageBefore ? JSON.stringify(record.tokenUsageBefore) : null,
          record.tokenUsageAfter ? JSON.stringify(record.tokenUsageAfter) : null,
          record.metadata ? JSON.stringify(record.metadata) : null,
        );
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to save archive ${record.id}`);
    }
  }

  async get(id: string): Promise<ArchiveRecord | null> {
    try {
      const row = this.db
        .prepare('SELECT * FROM archived_messages WHERE id = ?')
        .get(id) as ArchiveRow | undefined;
      return row ? this.toRecord(row) : null;
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to get archive ${id}`);
    }
  }

  async listBySession(sessionId: string): Promise<ArchiveRecord[]> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM archived_messages WHERE session_id = ? ORDER BY version ASC')
        .all(sessionId) as ArchiveRow[];
      return rows.map((r) => this.toRecord(r));
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to list archives for ${sessionId}`);
    }
  }

  async getLatest(sessionId: string): Promise<ArchiveRecord | null> {
    try {
      const row = this.db
        .prepare(
          'SELECT * FROM archived_messages WHERE session_id = ? ORDER BY version DESC LIMIT 1',
        )
        .get(sessionId) as ArchiveRow | undefined;
      return row ? this.toRecord(row) : null;
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to get latest archive for ${sessionId}`);
    }
  }

  private toRecord(row: ArchiveRow): ArchiveRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      compressedAt: new Date(row.compressed_at),
      version: row.version,
      parentArchiveId: row.parent_archive_id ?? undefined,
      conversationSnapshot: JSON.parse(row.conversation_snapshot) as ModelMessage[],
      summary: row.summary,
      tokenUsageBefore: row.token_usage_before
        ? (JSON.parse(row.token_usage_before) as LanguageModelUsage)
        : undefined,
      tokenUsageAfter: row.token_usage_after
        ? (JSON.parse(row.token_usage_after) as LanguageModelUsage)
        : undefined,
      metadata: row.metadata
        ? (JSON.parse(row.metadata) as Record<string, unknown>)
        : undefined,
    };
  }
}
