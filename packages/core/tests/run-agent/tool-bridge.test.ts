import { describe, it, expect, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { createToolBridge } from '../../src/run-agent/tool-bridge.js';
import { AgentState } from '../../src/agent-state.js';

const baseParams = (overrides: Record<string, unknown> = {}) => ({
  toolProvider: {
    getToolDefinition: vi.fn(() => ({ name: 'echo', description: 'd', parameters: Type.Object({}) })),
    execute: vi.fn(async () => [{ toolCallId: 'tc1', toolName: 'echo', output: 'ok' }]),
    getToolSet: () => [{ name: 'echo', description: 'd', parameters: Type.Object({}) }],
    register: () => {},
    isDangerous: () => false,
  },
  permissionEvaluator: { evaluate: vi.fn(async () => ({ action: 'allow' })) },
  agentState: new AgentState(),
  ruleEngine: { addRule: vi.fn(), checkOutsideAllowed: () => false },
  ruleStore: { saveApproved: vi.fn(async () => {}) },
  securityMode: 'auto' as const,
  workspaceRoot: '/tmp',
  sessionId: 's1',
  emit: () => {},
  ...overrides,
});

const toolCallCtx = (args: unknown = {}) => ({
  assistantMessage: {} as never,
  toolCall: { type: 'toolCall' as const, id: 'tc1', name: 'echo', arguments: args },
  args,
  context: {} as never,
});

describe('createToolBridge.beforeToolCall', () => {
  it('blocks when permission denied', async () => {
    const params = baseParams();
    params.permissionEvaluator.evaluate = vi.fn(async () => ({ action: 'deny', reason: 'no' }));
    const bridge = createToolBridge(params as never);
    const result = await bridge.beforeToolCall(toolCallCtx() as never);
    expect(result).toEqual({ block: true, reason: 'no' });
  });

  it('blocks unknown tools', async () => {
    const params = baseParams();
    (params.toolProvider.getToolDefinition as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const bridge = createToolBridge(params as never);
    expect(await bridge.beforeToolCall(toolCallCtx() as never)).toEqual({ block: true, reason: 'unknown tool: echo' });
  });

  it('allows when permission allows', async () => {
    const bridge = createToolBridge(baseParams() as never);
    expect(await bridge.beforeToolCall(toolCallCtx() as never)).toBeUndefined();
  });
});

describe('createToolBridge AgentTool.execute', () => {
  it('maps ToolResult to AgentToolResult', async () => {
    const bridge = createToolBridge(baseParams() as never);
    const tool = bridge.tools.find((t) => t.name === 'echo')!;
    const result = await tool.execute('tc1', {} as never);
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
  });

  it('throws when the tool result carries an error', async () => {
    const params = baseParams();
    params.toolProvider.execute = vi.fn(async () => [{ toolCallId: 'tc1', toolName: 'echo', output: '', error: 'boom' }]);
    const bridge = createToolBridge(params as never);
    await expect(bridge.tools[0].execute('tc1', {} as never)).rejects.toThrow('boom');
  });
});
