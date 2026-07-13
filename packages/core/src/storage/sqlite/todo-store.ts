import Database from 'better-sqlite3';
import type { TodoItem } from '../../todo/types.js';
import type { TodoStore } from '../types.js';
import { wrapSqliteError } from '../errors.js';

export class SqliteTodoStore implements TodoStore {
  constructor(private db: Database.Database) {}

  async getBySession(sessionId: string): Promise<TodoItem[]> {
    try {
      const rows = this.db
        .prepare(
          `SELECT content, status, priority
           FROM todos
           WHERE session_id = ?
           ORDER BY position ASC`,
        )
        .all(sessionId) as Array<{
        content: string;
        status: string;
        priority: string;
      }>;
      return rows.map((row) => ({
        content: row.content,
        status: row.status as TodoItem['status'],
        priority: row.priority as TodoItem['priority'],
      }));
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to get todos for session ${sessionId}`);
    }
  }

  async replaceForSession(sessionId: string, todos: TodoItem[]): Promise<void> {
    const transaction = this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db.prepare('DELETE FROM todos WHERE session_id = ?').run(sessionId);
      if (todos.length === 0) return;
      const insert = this.db.prepare(
        `INSERT INTO todos (session_id, position, content, status, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (let i = 0; i < todos.length; i++) {
        const todo = todos[i];
        insert.run(sessionId, i, todo.content, todo.status, todo.priority, now, now);
      }
    });

    try {
      transaction();
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to replace todos for session ${sessionId}`);
    }
  }
}
