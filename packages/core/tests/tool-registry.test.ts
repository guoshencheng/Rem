import { describe, it, expect, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { AgentToolRegistry } from '../src/registry/tool-registry.js';
import { ApprovalManager } from '../src/security/approval-manager.js';
import { ApprovalOrchestrator } from '../src/security/approval-orchestrator.js';
import type { AgentLiveProvider } from '../src/sdk/agent-state-provider.js';
import { AgentLiveState } from '../src/state.js';

const echoSchema = Type.Object({ msg: Type.String() }, { additionalProperties: false });

function createLiveProvider(): AgentLiveProvider {
  const store = new Map<string, AgentLiveState>();
  return {
    get: async (sessionId) => store.get(sessionId),
    set: async (sessionId, state) => { store.set(sessionId, state); },
  };
}

function createApprovalOrchestrator() {
  return new ApprovalOrchestrator(createLiveProvider(), new ApprovalManager());
}

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
  });

  it('runs dangerous-tool hook for dangerous tools', async () => {
    const orchestrator = createApprovalOrchestrator();
    const registry = new AgentToolRegistry({
      workspaceRoot: '/workspace',
      approvalOrchestrator: orchestrator,
    });
    registry.register(
      { name: 'write', description: 'Write', parameters: echoSchema, dangerous: true },
      async () => ({ output: 'ok' }),
    );

    const executePromise = registry.execute(
      [{ toolCallId: 'tc1', toolName: 'write', input: { msg: 'x' } }],
      { cwd: '/workspace', workspaceRoot: '/workspace', sessionId: 'session-1' },
    );

    // Wait one tick so the hook creates the pending approval
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = await orchestrator.listPending('session-1');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.toolName).toBe('write');

    orchestrator.resolveApproval(pending[0].approvalId, 'allow-once');
    const results = await executePromise;

    expect(results[0].output).toBe('ok');
  });

  it('blocks dangerous tools when approval is denied', async () => {
    const orchestrator = createApprovalOrchestrator();
    const registry = new AgentToolRegistry({
      workspaceRoot: '/workspace',
      approvalOrchestrator: orchestrator,
    });
    registry.register(
      { name: 'write', description: 'Write', parameters: echoSchema, dangerous: true },
      async () => ({ output: 'ok' }),
    );

    const executePromise = registry.execute(
      [{ toolCallId: 'tc1', toolName: 'write', input: { msg: 'x' } }],
      { cwd: '/workspace', workspaceRoot: '/workspace', sessionId: 'session-1' },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = await orchestrator.listPending('session-1');
    orchestrator.resolveApproval(pending[0].approvalId, 'deny');
    const results = await executePromise;

    expect(results[0].error).toContain('denied');
  });

  it('auto-approves dangerous tools when approval orchestrator is unavailable', async () => {
    const registry = createRegistry();
    registry.register(
      { name: 'write', description: 'Write', parameters: echoSchema, dangerous: true },
      async () => ({ output: 'ok' }),
    );

    const results = await registry.execute(
      [{ toolCallId: 'tc1', toolName: 'write', input: { msg: 'x' } }],
      { cwd: '/workspace', workspaceRoot: '/workspace', sessionId: 'session-1' },
    );

    expect(results[0].output).toBe('ok');
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
