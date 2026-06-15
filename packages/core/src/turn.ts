import type { ModelMessage, LanguageModelUsage, LanguageModel } from 'ai';
import type { Session } from './session.js';
import type { UserInput, AgentOutput } from './types.js';
import { AgentState } from './state.js';
import { IterationBudget } from './budget.js';
import type { LoopStrategy, LoopContext, LoopResult, TurnHooks } from './loop-strategy.js';
import { AgentStreamController } from './stream/agent-stream.js';

export interface TurnContext {
  input: UserInput;
  conversation: ModelMessage[];
  systemPrompt: string;
  model?: LanguageModel;
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
  run(ctx: TurnContext, hooks: TurnHooks, controller: AgentStreamController): Promise<TurnResult>;
}

export class ReactTurnRunner implements TurnRunner {
  constructor(private loopStrategy: LoopStrategy) {}

  async run(ctx: TurnContext, hooks: TurnHooks, controller: AgentStreamController): Promise<TurnResult> {
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

    // Create the single assistant message for this run
    const assistantMsg: ModelMessage = { role: 'assistant', content: [] } as unknown as ModelMessage;
    state.addMessage(assistantMsg);

    const loopCtx: LoopContext = {
      state,
      systemPrompt: ctx.systemPrompt,
      model: ctx.model,
      budget: ctx.budget,
      signal: ctx.signal,
      provider: ctx.provider,
      providerConfig: ctx.providerConfig,
    };

    const step = 1;
    controller.append({ type: 'step-start', step });
    const loopResult: LoopResult = await this.loopStrategy.iterate(loopCtx, hooks, controller, step);
    controller.append({ type: 'step-finish', step });

    return {
      output: loopResult.finalOutput,
      newMessages: loopResult.newMessages,
      toolCalls: loopResult.toolCalls,
      usage: loopResult.usage,
    };
  }
}

export type { TurnHooks } from './loop-strategy.js';
