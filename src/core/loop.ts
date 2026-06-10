import type { Message, UserInput, AgentOutput, ToolDefinition, ToolCallRecord } from './types.js';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { ModelClient } from './model-client.js';

export interface TurnContext {
  input: UserInput;
  turnNumber: number;
  conversation: Message[];
  systemPrompt: string;
  availableTools: ToolDefinition[];
}

export interface TurnResult {
  output: AgentOutput;
  toolCalls: ToolCallRecord[];
  completed: boolean;
  shouldContinue: boolean;
}

export class AgentLoop {
  constructor(
    private modelClient: ModelClient,
    private events: EventBus,
  ) {}

  async executeTurn(ctx: TurnContext, state: AgentState): Promise<TurnResult> {
    await this.events.emit('turn:before', { harness: this as any, state });

    if (!state.budget.checkTurn()) {
      return {
        output: { content: 'Budget exceeded.', toolCalls: [], completed: true },
        toolCalls: [],
        completed: true,
        shouldContinue: false,
      };
    }

    state.currentTurn = ctx.turnNumber;

    const messages: Message[] = [
      { role: 'system', content: ctx.systemPrompt, timestamp: new Date() },
      ...ctx.conversation,
      { role: 'user', content: ctx.input.content, timestamp: new Date() },
    ];

    await this.events.emit('phase:reason:before', { harness: this as any, state });
    const response = await this.modelClient.chat(messages, {
      tools: ctx.availableTools,
    });
    await this.events.emit('phase:reason:after', { harness: this as any, state });

    if (!response.toolCalls || response.toolCalls.length === 0) {
      state.addMessage({ role: 'assistant', content: response.content, timestamp: new Date() });
      await this.events.emit('turn:after', { harness: this as any, state });
      return {
        output: { content: response.content, toolCalls: [], completed: true },
        toolCalls: [],
        completed: true,
        shouldContinue: false,
      };
    }

    state.addMessage({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
      timestamp: new Date(),
    });

    const toolCallRecords: ToolCallRecord[] = response.toolCalls.map(tc => ({
      ...tc,
      durationMs: 0,
      timestamp: new Date(),
    }));

    await this.events.emit('turn:after', { harness: this as any, state });

    return {
      output: {
        content: response.content,
        toolCalls: toolCallRecords,
        completed: false,
      },
      toolCalls: toolCallRecords,
      completed: false,
      shouldContinue: true,
    };
  }
}
