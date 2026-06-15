import type { ModelMessage, LanguageModelUsage, LanguageModel } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { AgentOutput, ToolCallRecord, AgentStreamChunk } from './types.js';
import type { ToolProvider, ToolCall, ToolResult } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import { IterationBudget } from './budget.js';
import { InferenceEngine, type InferenceResult } from './llm/engine.js';
import type { StreamChunk } from './llm/types.js';
import { AgentStreamController } from './stream/agent-stream.js';

export interface TurnHooks {
  onMessageAdded(msg: ModelMessage): void;
  onToolCallRecorded(record: ToolCallRecord): void;
}

export interface LoopContext {
  state: AgentState;
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

export interface LoopResult {
  finalOutput: AgentOutput;
  newMessages: ModelMessage[];
  toolCalls: ToolCall[];
  usage: LanguageModelUsage;
}

export interface LoopStrategy {
  iterate(ctx: LoopContext, hooks: TurnHooks, controller: AgentStreamController, step: number): Promise<LoopResult>;
}

export class ReactLoop implements LoopStrategy {
  private inferenceEngine = new InferenceEngine();

  constructor(
    private model: LanguageModel | undefined,
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

  async iterate(ctx: LoopContext, hooks: TurnHooks, controller: AgentStreamController, step: number): Promise<LoopResult> {
    await this.events.emit('turn:before', { agent: this, state: ctx.state });
    await this.events.emit('phase:prepare', { agent: this, state: ctx.state });
    const { systemPrompt, messages: contextMessages } = await this.memoryProvider.buildContext(ctx.state);

    let messages: ModelMessage[] = [...contextMessages];

    if (this.compressor.shouldCompress(ctx.state)) {
      await this.events.emit('compress:before', { agent: this, state: ctx.state });
      messages = await this.compressor.compress(messages);
      await this.events.emit('compress:after', { agent: this, state: ctx.state });
    }

    await this.events.emit('phase:reason:before', { agent: this, state: ctx.state });

    const tools = this.toolProvider.getToolSet();
    const hasTools = Object.keys(tools).length > 0;

    const assistantMsg = this.getCurrentAssistantMessage(ctx.state);

    const inferResult = await this.inferWithRetry({
      provider: ctx.provider ?? 'mock',
      providerConfig: ctx.providerConfig ?? { apiKey: '', model: 'default' },
      system: systemPrompt,
      messages,
      tools: hasTools ? tools : undefined,
      signal: ctx.signal,
      onChunk: (chunk) => {
        const agentChunk = this.mapToAgentStreamChunk(chunk, step);
        if (agentChunk) {
          controller.append(agentChunk);
        }
      },
    });

    await this.events.emit('phase:reason:after', { agent: this, state: ctx.state });

    const newMessages: ModelMessage[] = [];
    const toolCalls: ToolCall[] = [];

    if (inferResult.toolCalls.length > 0) {
      await this.events.emit('phase:execute:before', { agent: this, state: ctx.state });
      await this.events.emit('tool:before', { agent: this, state: ctx.state });

      const startTime = Date.now();
      const toolResults = await this.toolProvider.execute(inferResult.toolCalls);

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

        controller.append({
          type: 'tool-result',
          step,
          toolCallId: tc.toolCallId,
          output: tr?.output ?? '',
          error: tr?.error,
        });

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

    await this.events.emit('turn:after', { agent: this, state: ctx.state });

    const completed = inferResult.toolCalls.length === 0;

    return {
      finalOutput: {
        content: inferResult.text,
        completed,
      },
      newMessages,
      toolCalls,
      usage: {
        inputTokens: inferResult.usage.inputTokens,
        outputTokens: inferResult.usage.outputTokens,
        totalTokens: inferResult.usage.totalTokens,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
    };
  }

  private mapToAgentStreamChunk(chunk: StreamChunk, step: number): AgentStreamChunk | null {
    if (chunk.type === 'text') {
      return { type: 'text-delta', step, text: chunk.text };
    }
    if (chunk.type === 'reasoning') {
      return { type: 'reasoning-delta', step, text: chunk.text };
    }
    if (chunk.type === 'tool-call') {
      return { type: 'tool-call', step, toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input };
    }
    return null;
  }

  private getCurrentAssistantMessage(state: AgentState): ModelMessage {
    const last = state.conversation[state.conversation.length - 1];
    if (last?.role === 'assistant') return last as ModelMessage;
    throw new Error('ReactLoop expects assistant message to be created by ReactTurnRunner');
  }
}
