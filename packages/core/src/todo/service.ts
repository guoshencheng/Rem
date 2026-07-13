import type { TodoItem, TodoPriority, TodoStatus } from './types.js';
import { TodoValidationError } from './errors.js';
import type { TodoStore } from '../storage/types.js';

export interface TodoService {
  get(sessionId: string): Promise<TodoItem[]>;
  update(sessionId: string, todos: TodoItem[]): Promise<void>;
}

const VALID_STATUSES: TodoStatus[] = ['pending', 'in_progress', 'completed', 'cancelled'];
const VALID_PRIORITIES: TodoPriority[] = ['high', 'medium', 'low'];
const MAX_TODOS = 50;

export class DefaultTodoService implements TodoService {
  constructor(private store: TodoStore) {}

  async get(sessionId: string): Promise<TodoItem[]> {
    return this.store.getBySession(sessionId);
  }

  async update(sessionId: string, todos: TodoItem[]): Promise<void> {
    if (todos.length > MAX_TODOS) {
      throw new TodoValidationError(`Cannot store more than ${MAX_TODOS} todos`);
    }

    let inProgressCount = 0;
    for (let i = 0; i < todos.length; i++) {
      const todo = todos[i];
      if (!VALID_STATUSES.includes(todo.status)) {
        throw new TodoValidationError(`Invalid status at index ${i}: ${todo.status}`);
      }
      if (!VALID_PRIORITIES.includes(todo.priority)) {
        throw new TodoValidationError(`Invalid priority at index ${i}: ${todo.priority}`);
      }
      const content = todo.content.trim();
      if (content.length === 0) {
        throw new TodoValidationError(`Empty content at index ${i}`);
      }
      if (todo.status === 'in_progress') {
        inProgressCount++;
      }
    }

    if (inProgressCount > 1) {
      throw new TodoValidationError('At most one todo can be in_progress at a time');
    }

    await this.store.replaceForSession(
      sessionId,
      todos.map((todo) => ({ ...todo, content: todo.content.trim() })),
    );
  }
}
