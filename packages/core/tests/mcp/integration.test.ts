import { describe, it, expect, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { CompositeToolProvider } from '../../src/mcp/composite-tool-provider.js';
import { InMemoryToolProvider } from '../../src/plugins/tool/in-memory/index.js';

describe('MCP integration', () => {
  it('composites built-in and MCP tools', async () => {
    const primary = new InMemoryToolProvider();
    primary.register(
      { name: 'echo', description: 'Echo', parameters: Type.Object({}) },
      async () => ({ output: 'echo' }),
    );

    const mockProvider = {
      name: 'mock',
      prefix: 'mock',
      getToolSet: () => ({ 'mock__greet': { description: 'Greet', parameters: { type: 'object' } } }),
      execute: vi.fn().mockResolvedValue([{ toolCallId: 'tc1', toolName: 'mock__greet', output: 'hello' }]),
    };

    const composite = new CompositeToolProvider(primary, [mockProvider as any]);
    const tools = composite.getToolSet();
    expect(Object.keys(tools)).toContain('echo');
    expect(Object.keys(tools)).toContain('mock__greet');

    const results = await composite.execute(
      [{ toolCallId: 'tc1', toolName: 'mock__greet', input: {} }],
      { cwd: '/', workspaceRoot: '/' },
    );
    expect(results[0].output).toBe('hello');
  });
});
