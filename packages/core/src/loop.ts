import type { ModelMessage, ToolSet, LanguageModelUsage, LanguageModel, TextPart, ToolCallPart } from 'ai';
import { generateText } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { AgentOutput } from './types.js';

export interface TurnContext {
  input: { content: string };
  turnNumber: number;
  conversation: ModelMessage[];
  systemPrompt: string;
  availableTools: ToolSet;
}

export interface TurnResult {
  output: AgentOutput;
  toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
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
        output: { content: 'Budget exceeded.', completed: true },
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

    const parts: Array<TextPart | ToolCallPart> = [];
    if (response.text) {
      parts.push({ type: 'text', text: response.text });
    }
    for (const tc of response.toolCalls) {
      parts.push({
        type: 'tool-call',
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      });
    }

    state.addMessage({
      role: 'assistant',
      content: parts.length === 1 && parts[0].type === 'text'
        ? parts[0].text
        : parts,
    });

    await this.events.emit('turn:after', { agent: this as any, state });

    const completed = response.toolCalls.length === 0;

    return {
      output: {
        content: response.text,
        completed,
      },
      toolCalls: response.toolCalls.map(tc => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      })),
      completed,
      shouldContinue: !completed,
      usage: response.usage,
    };
  }
}
