import type { ModelMessage, LanguageModelUsage, LanguageModel } from 'ai';
import type { Session } from './session.js';
import type { UserInput, AgentOutput } from './types.js';
import { AgentState } from './state.js';
import { IterationBudget } from './budget.js';
import type { LoopStrategy, LoopContext, LoopResult, TurnHooks } from './loop-strategy.js';

export interface TurnContext {
  input: UserInput;
  conversation: ModelMessage[];
  systemPrompt: string;
  model: LanguageModel;
  budget: IterationBudget;
  signal?: AbortSignal;
  provider?: string;
  providerConfig?: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
}

export interface TurnResult {
  output: AgentOutput;
  newMessages: ModelMessage[];
  toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
  usage: LanguageModelUsage;
}

export interface TurnRunner {
  run(ctx: TurnContext, hooks: TurnHooks): Promise<TurnResult>;
}

export class ReactTurnRunner implements TurnRunner {
  constructor(private loopStrategy: LoopStrategy) {}

  async run(ctx: TurnContext, hooks: TurnHooks): Promise<TurnResult> {
    // Create internal Session/AgentState so we don't mutate caller's session
    const session: Session = {
      sessionId: 'turn-internal',
      conversation: [...ctx.conversation],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const state = new AgentState(session, ctx.budget);

    const loopCtx: LoopContext = {
      state,
      systemPrompt: ctx.systemPrompt,
      model: ctx.model,
      budget: ctx.budget,
      signal: ctx.signal,
      provider: ctx.provider,
      providerConfig: ctx.providerConfig,
    };

    const loopResult: LoopResult = await this.loopStrategy.iterate(loopCtx, hooks);

    return {
      output: loopResult.finalOutput,
      newMessages: loopResult.newMessages,
      toolCalls: loopResult.toolCalls,
      usage: loopResult.usage,
    };
  }
}

export type { TurnHooks } from './loop-strategy.js';
