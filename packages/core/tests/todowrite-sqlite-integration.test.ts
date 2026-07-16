import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { SqliteTodoStore } from '../src/plugins/storage/sqlite/todo-store.js';
import { SqliteSessionStore } from '../src/plugins/storage/sqlite/session-store.js';
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
      getToolSet: () => [],
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

    // 直接查数据库：一行 JSON
    const row = db.prepare('SELECT * FROM todos WHERE session_id = ?').get('sess-1') as any;
    expect(row).toBeDefined();
    expect(row.session_id).toBe('sess-1');
    const items = JSON.parse(row.todos_json);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ content: 'task 1', status: 'in_progress', priority: 'high' });

    // 通过 service 读
    const todos = await todoService.get('sess-1');
    expect(todos).toHaveLength(2);

    // 事件发布
    expect(published).toHaveLength(1);
    expect(published[0].type).toBe('todo-updated');

    db.close();
  });

  it('replaces entire list on each call', async () => {
    const db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();

    db.prepare(
      `INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sess-2', 'default', 'test', 0, 0, '{}', new Date().toISOString(), new Date().toISOString());

    const todoStore = new SqliteTodoStore(db);
    const todoService = new DefaultTodoService(todoStore);

    // 第一次写入
    await todoService.update('sess-2', [
      { content: 'task A', status: 'pending', priority: 'high' },
      { content: 'task B', status: 'pending', priority: 'medium' },
    ]);

    // 第二次写入：全量替换（删除 B，新增 C）
    await todoService.update('sess-2', [
      { content: 'task A updated', status: 'in_progress', priority: 'high' },
      { content: 'task C', status: 'pending', priority: 'low' },
    ]);

    const todos = await todoService.get('sess-2');
    expect(todos).toHaveLength(2);
    expect(todos[0].content).toBe('task A updated');
    expect(todos[1].content).toBe('task C');

    // 数据库中只有一行
    const rows = db.prepare('SELECT * FROM todos WHERE session_id = ?').all('sess-2');
    expect(rows).toHaveLength(1);

    db.close();
  });

  it('writes todos even when the session row does not exist yet', async () => {
    const db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();

    // 故意不插入 sessions 行：todowrite 不应因外键约束而丢失写入
    const todoStore = new SqliteTodoStore(db);
    const todoService = new DefaultTodoService(todoStore);

    await todoService.update('sess-orphan', [
      { content: 'task 1', status: 'in_progress', priority: 'high' },
    ]);

    const todos = await todoService.get('sess-orphan');
    expect(todos).toHaveLength(1);
    expect(todos[0].content).toBe('task 1');

    db.close();
  });

  it('removes todos when the session is deleted', async () => {
    const db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sess-del', 'default', 'test', 0, 0, '{}', now, now);

    const sessionStore = new SqliteSessionStore(db);
    const todoService = new DefaultTodoService(new SqliteTodoStore(db));

    await todoService.update('sess-del', [
      { content: 'task 1', status: 'pending', priority: 'high' },
    ]);
    expect(await todoService.get('sess-del')).toHaveLength(1);

    await sessionStore.delete('sess-del');
    expect(await todoService.get('sess-del')).toHaveLength(0);

    db.close();
  });
});
