import { describe, it, expect, vi } from 'vitest';
import { McpToolProvider } from '../../src/mcp/tool-provider.js';
import { ApprovalManager } from '../../src/security/approval-manager.js';
import { ApprovalOrchestrator } from '../../src/security/approval-orchestrator.js';
import type { AgentRuntimeState, AgentStateProvider } from '../../src/sdk/agent-state-provider.js';

function createMockClient() {
  return {
    getName: () => 'fs',
    listTools: vi.fn().mockResolvedValue([
      {
        originalName: 'read_file',
        prefixedName: '',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ]),
    callTool: vi.fn().mockResolvedValue('content'),
    close: vi.fn(),
  };
}

function createStateProvider(): AgentStateProvider {
  const states = new Map<string, AgentRuntimeState>();
  return {
    getState: async (sessionId) => states.get(sessionId) ?? { pendingApprovals: [] },
    setState: async (sessionId, state) => {
      states.set(sessionId, state);
    },
  };
}

describe('McpToolProvider', () => {
  it('prefixes tool names and exposes them in getToolSet', async () => {
    const mockClient = createMockClient();
    const provider = new McpToolProvider(mockClient as any, { name: 'fs', prefix: 'fs' });
    await provider.loadTools();

    const toolSet = provider.getToolSet();
    expect(toolSet).toHaveProperty('fs__read_file');
    expect(toolSet['fs__read_file'].description).toContain('Read a file');
  });

  it('executes prefixed tool by calling underlying client', async () => {
    const mockClient = createMockClient();
    const provider = new McpToolProvider(mockClient as any, { name: 'fs', prefix: 'fs' });
    await provider.loadTools();

    const results = await provider.execute(
      [{ toolCallId: 'tc1', toolName: 'fs__read_file', input: { path: '/tmp/foo' } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(results[0].output).toBe('content');
    expect(mockClient.callTool).toHaveBeenCalledWith('read_file', { path: '/tmp/foo' });
  });

  it('returns error for invalid input', async () => {
    const mockClient = createMockClient();
    const provider = new McpToolProvider(mockClient as any, { name: 'fs', prefix: 'fs' });
    await provider.loadTools();

    const results = await provider.execute(
      [{ toolCallId: 'tc1', toolName: 'fs__read_file', input: { missing: 'path' } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(results[0].error).toContain('Invalid input');
    expect(mockClient.callTool).not.toHaveBeenCalled();
  });

  it('throws on manual register', () => {
    const provider = new McpToolProvider(createMockClient() as any, { name: 'fs', prefix: 'fs' });
    expect(() => provider.register({} as any, async () => ({ output: '' }))).toThrow(
      'Cannot manually register tools on McpToolProvider',
    );
  });

  it('marks all tools as dangerous and category mcp', async () => {
    const mockClient = createMockClient();
    const provider = new McpToolProvider(mockClient as any, { name: 'fs', prefix: 'fs' });
    await provider.loadTools();

    const definitions = provider.getToolDefinitions();
    expect(definitions[0].dangerous).toBe(true);
    expect(definitions[0].category).toBe('mcp');
  });

  it('runs dangerous-tool hook for approval', async () => {
    const orchestrator = new ApprovalOrchestrator(createStateProvider(), new ApprovalManager());
    const mockClient = createMockClient();
    const provider = new McpToolProvider(mockClient as any, { name: 'fs', prefix: 'fs' }, orchestrator);
    await provider.loadTools();

    const executePromise = provider.execute(
      [{ toolCallId: 'tc1', toolName: 'fs__read_file', input: { path: '/tmp/foo' } }],
      { cwd: '/', workspaceRoot: '/', sessionId: 'session-1' },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = await orchestrator.listPending('session-1');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.toolName).toBe('fs__read_file');

    orchestrator.resolveApproval(pending[0].approvalId, 'allow-once');
    const results = await executePromise;

    expect(results[0].output).toBe('content');
  });

  it('blocks tool when approval is denied', async () => {
    const orchestrator = new ApprovalOrchestrator(createStateProvider(), new ApprovalManager());
    const mockClient = createMockClient();
    const provider = new McpToolProvider(mockClient as any, { name: 'fs', prefix: 'fs' }, orchestrator);
    await provider.loadTools();

    const executePromise = provider.execute(
      [{ toolCallId: 'tc1', toolName: 'fs__read_file', input: { path: '/tmp/foo' } }],
      { cwd: '/', workspaceRoot: '/', sessionId: 'session-1' },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = await orchestrator.listPending('session-1');
    orchestrator.resolveApproval(pending[0].approvalId, 'deny');
    const results = await executePromise;

    expect(results[0].error).toContain('denied');
    expect(mockClient.callTool).not.toHaveBeenCalled();
  });
});
