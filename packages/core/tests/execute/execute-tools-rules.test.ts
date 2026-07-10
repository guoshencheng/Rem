import { describe, it, expect, beforeEach } from 'vitest';
import { executeTools } from '../../src/execute/execute-tools.js';
import { AgentToolRegistry } from '../../src/registry/tool-registry.js';
import { AgentState } from '../../src/agent-state.js';
import { RuleEngine } from '../../src/security/rules/rule-engine.js';
import { RuleStore } from '../../src/security/rules/rule-store.js';
import { createPermissionEvaluator } from '../../src/security/permissions/factory.js';
import type { ToolDefinition, ToolExecutor } from '../../src/sdk/tool-provider.js';
import { Type } from '@sinclair/typebox';

describe('executeTools with rules', () => {
  let registry: AgentToolRegistry;
  let agentState: AgentState;
  let ruleStore: RuleStore;
  let chunks: unknown[] = [];

  beforeEach(async () => {
    registry = new AgentToolRegistry({ workspaceRoot: '/tmp' });
    const echoDef: ToolDefinition = {
      name: 'echo',
      description: 'echo',
      parameters: Type.Object({ text: Type.String() }),
      derivePatterns: (input) => [`echo:${input.text}`],
    };
    const echoExec: ToolExecutor = async (input) => ({ output: input.text });
    registry.register(echoDef, echoExec);

    // 只读工具，派生带斜杠的 file: 路径 pattern
    const readDef: ToolDefinition = {
      name: 'read',
      description: 'read',
      parameters: Type.Object({ path: Type.String() }),
      readOnly: true,
      derivePatterns: (input) => [`file:${input.path}`],
    };
    const readExec: ToolExecutor = async () => ({ output: 'ok' });
    registry.register(readDef, readExec);

    agentState = new AgentState();
    ruleStore = new RuleStore();
    chunks = [];
  });

  it('allows when rule matches allow', async () => {
    const engine = new RuleEngine([{ permission: 'echo', pattern: 'echo:hello*', action: 'allow', source: 'user-config' }]);
    const evaluator = createPermissionEvaluator('interactive', engine, { create: (i) => i });
    const results = await executeTools({
      toolCalls: [{ toolCallId: 'tc-1', toolName: 'echo', input: { text: 'hello-world' } }],
      toolProvider: registry,
      permissionEvaluator: evaluator,
      agentState,
      ruleEngine: engine,
      ruleStore,
      securityMode: 'interactive',
      workspaceRoot: '/tmp',
      sessionId: 's1',
      addMessage: () => ({ id: 'm1', role: 'tool', content: [] } as any),
      appendContent: () => {},
      emit: (c) => chunks.push(c),
    });
    expect(results[0].output).toBe('hello-world');
  });

  it('denies when rule matches deny', async () => {
    const engine = new RuleEngine([{ permission: 'echo', pattern: 'echo:secret*', action: 'deny', source: 'user-config' }]);
    const evaluator = createPermissionEvaluator('interactive', engine, { create: (i) => i });
    const results = await executeTools({
      toolCalls: [{ toolCallId: 'tc-1', toolName: 'echo', input: { text: 'secret-key' } }],
      toolProvider: registry,
      permissionEvaluator: evaluator,
      agentState,
      ruleEngine: engine,
      ruleStore,
      securityMode: 'interactive',
      workspaceRoot: '/tmp',
      sessionId: 's1',
      addMessage: () => ({ id: 'm1', role: 'tool', content: [] } as any),
      appendContent: () => {},
      emit: (c) => chunks.push(c),
    });
    expect(results[0].error).toBe('denied by rule');
  });

  it('auto-approves read-only tools without asking (no rule needed)', async () => {
    // 无任何 allow 规则；只读工具仍应直接执行，不触发审批
    const engine = new RuleEngine([]);
    const evaluator = createPermissionEvaluator('interactive', engine, { create: (i) => i });
    const results = await executeTools({
      toolCalls: [{ toolCallId: 'tc-1', toolName: 'read', input: { path: '/abs/path/with/slashes.md' } }],
      toolProvider: registry,
      permissionEvaluator: evaluator,
      agentState,
      ruleEngine: engine,
      ruleStore,
      securityMode: 'interactive',
      workspaceRoot: '/tmp',
      sessionId: 's1',
      addMessage: () => ({ id: 'm1', role: 'tool', content: [] } as any),
      appendContent: () => {},
      emit: (c) => chunks.push(c),
    });
    expect(results[0].output).toBe('ok');
    expect(chunks.some((c: any) => c.type === 'approval-request')).toBe(false);
  });

  it('still denies a read-only tool when an explicit deny rule matches', async () => {
    const engine = new RuleEngine([
      { permission: 'read', pattern: '**', action: 'deny', source: 'user-config' },
    ]);
    const evaluator = createPermissionEvaluator('interactive', engine, { create: (i) => i });
    const results = await executeTools({
      toolCalls: [{ toolCallId: 'tc-1', toolName: 'read', input: { path: '/abs/secret.md' } }],
      toolProvider: registry,
      permissionEvaluator: evaluator,
      agentState,
      ruleEngine: engine,
      ruleStore,
      securityMode: 'interactive',
      workspaceRoot: '/tmp',
      sessionId: 's1',
      addMessage: () => ({ id: 'm1', role: 'tool', content: [] } as any),
      appendContent: () => {},
      emit: (c) => chunks.push(c),
    });
    expect(results[0].error).toBe('denied by rule');
  });
});
