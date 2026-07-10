import { describe, it, expect, beforeEach } from 'vitest';
import { executeTools } from '../../src/execute/execute-tools.js';
import { AgentToolRegistry } from '../../src/registry/tool-registry.js';
import { AgentState } from '../../src/agent-state.js';
import { RuleEngine } from '../../src/security/rules/rule-engine.js';
import { RuleStore } from '../../src/security/rules/rule-store.js';
import { WorkspaceOutsideError } from '../../src/security/workspace-root-guard.js';
import { createPermissionEvaluator } from '../../src/security/permissions/factory.js';
import { Type } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../src/sdk/tool-provider.js';

describe('executeTools outside workspace', () => {
  let registry: AgentToolRegistry;
  let agentState: AgentState;
  let ruleStore: RuleStore;
  let ruleEngine: RuleEngine;
  let chunks: unknown[] = [];

  beforeEach(async () => {
    registry = new AgentToolRegistry({ workspaceRoot: '/workspace' });

    const readDef: ToolDefinition = {
      name: 'read',
      description: 'read',
      parameters: Type.Object({ path: Type.String() }),
      readOnly: true,
      derivePatterns: (input: { path: string }) => [`file:${input.path}`],
    };
    const readExec: ToolExecutor = async (_input, ctx: ToolContext) => {
      if (ctx.outsideAllowed) {
        return { output: 'ok' };
      }
      throw new WorkspaceOutsideError('/outside/file.txt', '/workspace');
    };
    registry.register(readDef, readExec);

    const writeDef: ToolDefinition = {
      name: 'write',
      description: 'write',
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      derivePatterns: (input: { path: string }) => [`file:${input.path}`],
    };
    const writeExec: ToolExecutor = async (_input, ctx: ToolContext) => {
      if (ctx.outsideAllowed) {
        return { output: 'written' };
      }
      throw new WorkspaceOutsideError('/outside/file.txt', '/workspace');
    };
    registry.register(writeDef, writeExec);

    agentState = new AgentState();
    ruleStore = new RuleStore();
    ruleEngine = new RuleEngine([]);
    chunks = [];
  });

  function buildParams(mode: 'auto' | 'interactive', toolCalls: any[]) {
    return {
      toolCalls,
      toolProvider: registry,
      permissionEvaluator: createPermissionEvaluator(mode, ruleEngine, { create: (i) => i }),
      agentState,
      ruleEngine,
      ruleStore,
      securityMode: mode,
      workspaceRoot: '/workspace',
      sessionId: 's1',
      addMessage: () => ({ id: 'm1', role: 'tool', content: [] } as any),
      appendContent: () => {},
      emit: (c: any) => chunks.push(c),
    };
  }

  it('auto mode allows read outside workspace', async () => {
    const results = await executeTools(
      buildParams('auto', [
        { toolCallId: 'tc-1', toolName: 'read', input: { path: '/outside/file.txt' } },
      ]),
    );
    expect(results[0].output).toBe('ok');
  });

  it('interactive mode asks for read outside workspace', async () => {
    const pendingPromise = executeTools(
      buildParams('interactive', [
        { toolCallId: 'tc-1', toolName: 'read', input: { path: '/outside/file.txt' } },
      ]),
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(chunks.some((c: any) => c.type === 'approval-request')).toBe(true);

    const liveState = await agentState.getOrCreate('s1');
    const pending = liveState.pendingApprovals[0];
    liveState.approvalEngine.resolve(pending.approvalId, 'deny');

    const results = await pendingPromise;
    expect(results[0].error).toBe('denied');
  });

  it('auto mode allows write outside workspace when rule permits', async () => {
    ruleEngine = new RuleEngine([
      { permission: 'write', pattern: '**', action: 'allow', outside: true, source: 'user-config' } as any,
    ]);
    const results = await executeTools(
      buildParams('auto', [
        { toolCallId: 'tc-1', toolName: 'write', input: { path: '/outside/file.txt', content: 'x' } },
      ]),
    );
    expect(results[0].output).toBe('written');
  });
});
