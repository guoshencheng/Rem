import type {
  AgentStreamChunk,
  LanguageModelUsage,
  ModelMessage,
} from '../../../types.js';
import type {
  ReasonContext,
  ReasonOutput,
  ReasonParams,
  ReasonProvider,
} from '../../../sdk/reason-provider.js';
import { resolveProvider } from '../../../llm/api-registry.js';
import { InferenceEngine } from '../../../llm/engine.js';
import type { ErrorHandler } from '../../../sdk/error-handler.js';
import type { StreamChunk } from '../../../llm/types.js';

export interface DefaultReasonProviderOptions {
  errorHandler: ErrorHandler;
  maxAttempts?: number;
}

export class DefaultReasonProvider implements ReasonProvider {
  private inferenceEngine = new InferenceEngine();

  constructor(private options: DefaultReasonProviderOptions) {}

  async reason(
    params: ReasonParams,
    ctx: ReasonContext,
    emit: (chunk: AgentStreamChunk) => void | Promise<void>,
  ): Promise<ReasonOutput> {
    const maxAttempts = this.options.maxAttempts ?? 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.runOnce(params, ctx, emit);
      } catch (error) {
        lastError = error;
        const category = this.options.errorHandler.classify(error);
        if (!this.options.errorHandler.isRetryable(category)) {
          throw error;
        }
        if (attempt === maxAttempts - 1) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private async runOnce(
    params: ReasonParams,
    ctx: ReasonContext,
    emit: (chunk: AgentStreamChunk) => void | Promise<void>,
  ): Promise<ReasonOutput> {
    const provider = resolveProvider(params.provider);
    const result = await this.inferenceEngine.infer({
      messages: params.messages,
      stream: provider.stream({
        model: params.model,
        apiKey: params.apiKey,
        baseURL: params.baseURL,
        system: params.system,
        messages: params.messages,
        tools: params.tools,
        signal: ctx.signal,
      }),
      onChunk: (chunk: StreamChunk) => {
        const agentChunk = this.mapChunk(chunk);
        if (agentChunk) {
          void emit(agentChunk);
        }
      },
    });

    const usage: LanguageModelUsage = {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    };

    return {
      text: result.text,
      toolCalls: result.toolCalls,
      reasoning: result.reasoning,
      usage,
      finishReason: result.finishReason ?? 'stop',
    };
  }

  private mapChunk(chunk: StreamChunk): AgentStreamChunk | null {
    if (chunk.type === 'text') {
      return { type: 'text-delta', step: 0, text: chunk.text };
    }
    if (chunk.type === 'reasoning') {
      return { type: 'reasoning-delta', step: 0, text: chunk.text };
    }
    if (chunk.type === 'tool-call') {
      return { type: 'tool-call', step: 0, toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input };
    }
    return null;
  }
}

export function createProvider(options: DefaultReasonProviderOptions): DefaultReasonProvider {
  return new DefaultReasonProvider(options);
}
