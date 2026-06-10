import type { ModelMessage, ToolSet, LanguageModelUsage, LanguageModel } from 'ai';
import { generateText } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { AgentOutput, ToolCallRecord } from './types.js';

export interface TurnContext {
  input: { content: string };
  turnNumber: number;
  conversation: ModelMessage[];
  systemPrompt: string;
  availableTools: ToolSet;
}

export interface TurnResult {
  output: AgentOutput;
  toolCalls: ToolCallRecord[];
  completed: boolean;
  shouldContinue: boolean;
  usage: LanguageModelUsage;
}

export class AgentLoop {
  constructor(
    private model: LanguageModel,
    private events: EventBus,
  ) {}

  async executeTurn(ctx: TurnContext, state: AgentState): Promise<TurnResult> {
    await this.events.emit('turn:before', { agent: this as any, state });

    if (!state.budget.checkTurn()) {
      return {
        output: { content: 'Budget exceeded.', toolCalls: [], completed: true },
        toolCalls: [],
        completed: true,
        shouldContinue: false,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokenDetails: { textTokens: 0, reasoningTokens: 0 } } as LanguageModelUsage,
      };
    }

    state.currentTurn = ctx.turnNumber;

    const messages: ModelMessage[] = [
      ...ctx.conversation,
      { role: 'user', content: ctx.input.content },
    ];

    await this.events.emit('phase:reason:before', { agent: this as any, state });
    const response = await generateText({
      model: this.model,
      system: ctx.systemPrompt,
      messages,
      tools: Object.keys(ctx.availableTools).length > 0 ? ctx.availableTools : undefined,
    });
    await this.events.emit('phase:reason:after', { agent: this as any, state });

    state.addMessage({ role: 'assistant', content: response.text });

    const toolCalls: ToolCallRecord[] = response.toolCalls.map(tc => ({
      id: tc.toolCallId,
      name: tc.toolName,
      arguments: 'input' in tc ? tc.input as Record<string, unknown> : {},
      durationMs: 0,
      timestamp: new Date(),
    }));

    for (const tc of toolCalls) {
      state.addToolCall(tc);
    }

    await this.events.emit('turn:after', { agent: this as any, state });

    const completed = response.toolCalls.length === 0;

    return {
      output: {
        content: response.text,
        toolCalls,
        completed,
      },
      toolCalls,
      completed,
      shouldContinue: !completed,
      usage: response.usage,
    };
  }
}
