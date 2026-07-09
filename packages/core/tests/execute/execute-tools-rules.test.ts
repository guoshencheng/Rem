import { describe, it, expect, beforeEach } from 'vitest';
import { executeTools } from '../../src/execute/execute-tools.js';
import { AgentToolRegistry } from '../../src/registry/tool-registry.js';
import { AgentState } from '../../src/agent-state.js';
import { RuleEngine } from '../../src/security/rules/rule-engine.js';
import { RuleStore } from '../../src/security/rules/rule-store.js';
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

    agentState = new AgentState();
    ruleStore = new RuleStore();
    chunks = [];
  });

  it('allows when rule matches allow', async () => {
    const engine = new RuleEngine([{ permission: 'echo', pattern: 'echo:hello*', action: 'allow', source: 'user-config' }]);
    const results = await executeTools({
      toolCalls: [{ toolCallId: 'tc-1', toolName: 'echo', input: { text: 'hello-world' } }],
      toolProvider: registry,
      agentState,
      ruleEngine: engine,
      ruleStore,
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
    const results = await executeTools({
      toolCalls: [{ toolCallId: 'tc-1', toolName: 'echo', input: { text: 'secret-key' } }],
      toolProvider: registry,
      agentState,
      ruleEngine: engine,
      ruleStore,
      workspaceRoot: '/tmp',
      sessionId: 's1',
      addMessage: () => ({ id: 'm1', role: 'tool', content: [] } as any),
      appendContent: () => {},
      emit: (c) => chunks.push(c),
    });
    expect(results[0].error).toBe('denied by rule');
  });
});
