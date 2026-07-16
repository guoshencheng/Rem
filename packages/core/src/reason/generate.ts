import type { Message, Models, Context, AssistantMessage } from '@earendil-works/pi-ai';
import type { ErrorHandler } from '../sdk/error-handler.js';
import type { ToolSet } from '../sdk/tool-provider.js';
import { log } from '../shared/debug-log.js';

export interface GenerateParams {
  models: Models;
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  system: string;
  messages: Message[];
  tools?: ToolSet;
  signal?: AbortSignal;
  errorHandler?: ErrorHandler;
  responseFormat?: {
    type: 'json_schema' | 'json_object';
    json_schema?: {
      name: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };
  };
}

export async function generate(params: GenerateParams): Promise<AssistantMessage> {
  const { models } = params;
  const model = models.getModel(params.provider, params.model);
  if (!model) throw new Error(`Unknown model: ${params.provider}/${params.model}`);

  const context: Context = {
    systemPrompt: params.system,
    messages: params.messages,
    tools: params.tools,
  };

  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      log('generate', 'retrying inference', { attempt, provider: params.provider, model: params.model });
    }
    try {
      log('generate', 'inference start', { provider: params.provider, model: params.model, messageCount: params.messages.length });
      const message: AssistantMessage = await models.complete(model, context, {
        apiKey: params.apiKey || undefined,
        baseURL: params.baseURL || undefined,
        signal: params.signal,
        maxRetries: 0,
      });
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        throw new Error(message.errorMessage ?? `LLM stopped: ${message.stopReason}`);
      }
      return message;
    } catch (error) {
      const category = params.errorHandler?.classify(error) ?? 'unknown';
      const message = error instanceof Error ? error.message : String(error);
      log('generate', 'inference error', { attempt, provider: params.provider, model: params.model, category, error: message });
      lastError = error;
      if (!params.errorHandler) throw error;
      if (!params.errorHandler.isRetryable(category)) throw error;
      if (attempt === maxAttempts - 1) throw error;
    }
  }

  throw lastError;
}
