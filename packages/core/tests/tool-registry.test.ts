import { describe, it, expect } from 'vitest';
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

  it('reports dangerous tools via isDangerous', () => {
    const registry = createRegistry();
    registry.register(
      { name: 'write', description: 'Write', parameters: echoSchema, dangerous: true },
      async () => ({ output: 'ok' }),
    );
    registry.register(
      { name: 'echo', description: 'Echo', parameters: echoSchema, readOnly: true },
      async ({ msg }) => ({ output: msg }),
    );

    expect(registry.isDangerous('write')).toBe(true);
    expect(registry.isDangerous('echo')).toBe(false);
    expect(registry.isDangerous('unknown')).toBe(false);
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
});
