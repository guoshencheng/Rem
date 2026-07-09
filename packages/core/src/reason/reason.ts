import type { ModelMessage, ProviderChunk, LanguageModelUsage } from '../types.js';
import type { ErrorHandler } from '../sdk/error-handler.js';
import type { ToolSet, StreamChunk } from '../llm/types.js';
import { resolveProvider } from '../llm/api-registry.js';
import { InferenceEngine } from '../llm/engine.js';
import { log } from '../shared/debug-log.js';

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
    if (attempt > 0) {
      log('reason', 'retrying inference', { attempt, provider: params.provider, model: params.model });
    }
    try {
      log('reason', 'inference start', { provider: params.provider, model: params.model, messageCount: params.messages.length });
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
          if (chunk.type === 'usage') {
            emit({
              type: 'usage',
              inputTokens: chunk.inputTokens,
              outputTokens: chunk.outputTokens,
              totalTokens: chunk.totalTokens,
              inputTokenDetails: chunk.inputTokenDetails,
              outputTokenDetails: chunk.outputTokenDetails,
            });
          } else if (chunk.type === 'text') {
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
          inputTokenDetails: result.usage.inputTokenDetails ?? { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
          outputTokenDetails: result.usage.outputTokenDetails ?? { textTokens: undefined, reasoningTokens: undefined },
        },
        finishReason: result.finishReason ?? 'stop',
      };
    } catch (error) {
      const category = params.errorHandler?.classify(error) ?? 'unknown';
      const message = error instanceof Error ? error.message : String(error);
      log('reason', 'inference error', { attempt, provider: params.provider, model: params.model, category, error: message });
      lastError = error;
      if (!params.errorHandler) throw error;
      if (!params.errorHandler.isRetryable(category)) throw error;
      if (attempt === maxAttempts - 1) throw error;
    }
  }

  throw lastError;
}
