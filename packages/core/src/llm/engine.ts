import { getProvider } from './api-registry.js';
import type { LanguageModelUsage } from '../types.js';
import type { ToolCall } from '../sdk/tool-provider.js';

export interface InferenceOptions {
  provider?: string;
  providerConfig?: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
  system?: string;
  messages: unknown[];
  tools?: Record<string, unknown>;
  signal?: AbortSignal;
  onChunk?: (chunk: { type: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown }) => void;
}

export interface InferenceResult {
  text: string;
  toolCalls: ToolCall[];
  usage: LanguageModelUsage;
}

export class InferenceEngine {
  async infer(options: InferenceOptions): Promise<InferenceResult> {
    const providerName = options.provider ?? 'mock';
    const provider = getProvider(providerName);

    if (!provider) {
      throw new Error(`Provider "${providerName}" not found`);
    }

    const model = options.providerConfig?.model ?? 'default';

    const stream = provider.stream({
      model,
      system: options.system,
      messages: options.messages,
      tools: options.tools,
      signal: options.signal,
    });

    let text = '';
    const toolCalls: ToolCall[] = [];
    let usage: LanguageModelUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    };

    for await (const chunk of stream) {
      if (options.onChunk) {
        options.onChunk(chunk as any);
      }

      if (chunk.type === 'text') {
        text += chunk.text;
      } else if (chunk.type === 'tool-call') {
        toolCalls.push({
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          input: chunk.input,
        });
      } else if (chunk.type === 'usage') {
        usage = {
          inputTokens: chunk.inputTokens,
          outputTokens: chunk.outputTokens,
          totalTokens: chunk.totalTokens,
          inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
          outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        };
      }
    }

    return { text, toolCalls, usage };
  }
}
