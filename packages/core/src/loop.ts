import type { ModelMessage, ToolSet, LanguageModelUsage, LanguageModel } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { AgentOutput } from './types.js';
import type { ToolProvider, ToolCall } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import { InferenceEngine } from './llm/engine.js';

export interface TurnContext {
  input: { content: string };
  turnNumber: number;
  conversation: ModelMessage[];
  systemPrompt: string;
  availableTools: ToolSet;
  provider: string;
  providerConfig: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
}

export interface TurnResult {
  output: AgentOutput;
  toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
  completed: boolean;
  shouldContinue: boolean;
  usage: LanguageModelUsage;
}

export class AgentLoop {
  private inferenceEngine = new InferenceEngine();

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

    // === 2. REASON: 调用 InferenceEngine ===
    await this.events.emit('phase:reason:before', { agent: this as any, state });

    const tools = this.toolProvider.getToolSet();
    const { text, toolCalls, usage } = await this.inferenceEngine.infer({
      provider: ctx.provider,
      providerConfig: ctx.providerConfig,
      system: systemPrompt,
      messages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      onChunk: async (chunk) => {
        await this.events.emit('stream:chunk', { agent: this as any, state, chunk });
      },
    });

    await this.events.emit('phase:reason:after', { agent: this as any, state });

    // === 3. EXECUTE: 工具执行 ===
    const toolCallRecords: ToolCall[] = toolCalls.map(tc => ({
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      input: tc.input,
    }));

    if (toolCallRecords.length > 0) {
      await this.events.emit('phase:execute:before', { agent: this as any, state });

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
    state.addMessage({
      role: 'assistant',
      content: toolCallRecords.length > 0
        ? toolCallRecords.map(tc => ({ type: 'tool-call' as const, ...tc }))
        : text,
    });

    await this.events.emit('turn:after', { agent: this as any, state });

    const completed = toolCallRecords.length === 0;

    return {
      output: {
        content: text,
        completed,
      },
      toolCalls: toolCallRecords,
      completed,
      shouldContinue: !completed,
      usage,
    };
  }
}
