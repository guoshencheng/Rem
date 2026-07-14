import { describe, it, expect } from 'vitest';
import { OverlayToolProvider } from '../src/overlay-tool-provider.js';
import {
  createTodoWriteToolDefinition,
  createTodoWriteToolExecutor,
} from '../src/plugins/tool/builtin/todo-write.js';
import { DefaultTodoService } from '../src/todo/service.js';
import type { ToolCall } from '../src/sdk/tool-provider.js';

describe('todowrite tool registration (end-to-end)', () => {
  it('is registered, appears in toolSet, and executes via OverlayToolProvider.execute', async () => {
    // 1. in-memory todo store
    const stored: Record<string, any[]> = {};
    const todoStore = {
      async getBySession(sessionId: string) {
        return stored[sessionId] ?? [];
      },
      async replaceForSession(sessionId: string, todos: any[]) {
        stored[sessionId] = todos;
      },
    };
    const todoService = new DefaultTodoService(todoStore as any);

    // 2. base provider with one pre-existing tool (to verify overlay merges)
    const baseProvider = {
      getToolSet: () => ({
        bash: { description: 'run shell', parameters: {} },
      }),
      register: () => {},
      execute: async () => [],
      isDangerous: () => false,
    } as any;

    // 3. replicate run-agent.ts:177-188
    const overlay = new OverlayToolProvider(baseProvider);
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
    expect(Object.keys(toolSet).sort()).toEqual(['bash', 'todowrite']);
    expect(toolSet.todowrite.description).toMatch(/todo/i);

    // 5. tools array shape used by run-agent.ts:191-194 (fed into system prompt)
    const tools = Object.entries(toolSet).map(([name, schema]) => ({
      name,
      description: schema.description,
    }));
    expect(tools.find((t) => t.name === 'todowrite')).toBeDefined();

    // 6. execute via the same path the loop uses (OverlayToolProvider.execute)
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
      async replaceForSession() {},
    };
    const todoService = new DefaultTodoService(todoStore as any);
    const baseProvider = {
      getToolSet: () => ({}),
      register: () => {},
      execute: async () => [],
      isDangerous: () => false,
    } as any;
    const overlay = new OverlayToolProvider(baseProvider);
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
