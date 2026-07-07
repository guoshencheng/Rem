import type { ModelMessage, ProviderChunk, LanguageModelUsage } from '../types.js';
import type { ErrorHandler } from '../sdk/error-handler.js';
import type { ToolSet, StreamChunk } from '../llm/types.js';
import { resolveProvider } from '../llm/api-registry.js';
import { InferenceEngine } from '../llm/engine.js';

export interface ReasonParams {
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  signal?: AbortSignal;
  errorHandler?: ErrorHandler;
}

export interface ReasonResult {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  reasoning?: string;
  usage: LanguageModelUsage;
  finishReason: string;
}

export async function reason(
  params: ReasonParams,
  emit: (chunk: ProviderChunk) => void,
): Promise<ReasonResult> {
  const llmProvider = resolveProvider(params.provider);
  const engine = new InferenceEngine();
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await engine.infer({
        messages: params.messages,
        stream: llmProvider.stream({
          model: params.model,
          apiKey: params.apiKey,
          baseURL: params.baseURL,
          system: params.system,
          messages: params.messages,
          tools: params.tools,
          signal: params.signal,
        }),
        onChunk: (chunk: StreamChunk) => {
          if (chunk.type === 'text') {
            emit({ type: 'text-delta', step: 0, text: chunk.text });
          } else if (chunk.type === 'reasoning') {
            emit({ type: 'reasoning-delta', step: 0, text: chunk.text });
          } else if (chunk.type === 'tool-call') {
            emit({ type: 'tool-call', step: 0, toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input });
          }
        },
      });

      return {
        text: result.text,
        toolCalls: result.toolCalls,
        reasoning: result.reasoning,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
          outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        },
        finishReason: result.finishReason ?? 'stop',
      };
    } catch (error) {
      lastError = error;
      if (!params.errorHandler) throw error;
      const category = params.errorHandler.classify(error);
      if (!params.errorHandler.isRetryable(category)) throw error;
      if (attempt === maxAttempts - 1) throw error;
    }
  }

  throw lastError;
}
