import type { ModelMessage, LanguageModelUsage, LanguageModel } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { AgentOutput, ToolCallRecord } from './types.js';
import type { ToolProvider, ToolCall, ToolResult } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler, ErrorCategory } from './sdk/error-handler.js';
import { IterationBudget } from './budget.js';
import { InferenceEngine, type InferenceResult } from './llm/engine.js';

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
  toolCalls: ToolCall[];
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

  private async inferWithRetry(options: Parameters<InferenceEngine['infer']>[0]): Promise<InferenceResult> {
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.inferenceEngine.infer(options);
      } catch (error) {
        lastError = error;
        const category = this.errorHandler.classify(error);
        if (!this.errorHandler.isRetryable(category)) {
          throw error;
        }
        if (attempt === maxAttempts - 1) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  async iterate(ctx: LoopContext, hooks: TurnHooks): Promise<LoopResult> {
    // 1. Emit 'turn:before' event
    await this.events.emit('turn:before', { agent: this, state: ctx.state });

    // 2. Call memoryProvider.buildContext(state) to get systemPrompt and messages
    await this.events.emit('phase:prepare', { agent: this, state: ctx.state });
    const { systemPrompt, messages: contextMessages } = await this.memoryProvider.buildContext(ctx.state);

    let messages: ModelMessage[] = [...contextMessages];

    // 3. Apply compression if compressor.shouldCompress(state) is true
    if (this.compressor.shouldCompress(ctx.state)) {
      await this.events.emit('compress:before', { agent: this, state: ctx.state });
      messages = await this.compressor.compress(messages);
      await this.events.emit('compress:after', { agent: this, state: ctx.state });
    }

    // 4. Call LLM via inferenceEngine.infer with retry logic (use errorHandler)
    await this.events.emit('phase:reason:before', { agent: this, state: ctx.state });

    const tools = this.toolProvider.getToolSet();
    const hasTools = Object.keys(tools).length > 0;

    const inferResult = await this.inferWithRetry({
      provider: ctx.provider,
      providerConfig: ctx.providerConfig,
      system: systemPrompt,
      messages,
      tools: hasTools ? tools : undefined,
      signal: ctx.signal,
    });

    await this.events.emit('phase:reason:after', { agent: this, state: ctx.state });

    // 5. If tool calls exist, execute them via toolProvider.execute
    const newMessages: ModelMessage[] = [];
    const toolCalls: ToolCall[] = [];

    if (inferResult.toolCalls.length > 0) {
      await this.events.emit('phase:execute:before', { agent: this, state: ctx.state });
      await this.events.emit('tool:before', { agent: this, state: ctx.state });

      const startTime = Date.now();
      const toolResults = await this.toolProvider.execute(inferResult.toolCalls);

      // 6. Add tool messages to state, newMessages, call hooks.onMessageAdded and hooks.onToolCallRecorded
      for (const tc of inferResult.toolCalls) {
        const tr = toolResults.find((r: ToolResult) => r.toolCallId === tc.toolCallId);
        const toolMsg: ModelMessage = {
          role: 'tool',
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          content: tr?.error ?? tr?.output ?? '',
        } as unknown as ModelMessage;

        ctx.state.addMessage(toolMsg);
        newMessages.push(toolMsg);
        hooks.onMessageAdded(toolMsg);

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

        toolCalls.push(tc);
        hooks.onToolCallRecorded(record);
      }

      await this.events.emit('tool:after', { agent: this, state: ctx.state });
      await this.events.emit('phase:execute:after', { agent: this, state: ctx.state });
    }

    // 7. Add assistant message to state, newMessages, call hooks.onMessageAdded
    const assistantContent = inferResult.toolCalls.length > 0
      ? inferResult.toolCalls.map(tc => ({
          type: 'tool-call' as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
        }))
      : inferResult.text;

    const assistantMsg: ModelMessage = {
      role: 'assistant',
      content: assistantContent,
    } as ModelMessage;

    ctx.state.addMessage(assistantMsg);
    newMessages.push(assistantMsg);
    hooks.onMessageAdded(assistantMsg);

    // 8. Emit 'turn:after' event
    await this.events.emit('turn:after', { agent: this, state: ctx.state });

    const completed = inferResult.toolCalls.length === 0;

    // 9. Return LoopResult
    // ReactLoop.iterate() currently performs one LLM+tools pass;
    // future multi-step ReAct will increment this.
    return {
      finalOutput: {
        content: inferResult.text,
        completed,
      },
      newMessages,
      toolCalls,
      usage: inferResult.usage,
      iterations: 1,
    };
  }
}
