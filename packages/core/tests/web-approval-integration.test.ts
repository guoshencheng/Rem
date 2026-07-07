import { describe, it, expect, beforeEach } from 'vitest';
import { registerProvider, clearProviders } from '../src/llm/api-registry.js';
import { createProviderManager } from '../src/provider-manager.js';
import type { ConfigProvider, ResolvedModelConfig, AgentConfig, AgentBehaviorConfig, AgentToolConfig } from '../src/sdk/config-provider.js';
import { runAgent } from '../src/run-agent.js';
import { BridgeAgentStateProvider } from '../../bridge/src/agent-state-provider.js';

function createMockConfigProvider(): ConfigProvider {
  return {
    async init() {},
    getModelConfig(): ResolvedModelConfig {
      return {
        provider: 'mock-writer',
        model: 'mock-model',
        apiKey: 'fake-key',
        baseURL: undefined,
      };
    },
    getBehaviorConfig(): Required<AgentBehaviorConfig> {
      return {
        name: 'TestAgent',
        maxTurns: 10,
        workspaceRoot: process.cwd(),
        readOnly: false,
        autoApproveDangerous: false,
        sessionsDir: '/tmp/sessions',
      };
    },
    getToolConfig(): AgentToolConfig {
      return { policy: {} };
    },
    getConfig(): AgentConfig {
      return {
        ...this.getBehaviorConfig(),
        model: this.getModelConfig(),
        policy: this.getToolConfig().policy,
      };
    },
    getMcpConfig() {
      return {};
    },
  };
}

describe('web-like approval integration', () => {
  beforeEach(() => {
    clearProviders();
  });

  it('requests approval for write tool via provider manager', async () => {
    registerProvider('mock-writer', {
      generate: async () => ({
        text: '',
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
      stream: async function* () {
        yield {
          type: 'tool-call' as const,
          toolCallId: 'tc-write-1',
          toolName: 'write',
          input: { path: './poem.txt', content: 'A poem' },
        };
        yield { type: 'usage' as const, inputTokens: 5, outputTokens: 5, totalTokens: 10 };
      },
    });

    const configProvider = createMockConfigProvider();
    const stateProvider = new BridgeAgentStateProvider();
    const sessionProvider = {
      async load() {
        return null;
      },
      async save() {},
    };

    const pm = await createProviderManager({
      configProvider,
      sessionProvider: sessionProvider as any,
      agentStateProvider: stateProvider,
    });

    const result = runAgent({
      input: { content: '写一首诗到当前的工作空间', timestamp: new Date() },
      sessionId: 'test-session',
      pm,
    });

    const chunks: any[] = [];
    for await (const chunk of result.stream.fullStream) {
      chunks.push(chunk);
      if (chunk.type === 'approval-request') {
        break;
      }
    }

    expect(chunks.some((c) => c.type === 'approval-request' && c.sessionId === 'test-session')).toBe(true);
    expect(
      chunks.some(
        (c) =>
          c.type === 'approval-request' &&
          c.request.toolName === 'write' &&
          c.request.allowedDecisions.includes('allow-once'),
      ),
    ).toBe(true);
  });
});
