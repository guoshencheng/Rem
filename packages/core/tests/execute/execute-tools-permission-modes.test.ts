import { describe, it, expect, beforeEach } from 'vitest';
import { executeTools } from '../../src/execute/execute-tools.js';
import { AgentToolRegistry } from '../../src/registry/tool-registry.js';
import { AgentState } from '../../src/agent-state.js';
import { RuleEngine } from '../../src/security/rules/rule-engine.js';
import { RuleStore } from '../../src/security/rules/rule-store.js';
import { createPermissionEvaluator } from '../../src/security/permissions/factory.js';
import { Type } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor } from '../../src/sdk/tool-provider.js';

describe('executeTools permission modes', () => {
  let registry: AgentToolRegistry;
  let agentState: AgentState;
  let ruleStore: RuleStore;
  let chunks: unknown[] = [];
  let ruleEngine: RuleEngine;

  beforeEach(async () => {
    registry = new AgentToolRegistry({ workspaceRoot: '/tmp' });

    const writeDef: ToolDefinition = {
      name: 'write',
      description: 'write',
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      derivePatterns: (input: { path: string }) => [`file:${input.path}`],
    };
    const writeExec: ToolExecutor = async () => ({ output: 'written' });
    registry.register(writeDef, writeExec);

    const readDef: ToolDefinition = {
      name: 'read',
      description: 'read',
      parameters: Type.Object({ path: Type.String() }),
      readOnly: true,
      derivePatterns: (input: { path: string }) => [`file:${input.path}`],
    };
    const readExec: ToolExecutor = async () => ({ output: 'ok' });
    registry.register(readDef, readExec);

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
      workspaceRoot: '/tmp',
      sessionId: 's1',
      addMessage: () => ({ id: 'm1', role: 'tool', content: [] } as any),
      appendContent: () => {},
      emit: (c: any) => chunks.push(c),
    };
  }

  it('auto mode allows write without approval', async () => {
    const results = await executeTools(
      buildParams('auto', [
        { toolCallId: 'tc-1', toolName: 'write', input: { path: 'foo.ts', content: 'x' } },
      ]),
    );
    expect(results[0].output).toBe('written');
    expect(chunks.some((c: any) => c.type === 'approval-request')).toBe(false);
  });

  it('auto mode denies sensitive read', async () => {
    const results = await executeTools(
      buildParams('auto', [{ toolCallId: 'tc-1', toolName: 'read', input: { path: '.env' } }]),
    );
    expect(results[0].error).toBe('sensitive read blocked in auto mode');
  });

  it('interactive mode asks for write', async () => {
    const pendingPromise = executeTools(
      buildParams('interactive', [
        { toolCallId: 'tc-1', toolName: 'write', input: { path: 'foo.ts', content: 'x' } },
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
});
