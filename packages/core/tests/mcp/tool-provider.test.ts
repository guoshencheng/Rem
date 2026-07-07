import { describe, it, expect, vi } from 'vitest';
import { McpToolProvider } from '../../src/mcp/tool-provider.js';

function createMockClient() {
  return {
    getName: () => 'fs',
    listTools: vi.fn().mockResolvedValue([
      {
        originalName: 'read_file',
        prefixedName: '',
        description: 'Read a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    ]),
    callTool: vi.fn().mockResolvedValue('content'),
    close: vi.fn(),
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

    expect(provider.isDangerous('fs__read_file')).toBe(true);
    expect(provider.isDangerous('unknown')).toBe(false);

    const definitions = provider.getToolDefinitions();
    expect(definitions[0].dangerous).toBe(true);
    expect(definitions[0].category).toBe('mcp');
  });
});
