import type { AgentDI, AgentRuntimeConfig, Session } from 'rem-agent-core';
import { createAgentAssembly, createDefaultAgentPaths, initializeAgentDI } from 'rem-agent-core';
import type { ConfigProvider, ResolvedAgentConfig, ResolvedAgentRole, ResolvedModelConfig, AgentBehaviorConfig, AgentToolConfig, CompressionConfig, ToolProvider } from 'rem-agent-core';
import type { Models } from '@earendil-works/pi-ai';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMockModels } from './mock-models.js';

class FakeConfigProvider implements ConfigProvider {
  constructor(private maxTurns = 5) {}
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
      name: 'TestAgent', maxTurns: this.maxTurns, workspaceRoot: '/', readOnly: false,
      autoApproveDangerous: true,
      compression: this.getCompressionConfig(),
    };
  }
  getCompressionConfig(): Required<CompressionConfig> {
    return { enabled: false, thresholdRatio: 0.8, protectHead: 4, protectTail: 8 };
  }
  resolveAgent(): ResolvedAgentRole {
    return { id: 'default', name: 'TestAgent', corePrompt: '' };
  }
}

export interface FakeAssembly {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  cleanup: () => Promise<void>;
}

export interface FakeAssemblyOptions {
  models?: Models;
  toolProvider?: ToolProvider;
  maxTurns?: number;
}

/** 用真实装配 + mock models（LLM 响应由注入的 models 脚本化） */
export async function createFakeAssembly(options: FakeAssemblyOptions = {}): Promise<FakeAssembly> {
  const dir = await mkdtemp(join(tmpdir(), 'core-v2-test-'));
  const paths = createDefaultAgentPaths({ agentDir: dir, homeAgentDir: dir });
  const models = options.models ?? createMockModels({ name: 'mock' });
  const { di, runtimeConfig } = createAgentAssembly({
    paths,
    configProvider: new FakeConfigProvider(options.maxTurns ?? 5),
    models,
    toolProvider: options.toolProvider,
  });
  await initializeAgentDI(di);
  return { di, runtimeConfig, cleanup: async () => {} };
}

export function fakeSession(sessionId = 's-1'): Session {
  return {
    sessionId, conversation: [], currentTurn: 0,
    metadata: { schemaVersion: 2 }, createdAt: new Date(), updatedAt: new Date(),
  };
}
