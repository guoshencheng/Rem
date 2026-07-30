import type { AssistantMessage, Context, Model, Models, Provider } from '@earendil-works/pi-ai';
import type {
  AgentBehaviorConfig, AgentToolConfig, CompressionConfig, ConfigProvider,
  ResolvedAgentConfig, ResolvedAgentRole, ResolvedModelConfig, Session,
} from 'rem-agent-core';
import {
  createAgentAssembly, createCoreModels, createDefaultAgentPaths, initializeAgentDI,
  REMAgent,
} from 'rem-agent-core';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

class ScriptedEventStream {
  private readonly resultValue: AssistantMessage;

  constructor(message: AssistantMessage) {
    this.resultValue = message;
  }

  async *[Symbol.asyncIterator]() {
    yield { type: 'start', partial: this.resultValue };
    yield { type: 'done', reason: 'stop', message: this.resultValue };
  }

  result(): Promise<AssistantMessage> {
    return Promise.resolve(this.resultValue);
  }
}

/** 每次 LLM 调用弹出一条脚本化 assistant 消息的 Models */
export function createScriptedModels(script: AssistantMessage[]): Models {
  const queue = [...script];
  const model = {
    id: 'mock-model', name: 'mock-model', api: 'openai-completions', provider: 'mock',
    baseUrl: '', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens: 4096,
  } as Model<any>;
  const stream = (_m: Model<any>, _c: Context) => {
    const next = queue.shift();
    if (!next) throw new Error('script exhausted');
    return new ScriptedEventStream(next);
  };
  const provider = {
    id: 'mock',
    name: 'mock',
    auth: { apiKey: { resolve: () => ({ auth: { apiKey: 'fake-key' }, source: 'env' }) }, oauth: undefined },
    getModels: () => [model],
    stream,
    streamSimple: stream,
    complete: async () => script[0],
    completeSimple: async () => script[0],
  } as unknown as Provider;
  const models = createCoreModels();
  models.setProvider(provider);
  return models;
}

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

export interface BridgeTestAgentParams {
  script: AssistantMessage[];
  agentId: string;
  sessionId: string;
  summary?: string;
}

/** 完整装配路径构造 REMAgent（scripted models 控制 LLM 响应） */
export async function createBridgeTestAgent(params: BridgeTestAgentParams): Promise<REMAgent> {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-test-'));
  const paths = createDefaultAgentPaths({ agentDir: dir, homeAgentDir: dir });
  const { di, runtimeConfig } = createAgentAssembly({
    paths,
    configProvider: new FakeConfigProvider(),
    models: createScriptedModels(params.script),
  });
  await initializeAgentDI(di);
  const session: Session = {
    sessionId: params.sessionId, conversation: [], currentTurn: 0,
    metadata: { schemaVersion: 2, title: 'test' }, createdAt: new Date(), updatedAt: new Date(),
  };
  const agent = new REMAgent({
    di,
    runtimeConfig,
    session,
    workspace: 'default',
    agentId: params.agentId,
    sessionId: params.sessionId,
    summary: params.summary,
  });
  return agent;
}
