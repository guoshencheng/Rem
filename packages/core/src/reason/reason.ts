import type { Message, Models, Context, Usage, ToolCall } from '@earendil-works/pi-ai';
import type { AgentStreamEvent } from '../types.js';
import type { ErrorHandler } from '../sdk/error-handler.js';
import type { ToolSet } from '../sdk/tool-provider.js';
import { toPiTool } from '../pi-adapter.js';
import { log } from '../shared/debug-log.js';

export { generate, type GenerateParams, type GenerateResult } from './generate.js';

export interface ReasonParams {
  models: Models;
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  system: string;
  messages: Message[];
  tools?: ToolSet;
  signal?: AbortSignal;
  errorHandler?: ErrorHandler;
  emit: (event: AgentStreamEvent) => void;
}

export interface ReasonResult {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  reasoning?: string;
  usage: Usage;
  finishReason: string;
}

export async function reason(params: ReasonParams): Promise<ReasonResult> {
  const { models } = params;
  const model = models.getModel(params.provider, params.model);
  if (!model) throw new Error(`Unknown model: ${params.provider}/${params.model}`);

  const context: Context = {
    systemPrompt: params.system,
    messages: params.messages,
    tools: params.tools ? Object.entries(params.tools).map(([name, schema]) => toPiTool(name, schema)) : undefined,
  };

  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      log('reason', 'retrying inference', { attempt, provider: params.provider, model: params.model });
    }
    try {
      log('reason', 'inference start', { provider: params.provider, model: params.model, messageCount: params.messages.length });
      const stream = models.stream(model, context, {
        apiKey: params.apiKey,
        baseURL: params.baseURL,
        signal: params.signal,
        maxRetries: 0,
      });

      for await (const event of stream) {
        params.emit(event);
      }

      const message = await stream.result();
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        throw new Error(message.errorMessage ?? `LLM stopped: ${message.stopReason}`);
      }
      const text = message.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const reasoning = message.content
        .filter((b): b is { type: 'thinking'; thinking: string } => b.type === 'thinking')
        .map((b) => b.thinking)
        .join('\n') || undefined;
      const toolCalls = message.content
        .filter((b): b is ToolCall => b.type === 'toolCall')
        .map((b) => ({ toolCallId: b.id, toolName: b.name, input: b.arguments as unknown }));
      return {
        text,
        reasoning,
        toolCalls,
        usage: message.usage,
        finishReason: message.stopReason ?? 'stop',
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
