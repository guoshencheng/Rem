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
        /**
         *  [{"content":"探索项目上下文(诗词相关的现有内容)","status":"completed","priority":"high"},{"content":"询问澄清问题:主题、情感、场景等","status":"completed","priority":"high"},{"content":"提出 2-3 种创作方向","status":"completed","priority":"medium"},{"content":"等待用户选择方向(雨后空山/暮色归田/春山新霁)","status":"in_progress","priority":"high"},{"content":"若需:提供该方向下的场景细节选项","status":"pending","priority":"medium"},{"content":"呈现设计(诗作方案)并获得用户批准","status":"pending","priority":"high"},{"content":"执行:创作并打磨诗作","status":"pending","priority":"high"},{"content":"交付成果(可选择归档到 docs/)","status":"pending","priority":"medium"}]
         */
      console.log(`Replaced todos for session ${sessionId}: ${todosJson}`);
      return todos;
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to replace todos for session ${sessionId}`);
    }
  }
}
