import { describe, it, expect, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { CompositeToolProvider } from '../../src/mcp/composite-tool-provider.js';
import { InMemoryToolProvider } from '../../src/plugins/tool/in-memory/index.js';

describe('CompositeToolProvider', () => {
  it('merges tool sets from all providers', async () => {
    const primary = new InMemoryToolProvider();
    primary.register(
      { name: 'echo', description: 'Echo', parameters: Type.Object({ msg: Type.String() }) },
      async ({ msg }) => ({ output: msg }),
    );

    const mcp = {
      getToolSet: () => ({ 'fs__read': { description: 'Read', parameters: { type: 'object' } } }),
      execute: vi.fn().mockResolvedValue([{ toolCallId: 'tc1', toolName: 'fs__read', output: 'data' }]),
    };

    const composite = new CompositeToolProvider(primary, [mcp as any]);
    const tools = composite.getToolSet();
    expect(tools).toHaveProperty('echo');
    expect(tools).toHaveProperty('fs__read');
  });

  it('routes calls to MCP provider by tool name ownership', async () => {
    const primary = new InMemoryToolProvider();
    const mcp = {
      getToolSet: () => ({ 'fs__read': { description: 'Read', parameters: { type: 'object' } } }),
      execute: vi.fn().mockResolvedValue([{ toolCallId: 'tc1', toolName: 'fs__read', output: 'data' }]),
    };

    const composite = new CompositeToolProvider(primary, [mcp as any]);
    const results = await composite.execute(
      [{ toolCallId: 'tc1', toolName: 'fs__read', input: {} }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(mcp.execute).toHaveBeenCalled();
    expect(results[0].output).toBe('data');
  });

  it('routes calls without MCP prefix to primary provider', async () => {
    const primary = new InMemoryToolProvider();
    primary.register(
      { name: 'echo', description: 'Echo', parameters: Type.Object({ msg: Type.String() }) },
      async ({ msg }) => ({ output: msg }),
    );

    const composite = new CompositeToolProvider(primary, []);
    const results = await composite.execute(
      [{ toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(results[0].output).toBe('hi');
  });

  it('delegates register to primary provider', () => {
    const primary = new InMemoryToolProvider();
    const composite = new CompositeToolProvider(primary, []);
    composite.register(
      { name: 'new', description: 'New', parameters: Type.Object({}) },
      async () => ({ output: '' }),
    );
    expect(primary.getToolSet()).toHaveProperty('new');
  });

  it('returns error for tool not owned by any provider', async () => {
    const primary = new InMemoryToolProvider();
    const composite = new CompositeToolProvider(primary, []);
    const results = await composite.execute(
      [{ toolCallId: 'tc1', toolName: 'unknown', input: {} }],
      { cwd: '/', workspaceRoot: '/' },
    );
    expect(results[0].error).toContain('not found');
  });
});
