import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { SqliteSchemaManager } from '../../src/storage/schema.js';
import { SqliteRuleStore } from '../../src/storage/sqlite/rule-store.js';

describe('SqliteRuleStore', () => {
  let dir: string;
  let db: Database.Database;
  let store: SqliteRuleStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sqlite-rule-test-'));
    db = new Database(join(dir, 'test.db'));
    new SqliteSchemaManager(db).migrate();
    store = new SqliteRuleStore(db);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('should load all rules including sources', async () => {
    await store.saveApproved({ permission: 'read', pattern: '**', action: 'allow' });
    await store.saveApproved({ permission: 'write', pattern: '/tmp/**', action: 'deny' });

    const all = await store.loadAll();
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.source === 'approved')).toBe(true);
  });

  it('should deduplicate approved rules', async () => {
    await store.saveApproved({ permission: 'read', pattern: '**', action: 'allow' });
    await store.saveApproved({ permission: 'read', pattern: '**', action: 'allow' });

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
  });

  it('should load by source', async () => {
    await store.saveApproved({ permission: 'read', pattern: '**', action: 'allow' });

    const approved = await store.loadBySource('approved');
    expect(approved).toHaveLength(1);

    const user = await store.loadBySource('user-config');
    expect(user).toHaveLength(0);
  });

  it('should not persist default source rules', async () => {
    // loadAll only returns user-config and approved
    const all = await store.loadAll();
    expect(all.every((r) => r.source !== 'default')).toBe(true);
  });
});
