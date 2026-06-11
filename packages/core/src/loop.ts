import type { ModelMessage, ToolSet, LanguageModelUsage, LanguageModel, TextPart, ToolCallPart } from 'ai';
import { generateText } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { AgentOutput } from './types.js';
import type { ToolProvider, ToolCall } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';

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
    private toolProvider: ToolProvider,
    private memoryProvider: MemoryProvider,
    private compressor: ContextCompressor,
  ) {}

  async executeTurn(ctx: TurnContext, state: AgentState): Promise<TurnResult> {
    await this.events.emit('turn:before', { agent: this as any, state });

    state.currentTurn = ctx.turnNumber;

    // === 1. PREPARE: 消息组装 ===
    await this.events.emit('phase:prepare', { agent: this as any, state });

    const { systemPrompt, messages: contextMessages } = await this.memoryProvider.buildContext(state);

    let messages: ModelMessage[] = [
      ...contextMessages,
      { role: 'user', content: ctx.input.content },
    ];

    if (this.compressor.shouldCompress(state)) {
      messages = await this.compressor.compress(messages);
    }

    // === 2. REASON: 调用 LLM ===
    await this.events.emit('phase:reason:before', { agent: this as any, state });
    const tools = this.toolProvider.getToolSet();
    const response = await generateText({
      model: this.model,
      system: systemPrompt,
      messages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
    });
    await this.events.emit('phase:reason:after', { agent: this as any, state });

    // === 3. EXECUTE: 工具执行 ===
    let toolCallRecords: { toolCallId: string; toolName: string; input: unknown }[] = [];

    if (response.toolCalls.length > 0) {
      await this.events.emit('phase:execute:before', { agent: this as any, state });

      toolCallRecords = response.toolCalls.map(tc => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      }));

      const results = await this.toolProvider.execute(toolCallRecords);

      for (const result of results) {
        state.addMessage({
          role: 'tool',
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          content: result.error ?? result.output,
        } as ModelMessage);
      }

      await this.events.emit('phase:execute:after', { agent: this as any, state });
    }

    // === 4. OBSERVE: 更新状态 ===
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
      toolCalls: toolCallRecords,
      completed,
      shouldContinue: !completed,
      usage: response.usage,
    };
  }
}
