import type { ModelMessage, LanguageModelUsage, LanguageModel } from 'ai';
import type { Session } from './session.js';
import type { UserInput, AgentOutput, TurnResult } from './types.js';
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
  maxSteps?: number;
}

export interface TurnRunner {
  run(ctx: TurnContext, hooks: TurnHooks, controller: AgentStreamController): Promise<TurnResult>;
}

const DEFAULT_MAX_STEPS = 50;

export class ReactTurnRunner implements TurnRunner {
  constructor(private loopStrategy: LoopStrategy) {}

  async run(ctx: TurnContext, hooks: TurnHooks, controller: AgentStreamController): Promise<TurnResult> {
    const maxSteps = ctx.maxSteps ?? DEFAULT_MAX_STEPS;

    const session: Session = {
      sessionId: 'turn-internal',
      conversation: [...ctx.conversation],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const state = new AgentState(session, ctx.budget);

    const assistantMsg: ModelMessage = { role: 'assistant', content: [] } as unknown as ModelMessage;
    state.addMessage(assistantMsg);
    hooks.onMessageAdded(assistantMsg);

    const loopCtx: LoopContext = {
      state,
      systemPrompt: ctx.systemPrompt,
      model: ctx.model,
      budget: ctx.budget,
      signal: ctx.signal,
      provider: ctx.provider,
      providerConfig: ctx.providerConfig,
    };

    const allNewMessages: ModelMessage[] = [assistantMsg];
    const allToolCalls: { toolCallId: string; toolName: string; input: unknown }[] = [];
    let finalOutput: AgentOutput = { content: '', completed: false };
    let totalUsage: LanguageModelUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    };

    let step = 1;
    while (true) {
      if (ctx.signal?.aborted) {
        controller.fail(new Error('Turn aborted'));
        throw new Error('Turn aborted');
      }

      controller.stepStart(step);
      const result: LoopResult = await this.loopStrategy.iterate(loopCtx, hooks, controller, step);
      controller.stepFinish(step);

      for (const msg of result.newMessages) {
        if (!allNewMessages.includes(msg)) {
          allNewMessages.push(msg);
        }
      }
      allToolCalls.push(...result.toolCalls);
      finalOutput = result.finalOutput;
      totalUsage.inputTokens += result.usage.inputTokens;
      totalUsage.outputTokens += result.usage.outputTokens;
      totalUsage.totalTokens += result.usage.totalTokens;

      if (result.finalOutput.completed) {
        break;
      }

      if (step >= maxSteps) {
        finalOutput = { ...finalOutput, completed: false };
        break;
      }

      step++;
    }

    return {
      output: finalOutput,
      newMessages: allNewMessages,
      toolCalls: allToolCalls,
      usage: totalUsage,
      steps: step,
    };
  }
}

export type { TurnHooks } from './loop-strategy.js';
