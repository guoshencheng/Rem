import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { ToolCallRecord, UserInput, ModelMessage, LanguageModelUsage } from './types.js';
import type { ToolProvider, ToolResult, ToolContext } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import { InferenceEngine, type InferenceResult } from './llm/engine.js';
import { resolveProvider } from './llm/api-registry.js';
import type { StreamChunk } from './llm/types.js';
import { AgentStreamController, type RawChunk } from './stream/agent-stream.js';

import type { LoopContext, TurnHooks, LoopResult, LoopStrategy } from './loop-types.js';
export type { TurnHooks, LoopContext, LoopResult, LoopStrategy } from './loop-types.js';

export class ReactLoop implements LoopStrategy {
  private inferenceEngine = new InferenceEngine();

  constructor(
    private events: EventBus,
    private toolProvider: ToolProvider,
    private memoryProvider: MemoryProvider,
    private compressor: ContextCompressor,
    private errorHandler: ErrorHandler,
    private skillProvider?: SkillProvider,
  ) {}

  private async inferWithRetry(
    messages: ModelMessage[],
    createStream: () => AsyncIterable<import('./llm/types.js').StreamChunk>,
    onChunk?: (chunk: import('./llm/types.js').StreamChunk) => void | Promise<void>,
  ): Promise<InferenceResult> {
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.inferenceEngine.infer({
          messages,
          stream: createStream(),
          onChunk,
        });
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

    const systemWithSkills = await this.enrichSystemPrompt(systemPrompt);

    const tools = this.toolProvider.getToolSet();
    const hasTools = Object.keys(tools).length > 0;

    const assistantMsg = this.getOrCreateAssistantMessage(ctx.state);

    const provider = resolveProvider(ctx.provider ?? 'mock');
    const providerConfig = ctx.providerConfig ?? { apiKey: '', model: 'default' };

    let inferResult: InferenceResult;
    try {
      inferResult = await this.inferWithRetry(
        messages,
        () => provider.stream({
          model: providerConfig.model,
          apiKey: providerConfig.apiKey,
          baseURL: providerConfig.baseURL,
          system: systemWithSkills,
          messages,
          tools: hasTools ? tools : undefined,
          signal: ctx.signal,
        }),
        (chunk) => {
          const agentChunk = this.mapToAgentStreamChunk(chunk, step);
          if (agentChunk) {
            controller.append(agentChunk);
          }
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.events.emit('phase:reason:error', { agent: this, state: ctx.state, error });
      return {
        content: `Error during reasoning: ${message}`,
        newMessages: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
          outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        },
      };
    }

    this.appendToAssistantMessage(assistantMsg, inferResult);

    await this.events.emit('phase:reason:after', { agent: this, state: ctx.state });

    const newMessages: ModelMessage[] = [];

    if (inferResult.toolCalls.length > 0) {
      await this.events.emit('phase:execute:before', { agent: this, state: ctx.state });
      await this.events.emit('tool:before', { agent: this, state: ctx.state });

      const startTime = Date.now();
      const toolCtx: ToolContext = {
        cwd: ctx.workspaceRoot,
        workspaceRoot: ctx.workspaceRoot,
        signal: ctx.signal,
        agentName: ctx.agentName,
        readOnly: ctx.readOnly,
      };
      const toolResults = await this.toolProvider.execute(inferResult.toolCalls, toolCtx);

      for (const tc of inferResult.toolCalls) {
        const tr = toolResults.find((r: ToolResult) => r.toolCallId === tc.toolCallId);
    const toolMsg: ModelMessage = {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        output: tr?.error ?? tr?.output ?? '',
      }],
    };

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

        hooks.onToolCallRecorded(record);
      }

      await this.events.emit('tool:after', { agent: this, state: ctx.state });
      await this.events.emit('phase:execute:after', { agent: this, state: ctx.state });
    }

    await this.events.emit('turn:after', { agent: this, state: ctx.state });

    let outputContent = inferResult.text;
    if (inferResult.finishReason === 'length' && !outputContent.trim()) {
      outputContent = '(Model hit output token limit. Consider increasing maxTokens.)';
    }

    return {
      content: outputContent,
      newMessages,
      usage: {
        inputTokens: inferResult.usage.inputTokens,
        outputTokens: inferResult.usage.outputTokens,
        totalTokens: inferResult.usage.totalTokens,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
    };
  }

  private mapToAgentStreamChunk(chunk: StreamChunk, step: number): RawChunk | null {
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

  private getOrCreateAssistantMessage(state: AgentState): ModelMessage {
    const last = state.conversation[state.conversation.length - 1];
    if (last?.role === 'assistant') return last as ModelMessage;
    const msg: ModelMessage = { role: 'assistant', content: [] };
    state.addMessage(msg);
    return msg;
  }

  private async enrichSystemPrompt(basePrompt: string): Promise<string> {
    if (!this.skillProvider) {
      return basePrompt;
    }

    const skills = await this.skillProvider.loadSkills();
    const catalog = this.skillProvider.formatCatalog(skills);
    if (!catalog) {
      return basePrompt;
    }

    return `${basePrompt}\n\n${catalog}`;
  }

  private appendToAssistantMessage(assistantMsg: ModelMessage, inferResult: InferenceResult): void {
    const content = assistantMsg.content;

    if (inferResult.reasoning) {
      content.push({ type: 'reasoning', text: inferResult.reasoning });
    }

    if (inferResult.text) {
      content.push({ type: 'text', text: inferResult.text });
    }

    for (const tc of inferResult.toolCalls) {
      content.push({
        type: 'tool-call',
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        arguments: tc.input,
      });
    }
  }
}
