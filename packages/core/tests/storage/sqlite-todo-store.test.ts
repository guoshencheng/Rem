import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteSchemaManager } from '../../src/storage/schema.js';
import { SqliteTodoStore } from '../../src/storage/sqlite/todo-store.js';
import type { TodoItem } from '../../src/todo/types.js';

describe('SqliteTodoStore', () => {
  let db: Database.Database;
  let store: SqliteTodoStore;

  beforeEach(() => {
    db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();
    db.prepare(
      `INSERT INTO sessions (id, workspace, pinned, current_turn, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('session-1', 'default', 0, 0, '{}', new Date().toISOString(), new Date().toISOString());
    store = new SqliteTodoStore(db);
  });

  it('returns empty list for new session', async () => {
    const todos = await store.getBySession('session-1');
    expect(todos).toEqual([]);
  });

  it('replaces todos in order', async () => {
    const todos: TodoItem[] = [
      { content: 'First', status: 'in_progress', priority: 'high' },
      { content: 'Second', status: 'pending', priority: 'medium' },
    ];
    await store.replaceForSession('session-1', todos);
    const result = await store.getBySession('session-1');
    expect(result).toEqual(todos);
  });

  it('deletes old todos on replace', async () => {
    await store.replaceForSession('session-1', [
      { content: 'Old', status: 'pending', priority: 'low' },
    ]);
    await store.replaceForSession('session-1', [
      { content: 'New', status: 'completed', priority: 'high' },
    ]);
    const result = await store.getBySession('session-1');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('New');
  });

  it('cascades delete with session', async () => {
    await store.replaceForSession('session-1', [
      { content: 'Task', status: 'pending', priority: 'low' },
    ]);
    db.prepare('DELETE FROM sessions WHERE id = ?').run('session-1');
    const result = await store.getBySession('session-1');
    expect(result).toEqual([]);
  });
});
