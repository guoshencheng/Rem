import type { ModelMessage } from './types.js';
import type { Session } from './session.js';
import type { UserInput, TurnResult } from './types.js';
import { AgentState } from './state.js';
import { IterationBudget } from './budget.js';
import type { LoopStrategy, LoopContext, LoopResult, TurnHooks } from './loop-strategy.js';
import { AgentStreamController } from './stream/agent-stream.js';
import { generateId } from './shared/generate-id.js';

export interface TurnContext {
  input: UserInput;
  conversation: ModelMessage[];
  systemPrompt: string;
  budget: IterationBudget;
  signal?: AbortSignal;
  provider?: string;
  providerConfig?: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
  maxSteps?: number;
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
  sessionId?: string;
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

    const assistantMsg: ModelMessage = { id: generateId(), role: 'assistant', content: [] };
    state.addMessage(assistantMsg);
    hooks.onMessageAdded(assistantMsg);

    const loopCtx: LoopContext = {
      input: ctx.input,
      state,
      systemPrompt: ctx.systemPrompt,
      budget: ctx.budget,
      signal: ctx.signal,
      provider: ctx.provider,
      providerConfig: ctx.providerConfig,
      workspaceRoot: ctx.workspaceRoot,
      readOnly: ctx.readOnly,
      agentName: ctx.agentName,
      sessionId: ctx.sessionId,
    };

    const allNewMessages: ModelMessage[] = [assistantMsg];
    let content = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;

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
      content = result.content;
      inputTokens += result.usage.inputTokens ?? 0;
      outputTokens += result.usage.outputTokens ?? 0;
      totalTokens += result.usage.totalTokens ?? 0;

      if (result.newMessages.length === 0) {
        break;
      }

      if (step >= maxSteps) {
        break;
      }

      step++;
    }

    const lastMsg = state.conversation[state.conversation.length - 1];
    if (
      lastMsg &&
      lastMsg.role === 'assistant' &&
      lastMsg !== assistantMsg &&
      lastMsg.content.length > 0 &&
      !allNewMessages.includes(lastMsg)
    ) {
      allNewMessages.push(lastMsg);
    }

    return {
      content,
      newMessages: allNewMessages,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
    };
  }
}

export type { TurnHooks } from './loop-strategy.js';
