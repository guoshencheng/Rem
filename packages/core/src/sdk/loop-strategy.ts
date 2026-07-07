import type { AgentLiveState } from '../state.js';
import type { Session } from '../session.js';
import type { ModelMessage, LanguageModelUsage, ProviderChunk } from '../types.js';
import type { ToolSet } from '../llm/types.js';

export interface LoopContext {
  session: Session;
  liveState: AgentLiveState;
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  emit: (chunk: ProviderChunk) => void | Promise<void>;
  signal?: AbortSignal;
  maxSteps?: number;
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
  sessionId?: string;
  provider: string;
  modelConfig: {
    model: string;
    apiKey: string;
    baseURL?: string;
  };
}

export interface LoopResult {
  content: string;
  newMessages: ModelMessage[];
  usage: LanguageModelUsage;
}

export interface LoopStrategy {
  run(ctx: LoopContext): Promise<LoopResult>;
}
