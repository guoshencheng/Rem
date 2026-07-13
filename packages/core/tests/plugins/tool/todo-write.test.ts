import { describe, it, expect } from 'vitest';
import { createTodoWriteToolExecutor } from '../../../src/plugins/tool/builtin/todo-write.js';
import { DefaultTodoService } from '../../../src/todo/service.js';
import type { TodoItem, TodoStore, BusEvent } from '../../../src/index.js';

class MemoryTodoStore implements TodoStore {
  private data = new Map<string, TodoItem[]>();

  async getBySession(sessionId: string): Promise<TodoItem[]> {
    return this.data.get(sessionId) ?? [];
  }

  async replaceForSession(sessionId: string, todos: TodoItem[]): Promise<void> {
    this.data.set(sessionId, todos);
  }
}

describe('todowrite tool', () => {
  it('updates todos and publishes event', async () => {
    const store = new MemoryTodoStore();
    const service = new DefaultTodoService(store);
    const events: BusEvent[] = [];
    const executor = createTodoWriteToolExecutor(
      service,
      (event) => events.push(event),
      'ws',
    );

    const todos: TodoItem[] = [
      { content: 'Task 1', status: 'in_progress', priority: 'high' },
    ];
    const result = await executor({ todos }, { cwd: '/tmp', workspaceRoot: '/tmp', sessionId: 's1' });

    expect(result.output).toContain('Task 1');
    expect(await service.get('s1')).toEqual(todos);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'todo-updated', sessionId: 's1', workspace: 'ws', todos });
  });

  it('errors when sessionId is missing', async () => {
    const service = new DefaultTodoService(new MemoryTodoStore());
    const executor = createTodoWriteToolExecutor(service, () => {}, 'ws');
    await expect(
      executor({ todos: [] }, { cwd: '/tmp', workspaceRoot: '/tmp' }),
    ).rejects.toThrow('sessionId');
  });
});
