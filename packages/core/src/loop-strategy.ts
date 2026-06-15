import type { ModelMessage, LanguageModelUsage, LanguageModel } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { AgentOutput, ToolCallRecord, AgentStreamChunk } from './types.js';
import type { ToolProvider, ToolCall, ToolResult } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler, ErrorCategory } from './sdk/error-handler.js';
import { IterationBudget } from './budget.js';
import { InferenceEngine, type InferenceResult } from './llm/engine.js';
import type { StreamChunk } from './llm/types.js';
import { AgentStreamController } from './stream/agent-stream.js';

type AssistantPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; output: string; error?: string };

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
  iterations: number;
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

    const assistantMsg = this.getCurrentAssistantMessage(ctx.state);
    const parts = (Array.isArray(assistantMsg.content)
      ? assistantMsg.content
      : []) as AssistantPart[];
    const stepChunks: AgentStreamChunk[] = [];

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
          const partIndex = this.appendChunkToParts(parts, agentChunk);
          const indexedChunk = { ...agentChunk, partIndex };
          controller.append(indexedChunk);
          stepChunks.push(indexedChunk);
        }
      },
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

        const toolResultChunk: AgentStreamChunk = {
          type: 'tool-result',
          step,
          partIndex: 0,
          toolCallId: tc.toolCallId,
          output: tr?.output ?? '',
          error: tr?.error,
        };
        const partIndex = this.appendChunkToParts(parts, toolResultChunk);
        const indexedToolResultChunk = { ...toolResultChunk, partIndex };
        controller.append(indexedToolResultChunk);
        stepChunks.push(indexedToolResultChunk);

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

    // 7. Assistant message parts were appended incrementally during streaming.
    // Ensure the assistant message is included in the turn result.
    if (!newMessages.includes(assistantMsg)) {
      newMessages.push(assistantMsg);
    }
    hooks.onMessageAdded(assistantMsg);

    // 8. Emit 'turn:after' event
    await this.events.emit('turn:after', { agent: this, state: ctx.state });

    const completed = inferResult.toolCalls.length === 0;

    // 9. Return LoopResult
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
      iterations: 1,
    };
  }

  private mapToAgentStreamChunk(chunk: StreamChunk, step: number): AgentStreamChunk | null {
    if (chunk.type === 'text') {
      return { type: 'text-delta', step, partIndex: 0, text: chunk.text };
    }
    if (chunk.type === 'reasoning') {
      return { type: 'reasoning-delta', step, partIndex: 0, text: chunk.text };
    }
    if (chunk.type === 'tool-call') {
      return { type: 'tool-call', step, partIndex: 0, toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input };
    }
    return null;
  }

  private appendChunkToParts(parts: AssistantPart[], chunk: AgentStreamChunk): number {
    if (chunk.type === 'text-delta') {
      const last = parts[parts.length - 1];
      if (last && last.type === 'text') {
        last.text += chunk.text;
        return parts.length - 1;
      }
      parts.push({ type: 'text', text: chunk.text });
      return parts.length - 1;
    }
    if (chunk.type === 'reasoning-delta') {
      const last = parts[parts.length - 1];
      if (last && last.type === 'reasoning') {
        last.text += chunk.text;
        return parts.length - 1;
      }
      parts.push({ type: 'reasoning', text: chunk.text });
      return parts.length - 1;
    }
    if (chunk.type === 'tool-call') {
      parts.push({
        type: 'tool-call',
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input,
      });
      return parts.length - 1;
    }
    if (chunk.type === 'tool-result') {
      parts.push({
        type: 'tool-result',
        toolCallId: chunk.toolCallId,
        output: chunk.output,
        error: chunk.error,
      });
      return parts.length - 1;
    }
    return -1;
  }

  private getCurrentAssistantMessage(state: AgentState): ModelMessage {
    const last = state.conversation[state.conversation.length - 1];
    if (last?.role === 'assistant') return last as ModelMessage;
    const msg: ModelMessage = { role: 'assistant', content: [] } as unknown as ModelMessage;
    state.addMessage(msg);
    return msg;
  }
}
