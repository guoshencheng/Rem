import { describe, it, expect } from 'vitest';
import { ToolOverlay } from '../src/tool-overlay.js';
import {
  createTodoWriteToolDefinition,
  createTodoWriteToolExecutor,
} from '../src/plugins/tool/builtin/todo-write.js';
import { DefaultTodoService } from '../src/todo/service.js';
import type { ToolCall } from '../src/sdk/tool-provider.js';

describe('todowrite tool registration', () => {
  it('is registered on ToolOverlay and executable', async () => {
    const stored: Record<string, any[]> = {};
    const todoStore = {
      async getBySession(sessionId: string) {
        return stored[sessionId] ?? [];
      },
      async replaceForSession(sessionId: string, todos: any[]) {
        stored[sessionId] = todos;
        return todos;
      },
    };
    const todoService = new DefaultTodoService(todoStore as any);

    const baseProvider = {
      getToolSet: () => [],
      register: () => {},
      execute: async () => [],
      isDangerous: () => false,
    } as any;

    const overlay = new ToolOverlay(baseProvider);
    const def = createTodoWriteToolDefinition();
    const exec = createTodoWriteToolExecutor(todoService, () => {}, '/tmp');
    overlay.register(def, exec);

    const toolSet = overlay.getToolSet();
    expect(toolSet.map((t) => t.name)).toContain('todowrite');
    expect(toolSet.find((t) => t.name === 'todowrite')?.description).toMatch(/todo/i);

    const result = await exec(
      {
        todos: [
          { content: 'verify todowrite', status: 'in_progress', priority: 'high' },
        ],
      },
      { sessionId: 'test-session-1' } as any,
    );
    expect(result.output).toContain('verify todowrite');
    expect(stored['test-session-1']).toHaveLength(1);
    expect(stored['test-session-1'][0].status).toBe('in_progress');
  });
});

describe('todowrite tool registration (end-to-end)', () => {
  it('is registered, appears in toolSet, and executes via ToolOverlay.execute', async () => {
    // 1. in-memory todo store
    const stored: Record<string, any[]> = {};
    const todoStore = {
      async getBySession(sessionId: string) {
        return stored[sessionId] ?? [];
      },
      async replaceForSession(sessionId: string, todos: any[]) {
        stored[sessionId] = todos;
        return todos;
      },
    };
    const todoService = new DefaultTodoService(todoStore as any);

    // 2. base provider with one pre-existing tool (to verify overlay merges)
    const baseProvider = {
      getToolSet: () => [
        { name: 'bash', description: 'run shell', parameters: {} },
      ],
      register: () => {},
      execute: async () => [],
      isDangerous: () => false,
    } as any;

    // 3. replicate run-agent.ts:177-188
    const overlay = new ToolOverlay(baseProvider);
    const def = createTodoWriteToolDefinition();
    const publishedEvents: any[] = [];
    const exec = createTodoWriteToolExecutor(
      todoService,
      (event) => publishedEvents.push(event),
      '/tmp',
    );
    overlay.register(def, exec);

    // 4. toolSet must contain both base tool and todowrite
    const toolSet = overlay.getToolSet();
    expect(toolSet.map((t) => t.name).sort()).toEqual(['bash', 'todowrite']);
    expect(toolSet.find((t) => t.name === 'todowrite')?.description).toMatch(/todo/i);

    // 5. tools array shape used by run-agent.ts:191-194 (fed into system prompt)
    const tools = toolSet.map((t) => ({ name: t.name, description: t.description }));
    expect(tools.find((t) => t.name === 'todowrite')).toBeDefined();

    // 6. execute via the same path the loop uses (ToolOverlay.execute)
    const call: ToolCall = {
      toolCallId: 'call-1',
      toolName: 'todowrite',
      input: {
        todos: [
          { content: 'verify todowrite', status: 'in_progress', priority: 'high' },
          { content: 'second task', status: 'pending', priority: 'medium' },
        ],
      },
    };
    const results = await overlay.execute([call], { sessionId: 'sess-1' } as any);

    expect(results).toHaveLength(1);
    expect(results[0].error).toBeUndefined();
    expect(results[0].output).toContain('verify todowrite');

    // 7. side effects: store updated + event published
    expect(stored['sess-1']).toHaveLength(2);
    expect(stored['sess-1'][0].status).toBe('in_progress');
    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0].type).toBe('todo-updated');
    expect(publishedEvents[0].sessionId).toBe('sess-1');
  });

  it('rejects invalid input via schema check', async () => {
    const todoStore = {
      async getBySession() { return []; },
      async replaceForSession() { return []; },
    };
    const todoService = new DefaultTodoService(todoStore as any);
    const baseProvider = {
      getToolSet: () => [],
      register: () => {},
      execute: async () => [],
      isDangerous: () => false,
    } as any;
    const overlay = new ToolOverlay(baseProvider);
    overlay.register(
      createTodoWriteToolDefinition(),
      createTodoWriteToolExecutor(todoService, () => {}, '/tmp'),
    );

    const call: ToolCall = {
      toolCallId: 'call-bad',
      toolName: 'todowrite',
      input: { todos: [{ content: 'x', status: 'bogus', priority: 'high' }] },
    };
    const results = await overlay.execute([call], { sessionId: 's' } as any);
    expect(results[0].error).toMatch(/Invalid input/i);
  });
});
