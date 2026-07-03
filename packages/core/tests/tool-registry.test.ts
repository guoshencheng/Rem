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

  it('auto-approves dangerous tools when autoApproveDangerous is enabled', async () => {
    const registry = new AgentToolRegistry({
      workspaceRoot: '/workspace',
      autoApproveDangerous: true,
    });
    registry.register(
      { name: 'write', description: 'Write', parameters: echoSchema, dangerous: true },
      async () => ({ output: 'ok' }),
    );

    const results = await registry.execute(
      [{ toolCallId: 'tc1', toolName: 'write', input: { msg: 'x' } }],
      { cwd: '/workspace', workspaceRoot: '/workspace' },
    );

    expect(results[0].output).toBe('ok');
    expect(registry.getApprovalManager().listPending()).toHaveLength(0);
  });

  it('runs dangerous-tool hook for dangerous tools', async () => {
    const registry = createRegistry();
    registry.register(
      { name: 'write', description: 'Write', parameters: echoSchema, dangerous: true },
      async () => ({ output: 'ok' }),
    );

    const executePromise = registry.execute(
      [{ toolCallId: 'tc1', toolName: 'write', input: { msg: 'x' } }],
      { cwd: '/workspace', workspaceRoot: '/workspace' },
    );

    // Wait one tick so the hook creates the pending approval
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = registry.getApprovalManager().listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.toolName).toBe('write');

    registry.getApprovalManager().resolve(pending[0].approvalId, 'allow-once');
    const results = await executePromise;

    expect(results[0].output).toBe('ok');
  });

  it('blocks dangerous tools when approval is denied', async () => {
    const registry = createRegistry();
    registry.register(
      { name: 'write', description: 'Write', parameters: echoSchema, dangerous: true },
      async () => ({ output: 'ok' }),
    );

    const executePromise = registry.execute(
      [{ toolCallId: 'tc1', toolName: 'write', input: { msg: 'x' } }],
      { cwd: '/workspace', workspaceRoot: '/workspace' },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = registry.getApprovalManager().listPending();
    registry.getApprovalManager().resolve(pending[0].approvalId, 'deny');
    const results = await executePromise;

    expect(results[0].error).toContain('denied');
  });

  it('blocks tools when a custom hook blocks', async () => {
    const blockHook = () => ({ block: { reason: 'blocked by policy' } });
    const registry = new AgentToolRegistry({
      workspaceRoot: '/workspace',
      hooks: [blockHook],
    });
    registry.register(
      { name: 'echo', description: 'Echo', parameters: echoSchema, readOnly: true },
      async ({ msg }) => ({ output: msg }),
    );

    const results = await registry.execute(
      [{ toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } }],
      { cwd: '/workspace', workspaceRoot: '/workspace' },
    );

    expect(results[0].error).toBe('blocked by policy');
  });

  it('passes modified params to executor when hook returns params', async () => {
    const modifyHook = (ctx: { input: unknown }) => ({
      params: { ...(ctx.input as Record<string, string>), extra: 'added' },
    });
    const registry = new AgentToolRegistry({
      workspaceRoot: '/workspace',
      hooks: [modifyHook],
    });
    registry.register(
      { name: 'echo', description: 'Echo', parameters: echoSchema, readOnly: true },
      async (input: { msg: string; extra?: string }) => ({ output: `${input.msg}:${input.extra}` }),
    );

    const results = await registry.execute(
      [{ toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } }],
      { cwd: '/workspace', workspaceRoot: '/workspace' },
    );

    expect(results[0].output).toBe('hi:added');
  });
});
