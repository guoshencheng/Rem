import type { AgentState } from '../state.js';
import type { IterationBudget } from '../budget.js';
import type { ModelMessage, LanguageModelUsage, AgentStreamChunk } from '../types.js';
import type { ToolSet } from '../llm/types.js';

export interface LoopContext {
  state: AgentState;
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  budget: IterationBudget;
  emit: (chunk: AgentStreamChunk) => void | Promise<void>;
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
