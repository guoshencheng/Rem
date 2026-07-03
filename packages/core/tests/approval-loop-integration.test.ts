import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Type } from '@sinclair/typebox';
import { ReactLoop } from '../src/loop-strategy.js';
import { AgentState } from '../src/state.js';
import { EventBus } from '../src/events.js';
import { IterationBudget } from '../src/budget.js';
import { AgentStreamController } from '../src/stream/agent-stream.js';
import { AgentToolRegistry } from '../src/registry/tool-registry.js';
import { ApprovalOrchestrator } from '../src/security/approval-orchestrator.js';
import { ApprovalManager } from '../src/security/approval-manager.js';
import { InMemoryAgentStateProvider } from '../src/plugins/state/in-memory/index.js';
import { SimpleErrorHandler } from '../src/plugins/error/simple/index.js';
import { SimpleMemoryProvider } from '../src/plugins/memory/simple/index.js';
import { NoOpCompressor } from '../src/plugins/compressor/no-op/index.js';
import { registerProvider, clearProviders } from '../src/llm/api-registry.js';

const echoSchema = Type.Object({ msg: Type.String() }, { additionalProperties: false });
const sessionId = 'approval-loop-integration-session';

describe('dangerous tool approval loop integration', () => {
  beforeEach(() => {
    clearProviders();
  });

  it('requests approval, resolves it, and executes the dangerous tool', async () => {
    registerProvider('dangerous-mock', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'tool-call', toolCallId: 'tc1', toolName: 'dangerous_echo', input: { msg: 'hello' } };
        yield { type: 'usage', inputTokens: 5, outputTokens: 5, totalTokens: 10 };
      },
    });

    const stateProvider = new InMemoryAgentStateProvider();
    const orchestrator = new ApprovalOrchestrator(stateProvider, new ApprovalManager());

    const registry = new AgentToolRegistry({
      workspaceRoot: '/tmp',
      approvalOrchestrator: orchestrator,
    });
    registry.register(
      {
        name: 'dangerous_echo',
        description: 'Echo that is marked dangerous',
        parameters: echoSchema,
        dangerous: true,
      },
      async ({ msg }) => ({ output: `echo:${msg}` }),
    );

    const loop = new ReactLoop(
      new EventBus(),
      registry,
      new SimpleMemoryProvider('test'),
      new NoOpCompressor(),
      new SimpleErrorHandler(),
    );

    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    state.addMessage({ role: 'assistant', content: [] });

    const controller = new AgentStreamController();
    const hooks = {
      onMessageAdded: vi.fn(),
      onToolCallRecorded: vi.fn(),
    };

    const iteratePromise = loop.iterate(
      {
        state,
        systemPrompt: 'You are test',
        budget: state.budget,
        provider: 'dangerous-mock',
        providerConfig: { apiKey: 'key', model: 'model' },
        workspaceRoot: '/tmp',
        sessionId,
      },
      hooks,
      controller,
      1,
    );

    const finishPromise = iteratePromise.then((result) => {
      controller.finish({ content: result.content, completed: true });
      return result;
    });

    const chunks: any[] = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
      if (chunk.type === 'approval-request') {
        orchestrator.resolveApproval(chunk.request.approvalId, 'allow-once');
      }
    }

    const result = await finishPromise;

    expect(chunks.some((c) => c.type === 'approval-request' && c.sessionId === sessionId)).toBe(true);
    expect(chunks.some((c) => c.type === 'approval-resolved' && c.decision === 'allow-once')).toBe(true);
    expect(result.newMessages.some((m) => m.role === 'tool')).toBe(true);
    expect(hooks.onToolCallRecorded).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'dangerous_echo',
        result: expect.objectContaining({ success: true, output: 'echo:hello' }),
      }),
    );
  });
});
