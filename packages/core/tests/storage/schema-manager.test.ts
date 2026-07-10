import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { SqliteSchemaManager, CURRENT_SCHEMA_VERSION } from '../../src/storage/schema.js';

describe('SqliteSchemaManager', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'schema-test-'));
    dbPath = join(dir, 'test.db');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('should create tables and set schema version on fresh db', () => {
    const db = new Database(dbPath);
    const manager = new SqliteSchemaManager(db);
    manager.migrate();

    const version = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(version.version).toBe(CURRENT_SCHEMA_VERSION);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions', 'messages', 'rules')"
      )
      .all() as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual(['messages', 'rules', 'sessions']);

    db.close();
  });

  it('should be idempotent on repeated migrate calls', () => {
    const db = new Database(dbPath);
    const manager = new SqliteSchemaManager(db);
    manager.migrate();
    manager.migrate();

    const version = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(version.version).toBe(CURRENT_SCHEMA_VERSION);
    db.close();
  });

  it('should throw on unsupported schema version', () => {
    const db = new Database(dbPath);
    db.prepare('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)').run();
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(999);

    const manager = new SqliteSchemaManager(db);
    expect(() => manager.migrate()).toThrow('Unsupported schema version: 999');

    db.close();
  });
});
