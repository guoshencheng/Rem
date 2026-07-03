import type { AgentState } from './state.js';
import type { ToolCallRecord, UserInput, ModelMessage, LanguageModelUsage } from './types.js';
import { IterationBudget } from './budget.js';
import { AgentStreamController } from './stream/agent-stream.js';

export interface TurnHooks {
  onMessageAdded(msg: ModelMessage): void;
  onToolCallRecorded(record: ToolCallRecord): void;
}

export interface LoopContext {
  input?: UserInput;
  state: AgentState;
  systemPrompt: string;
  budget: IterationBudget;
  signal?: AbortSignal;
  provider?: string;
  providerConfig?: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
  sessionId?: string;
}

export interface LoopResult {
  content: string;
  newMessages: ModelMessage[];
  usage: LanguageModelUsage;
}

export interface LoopStrategy {
  iterate(ctx: LoopContext, hooks: TurnHooks, controller: AgentStreamController, step: number): Promise<LoopResult>;
}
