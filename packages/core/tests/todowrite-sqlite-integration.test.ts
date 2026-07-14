import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { SqliteTodoStore } from '../src/plugins/storage/sqlite/todo-store.js';
import { DefaultTodoService } from '../src/todo/service.js';
import { OverlayToolProvider } from '../src/overlay-tool-provider.js';
import {
  createTodoWriteToolDefinition,
  createTodoWriteToolExecutor,
} from '../src/plugins/tool/builtin/todo-write.js';

describe('todowrite → sqlite integration', () => {
  it('writes todos to sqlite via full executor path', async () => {
    const db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();

    // 插入一个 session（外键约束）
    db.prepare(
      `INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sess-1', 'default', 'test', 0, 0, '{}', new Date().toISOString(), new Date().toISOString());

    const todoStore = new SqliteTodoStore(db);
    const todoService = new DefaultTodoService(todoStore);

    const baseProvider = {
      getToolSet: () => ({}),
      register: () => {},
      execute: async () => [],
      isDangerous: () => false,
    } as any;

    const overlay = new OverlayToolProvider(baseProvider);
    const published: any[] = [];
    overlay.register(
      createTodoWriteToolDefinition(),
      createTodoWriteToolExecutor(todoService, (e) => published.push(e), '/tmp'),
    );

    // 模拟 LLM 调用 todowrite
    const results = await overlay.execute(
      [
        {
          toolCallId: 'call-1',
          toolName: 'todowrite',
          input: {
            todos: [
              { content: 'task 1', status: 'in_progress', priority: 'high' },
              { content: 'task 2', status: 'pending', priority: 'medium' },
            ],
          },
        },
      ],
      { sessionId: 'sess-1' } as any,
    );

    expect(results[0].error).toBeUndefined();

    // 直接查数据库
    const rows = db.prepare('SELECT * FROM todos WHERE session_id = ?').all('sess-1');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ content: 'task 1', status: 'in_progress', priority: 'high' });

    // 通过 service 读
    const todos = await todoService.get('sess-1');
    expect(todos).toHaveLength(2);

    // 事件发布
    expect(published).toHaveLength(1);
    expect(published[0].type).toBe('todo-updated');

    db.close();
  });
});
