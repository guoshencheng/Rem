import { describe, it, expect, vi } from 'vitest';
import { DefaultExecuteProvider } from '../../../../src/plugins/execute/default/index.js';
import type { ToolCall, ToolProvider, ToolResult } from '../../../../src/sdk/tool-provider.js';

describe('DefaultExecuteProvider', () => {
  it('executes tool calls and emits results', async () => {
    const toolCall: ToolCall = { toolCallId: 'tc-1', toolName: 'echo', input: { text: 'hello' } };
    const toolResult: ToolResult = { toolCallId: 'tc-1', toolName: 'echo', output: 'hello' };

    const toolProvider: ToolProvider = {
      register: vi.fn(),
      getToolSet: vi.fn(() => ({
        echo: { description: 'echo', parameters: { type: 'object', properties: {} } },
      })),
      execute: vi.fn(async () => [toolResult]),
    };

    const provider = new DefaultExecuteProvider({ toolProvider });
    const chunks: unknown[] = [];
    const results = await provider.execute(
      [toolCall],
      { cwd: '/', workspaceRoot: '/', sessionId: 's1' },
      (c) => { chunks.push(c); },
    );

    expect(results).toEqual([toolResult]);
    expect(toolProvider.execute).toHaveBeenCalledWith([toolCall], expect.any(Object), expect.any(Object));
    expect(chunks.length).toBeGreaterThan(0);
  });
});
