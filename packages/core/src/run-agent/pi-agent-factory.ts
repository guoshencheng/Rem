import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentOptions, AgentTool, StreamFn } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { AgentDI } from '../agent-di.js';
import type { ResolvedModelConfig } from '../sdk/config-provider.js';

export interface PiAgentFactoryParams {
  di: AgentDI;
  effectiveModel: ResolvedModelConfig;
  systemPrompt: string;
  messages: Message[];
  tools: AgentTool[];
  beforeToolCall: NonNullable<AgentOptions['beforeToolCall']>;
  transformContext: NonNullable<AgentOptions['transformContext']>;
  maxTurns: number;
  signal?: AbortSignal;
}

export function createPiAgent(params: PiAgentFactoryParams): Agent {
  const { di, effectiveModel } = params;
  const model = di.models.getModel(effectiveModel.provider, effectiveModel.model);
  if (!model) throw new Error(`Unknown model: ${effectiveModel.provider}/${effectiveModel.model}`);

  const streamFn: StreamFn = (m, context, options) =>
    di.models.streamSimple(m, context, {
      ...options,
      thinkingEnabled: true,
      apiKey: effectiveModel.apiKey || undefined,
      baseURL: effectiveModel.baseURL || undefined,
    });

  const agent = new Agent({
    initialState: {
      systemPrompt: params.systemPrompt,
      model,
      thinkingLevel: effectiveModel.reasoning ?? 'off',
      tools: params.tools,
      messages: params.messages,
    },
    streamFn,
    getApiKey: () => effectiveModel.apiKey || undefined,
    beforeToolCall: params.beforeToolCall,
    transformContext: params.transformContext,
    toolExecution: 'sequential',
    steeringMode: 'all',
    followUpMode: 'one-at-a-time',
  });

  let turns = 0;
  agent.subscribe((event) => {
    if (event.type === 'turn_end') {
      turns += 1;
      if (turns >= params.maxTurns) void agent.abort();
    }
  });

  params.signal?.addEventListener('abort', () => { void agent.abort(); });

  return agent;
}
