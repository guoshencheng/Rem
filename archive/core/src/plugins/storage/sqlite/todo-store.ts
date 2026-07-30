import Database from 'better-sqlite3';
import type { TodoItem } from '../../../todo/types.js';
import type { TodoStore } from '../../../sdk/storage-provider.js';
import { wrapSqliteError } from './errors.js';

export class SqliteTodoStore implements TodoStore {
  constructor(private db: Database.Database) {}

  async getBySession(sessionId: string): Promise<TodoItem[]> {
    try {
      const row = this.db
        .prepare('SELECT todos_json FROM todos WHERE session_id = ?')
        .get(sessionId) as { todos_json: string } | undefined;

      if (!row) return [];

      const items = JSON.parse(row.todos_json) as Array<{
        content: string;
        status: string;
        priority: string;
      }>;

      return items.map((item) => ({
        content: item.content,
        status: item.status as TodoItem['status'],
        priority: item.priority as TodoItem['priority'],
      }));
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to get todos for session ${sessionId}`);
    }
  }

  async replaceForSession(sessionId: string, todos: TodoItem[]): Promise<TodoItem[]> {
    try {
      const now = new Date().toISOString();
      const todosJson = JSON.stringify(
        todos.map((t) => ({ content: t.content, status: t.status, priority: t.priority })),
      );

      this.db
        .prepare(
          `INSERT INTO todos (session_id, todos_json, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             todos_json = excluded.todos_json,
             updated_at = excluded.updated_at`,
        )
        .run(sessionId, todosJson, now, now);
      return todos;
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to replace todos for session ${sessionId}`);
    }
  }
}
