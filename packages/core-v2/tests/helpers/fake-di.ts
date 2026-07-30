import type { AgentDI, AgentRuntimeConfig, Session } from 'rem-agent-core';
import { createAgentAssembly, createDefaultAgentPaths, initializeAgentDI } from 'rem-agent-core';
import type { ConfigProvider, ResolvedAgentConfig, ResolvedAgentRole, ResolvedModelConfig, AgentBehaviorConfig, AgentToolConfig, CompressionConfig } from 'rem-agent-core';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMockModels } from './mock-models.js';

class FakeConfigProvider implements ConfigProvider {
  async init(): Promise<void> {}
  getConfig(): ResolvedAgentConfig {
    return { ...this.getBehaviorConfig(), model: this.getModelConfig() };
  }
  getModelConfig(): ResolvedModelConfig {
    return { provider: 'mock', model: 'mock-model', apiKey: 'mock-key' };
  }
  getToolConfig(): AgentToolConfig { return {}; }
  getBehaviorConfig(): Required<AgentBehaviorConfig> {
    return {
      name: 'TestAgent', maxTurns: 5, workspaceRoot: '/', readOnly: false,
      autoApproveDangerous: true, profile: 'coding', sessionRules: [],
      compression: this.getCompressionConfig(),
    };
  }
  getCompressionConfig(): Required<CompressionConfig> {
    return { enabled: false, thresholdRatio: 0.8, protectHead: 4, protectTail: 8 };
  }
  getMcpConfig(): Record<string, never> { return {}; }
  resolveAgent(): ResolvedAgentRole {
    return { id: 'default', name: 'TestAgent', corePrompt: '' };
  }
}

export interface FakeAssembly {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  cleanup: () => Promise<void>;
}

/** 用真实装配 + mock models（pi Agent 不会真正发流，除非测试主动 prompt） */
export async function createFakeAssembly(): Promise<FakeAssembly> {
  const dir = await mkdtemp(join(tmpdir(), 'core-v2-test-'));
  const paths = createDefaultAgentPaths({ agentDir: dir, homeAgentDir: dir });
  const models = createMockModels({ name: 'mock' });
  const { di, runtimeConfig } = createAgentAssembly({ paths, configProvider: new FakeConfigProvider(), models });
  await initializeAgentDI(di, { skipMcp: true });
  return { di, runtimeConfig, cleanup: async () => {} };
}

export function fakeSession(sessionId = 's-1'): Session {
  return {
    sessionId, conversation: [], currentTurn: 0,
    metadata: { schemaVersion: 2 }, createdAt: new Date(), updatedAt: new Date(),
  };
}
