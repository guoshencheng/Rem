import { describe, it, expect, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { AgentToolRegistry } from '../src/registry/tool-registry.js';

const echoSchema = Type.Object({ msg: Type.String() }, { additionalProperties: false });

function createRegistry(options?: { readOnly?: boolean; policy?: { allow?: string[]; deny?: string[] } }) {
  return new AgentToolRegistry({
    workspaceRoot: '/workspace',
    readOnly: options?.readOnly,
    policy: options?.policy,
  });
}

describe('AgentToolRegistry', () => {
  it('registers tools and exposes them in getToolSet', () => {
    const registry = createRegistry();
    registry.register(
      { name: 'echo', description: 'Echo', parameters: echoSchema, readOnly: true },
      async ({ msg }) => ({ output: msg }),
    );

    const tools = registry.getToolSet();
    expect(tools.echo).toBeDefined();
    expect(tools.echo.description).toBe('Echo');
  });

  it('executes a registered tool', async () => {
    const registry = createRegistry();
    registry.register(
      { name: 'echo', description: 'Echo', parameters: echoSchema, readOnly: true },
      async ({ msg }) => ({ output: msg }),
    );

    const results = await registry.execute(
      [{ toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } }],
      { cwd: '/workspace', workspaceRoot: '/workspace' },
    );

    expect(results[0].output).toBe('hi');
  });

  it('filters tools by allow policy', () => {
    const registry = createRegistry({ policy: { allow: ['echo'] } });
    registry.register(
      { name: 'echo', description: 'Echo', parameters: echoSchema, readOnly: true },
      async ({ msg }) => ({ output: msg }),
    );
    registry.register(
      { name: 'write', description: 'Write', parameters: echoSchema, dangerous: true },
      async () => ({ output: 'ok' }),
    );

    const tools = registry.getToolSet();
    expect(tools.echo).toBeDefined();
    expect(tools.write).toBeUndefined();
  });

  it('filters tools by deny policy', () => {
    const registry = createRegistry({ policy: { deny: ['write'] } });
    registry.register(
      { name: 'echo', description: 'Echo', parameters: echoSchema, readOnly: true },
      async ({ msg }) => ({ output: msg }),
    );
    registry.register(
      { name: 'write', description: 'Write', parameters: echoSchema, dangerous: true },
      async () => ({ output: 'ok' }),
    );

    const tools = registry.getToolSet();
    expect(tools.echo).toBeDefined();
    expect(tools.write).toBeUndefined();
  });

  it('removes non-readOnly tools in readOnly mode', () => {
    const registry = createRegistry({ readOnly: true });
    registry.register(
      { name: 'read', description: 'Read', parameters: echoSchema, readOnly: true },
      async () => ({ output: 'ok' }),
    );
    registry.register(
      { name: 'write', description: 'Write', parameters: echoSchema, dangerous: true },
      async () => ({ output: 'ok' }),
    );

    const tools = registry.getToolSet();
    expect(tools.read).toBeDefined();
    expect(tools.write).toBeUndefined();
  });

  it('runs approval hook for dangerous tools', async () => {
    const approvalHook = vi.fn().mockResolvedValue({ approved: true });
    const registry = new AgentToolRegistry({
      workspaceRoot: '/workspace',
      approvalHook,
    });
    registry.register(
      { name: 'write', description: 'Write', parameters: echoSchema, dangerous: true },
      async () => ({ output: 'ok' }),
    );

    await registry.execute(
      [{ toolCallId: 'tc1', toolName: 'write', input: { msg: 'x' } }],
      { cwd: '/workspace', workspaceRoot: '/workspace' },
    );

    expect(approvalHook).toHaveBeenCalledWith('write', { msg: 'x' }, expect.any(Object));
  });

  it('blocks dangerous tools when approval hook denies', async () => {
    const approvalHook = vi.fn().mockResolvedValue({ approved: false, reason: 'blocked' });
    const registry = new AgentToolRegistry({
      workspaceRoot: '/workspace',
      approvalHook,
    });
    registry.register(
      { name: 'write', description: 'Write', parameters: echoSchema, dangerous: true },
      async () => ({ output: 'ok' }),
    );

    const results = await registry.execute(
      [{ toolCallId: 'tc1', toolName: 'write', input: { msg: 'x' } }],
      { cwd: '/workspace', workspaceRoot: '/workspace' },
    );

    expect(results[0].error).toBe('blocked');
  });
});
