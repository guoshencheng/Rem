import type { AgentState } from '../state.js';
import type { IterationBudget } from '../budget.js';
import type { ModelMessage, LanguageModelUsage } from '../types.js';

export interface LoopContext {
  state: AgentState;
  system: string;
  messages: ModelMessage[];
  budget: IterationBudget;
  signal?: AbortSignal;
  maxSteps?: number;
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
  run(ctx: LoopContext): Promise<LoopResult>;
}
