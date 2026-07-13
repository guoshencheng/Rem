import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultTodoService } from '../../src/todo/service.js';
import { TodoValidationError } from '../../src/todo/errors.js';
import type { TodoItem, TodoStore } from '../../src/index.js';

class MemoryTodoStore implements TodoStore {
  private data = new Map<string, TodoItem[]>();

  async getBySession(sessionId: string): Promise<TodoItem[]> {
    return this.data.get(sessionId) ?? [];
  }

  async replaceForSession(sessionId: string, todos: TodoItem[]): Promise<void> {
    this.data.set(sessionId, todos);
  }
}

describe('DefaultTodoService', () => {
  let store: MemoryTodoStore;
  let service: DefaultTodoService;

  beforeEach(() => {
    store = new MemoryTodoStore();
    service = new DefaultTodoService(store);
  });

  it('updates valid todos', async () => {
    const todos: TodoItem[] = [
      { content: 'A', status: 'in_progress', priority: 'high' },
      { content: 'B', status: 'pending', priority: 'medium' },
    ];
    await service.update('s1', todos);
    const result = await service.get('s1');
    expect(result).toEqual(todos);
  });

  it('rejects invalid status', async () => {
    await expect(
      service.update('s1', [{ content: 'A', status: 'done' as any, priority: 'high' }]),
    ).rejects.toBeInstanceOf(TodoValidationError);
  });

  it('rejects empty content', async () => {
    await expect(
      service.update('s1', [{ content: '  ', status: 'pending', priority: 'high' }]),
    ).rejects.toBeInstanceOf(TodoValidationError);
  });

  it('rejects more than one in_progress', async () => {
    await expect(
      service.update('s1', [
        { content: 'A', status: 'in_progress', priority: 'high' },
        { content: 'B', status: 'in_progress', priority: 'medium' },
      ]),
    ).rejects.toBeInstanceOf(TodoValidationError);
  });
});
