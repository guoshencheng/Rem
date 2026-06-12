import type { ModelMessage, LanguageModelUsage, LanguageModel } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { AgentOutput, ToolCallRecord } from './types.js';
import type { ToolProvider, ToolCall, ToolResult } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler, ErrorCategory } from './sdk/error-handler.js';
import { IterationBudget } from './budget.js';
import { InferenceEngine } from './llm/engine.js';

export interface TurnHooks {
  onMessageAdded(msg: ModelMessage): void;
  onToolCallRecorded(record: ToolCallRecord): void;
}

export interface LoopContext {
  state: AgentState;
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

export interface LoopResult {
  finalOutput: AgentOutput;
  newMessages: ModelMessage[];
  toolCallRecords: ToolCall[];
  usage: LanguageModelUsage;
  iterations: number;
}

export interface LoopStrategy {
  iterate(ctx: LoopContext, hooks: TurnHooks): Promise<LoopResult>;
}

export class ReactLoop implements LoopStrategy {
  private inferenceEngine = new InferenceEngine();

  constructor(
    private model: LanguageModel,
    private events: EventBus,
    private toolProvider: ToolProvider,
    private memoryProvider: MemoryProvider,
    private compressor: ContextCompressor,
    private errorHandler: ErrorHandler,
  ) {}

  async iterate(ctx: LoopContext, hooks: TurnHooks): Promise<LoopResult> {
    // 1. Emit 'turn:before' event
    await this.events.emit('turn:before', { agent: this as any, state: ctx.state });

    // 2. Call memoryProvider.buildContext(state) to get systemPrompt and messages
    await this.events.emit('phase:prepare', { agent: this as any, state: ctx.state });
    const { systemPrompt, messages: contextMessages } = await this.memoryProvider.buildContext(ctx.state);

    let messages: ModelMessage[] = [...contextMessages];

    // 3. Apply compression if compressor.shouldCompress(state) is true
    if (this.compressor.shouldCompress(ctx.state)) {
      await this.events.emit('compress:before', { agent: this as any, state: ctx.state });
      messages = await this.compressor.compress(messages);
      await this.events.emit('compress:after', { agent: this as any, state: ctx.state });
    }

    // 4. Call LLM via inferenceEngine.infer with retry logic (use errorHandler)
    await this.events.emit('phase:reason:before', { agent: this as any, state: ctx.state });

    const tools = this.toolProvider.getToolSet();
    const hasTools = Object.keys(tools).length > 0;

    let result: {
      text: string;
      toolCalls: ToolCall[];
      usage: LanguageModelUsage;
    };

    let retryCount = 0;
    const maxRetries = 3;

    while (true) {
      try {
        result = await this.inferenceEngine.infer({
          provider: ctx.provider,
          providerConfig: ctx.providerConfig,
          system: systemPrompt,
          messages,
          tools: hasTools ? tools : undefined,
          signal: ctx.signal,
        });
        break;
      } catch (error) {
        const category = this.errorHandler.classify(error);
        if (this.errorHandler.isRetryable(category) && retryCount < maxRetries) {
          retryCount++;
          continue;
        }
        throw error;
      }
    }

    await this.events.emit('phase:reason:after', { agent: this as any, state: ctx.state });

    // 5. If tool calls exist, execute them via toolProvider.execute
    const newMessages: ModelMessage[] = [];
    const toolCallRecords: ToolCall[] = [];

    if (result!.toolCalls.length > 0) {
      await this.events.emit('phase:execute:before', { agent: this as any, state: ctx.state });
      await this.events.emit('tool:before', { agent: this as any, state: ctx.state });

      const toolResults = await this.toolProvider.execute(result!.toolCalls);

      // 6. Add tool messages to state, newMessages, call hooks.onMessageAdded and hooks.onToolCallRecorded
      for (const tc of result!.toolCalls) {
        const tr = toolResults.find((r: ToolResult) => r.toolCallId === tc.toolCallId);
        const toolMsg: ModelMessage = {
          role: 'tool',
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          content: tr?.error ?? tr?.output ?? '',
        } as ModelMessage;

        ctx.state.addMessage(toolMsg);
        newMessages.push(toolMsg);

        const startTime = Date.now();
        const record: ToolCallRecord = {
          id: tc.toolCallId,
          name: tc.toolName,
          arguments: tc.input as Record<string, unknown>,
          result: tr
            ? {
                success: !tr.error,
                output: tr.output,
                error: tr.error,
                durationMs: 0,
              }
            : undefined,
          error: tr?.error,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        };

        toolCallRecords.push(tc);
        hooks.onToolCallRecorded(record);
      }

      await this.events.emit('tool:after', { agent: this as any, state: ctx.state });
      await this.events.emit('phase:execute:after', { agent: this as any, state: ctx.state });
    }

    // 7. Add assistant message to state, newMessages, call hooks.onMessageAdded
    const assistantContent = result!.toolCalls.length > 0
      ? result!.toolCalls.map(tc => ({
          type: 'tool-call' as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
        }))
      : result!.text;

    const assistantMsg: ModelMessage = {
      role: 'assistant',
      content: assistantContent,
    } as ModelMessage;

    ctx.state.addMessage(assistantMsg);
    newMessages.push(assistantMsg);
    hooks.onMessageAdded(assistantMsg);

    // 8. Emit 'turn:after' event
    await this.events.emit('turn:after', { agent: this as any, state: ctx.state });

    const completed = result!.toolCalls.length === 0;

    // 9. Return LoopResult
    return {
      finalOutput: {
        content: result!.text,
        completed,
      },
      newMessages,
      toolCallRecords,
      usage: result!.usage,
      iterations: 1,
    };
  }
}
