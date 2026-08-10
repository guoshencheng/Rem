import type Database from 'better-sqlite3';
import type { Artifact } from '../../../domain/artifact/types.js';
import type { RuntimeArtifactRepository } from '../../../sdk/runtime-storage.js';
import type { RuntimeArtifactRow } from './runtime-row-types.js';
import { mapArtifactRow } from './runtime-row-mappers.js';
import { artifactToRow } from './runtime-row-serializers.js';
import { sqliteAction } from './runtime-sqlite-error.js';

export class SqliteRuntimeArtifactRepository implements RuntimeArtifactRepository {
  constructor(private readonly db: Database.Database) {}

  insert(artifact: Artifact): void {
    const row = artifactToRow(artifact);
    sqliteAction('inserting runtime artifact', () => this.db.prepare(`
      INSERT INTO runtime_artifacts
        (id, tenant_id, session_id, run_id, type, media_type, name, data, uri, metadata_json, created_at)
      VALUES (@id, @tenant_id, @session_id, @run_id, @type, @media_type, @name, @data, @uri, @metadata_json, @created_at)
    `).run(row));
  }

  listByRun(runId: string): Artifact[] {
    return sqliteAction('listing runtime artifacts', () => {
      const rows = this.db.prepare('SELECT * FROM runtime_artifacts WHERE run_id = ? ORDER BY created_at, id').all(runId) as RuntimeArtifactRow[];
      return rows.map(mapArtifactRow);
    });
  }
}
