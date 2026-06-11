import type { ModelMessage, ToolSet } from 'ai';
import { resolveProvider } from './api-registry.js';
import { StreamCollector } from './types.js';
import type { GenerateOptions, GenerateResult, StreamChunk } from './types.js';

export interface InferenceOptions {
  provider: string;
  providerConfig: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onChunk?: (chunk: StreamChunk) => void | Promise<void>;
}

export interface InferenceResult extends GenerateResult {}

export class InferenceEngine {
  async infer(options: InferenceOptions): Promise<InferenceResult> {
    const provider = resolveProvider(options.provider);
    const collector = new StreamCollector();

    const generateOptions: GenerateOptions = {
      model: options.providerConfig.model,
      apiKey: options.providerConfig.apiKey,
      baseURL: options.providerConfig.baseURL,
      system: options.system,
      messages: options.messages,
      tools: options.tools,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      signal: options.signal,
    };

    for await (const chunk of provider.stream(generateOptions)) {
      collector.feed(chunk);
      if (options.onChunk) {
        await options.onChunk(chunk);
      }
    }

    return collector.result();
  }
}
