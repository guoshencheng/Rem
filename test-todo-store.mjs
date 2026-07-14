import Database from 'better-sqlite3';
import { SqliteTodoStore } from './packages/core/src/plugins/storage/sqlite/todo-store.js';
import { SqliteSchemaManager } from './packages/core/src/plugins/storage/sqlite/schema.js';

const db = new Database(':memory:');
new SqliteSchemaManager(db).migrate();

const store = new SqliteTodoStore(db);

// 先插入一个 session（外键约束）
db.prepare(`INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  .run('test-session', 'default', 'test', 0, 0, '{}', new Date().toISOString(), new Date().toISOString());

await store.replaceForSession('test-session', [
  { content: 'task 1', status: 'in_progress', priority: 'high' },
  { content: 'task 2', status: 'pending', priority: 'medium' },
]);

const rows = await store.getBySession('test-session');
console.log('Rows:', rows);

const count = db.prepare('SELECT COUNT(*) as c FROM todos').get();
console.log('Count:', count);

db.close();
