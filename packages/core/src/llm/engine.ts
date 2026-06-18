import { resolveProvider } from './api-registry.js';
import { StreamCollector } from './types.js';
import type { GenerateOptions, GenerateResult, StreamChunk, ToolSet } from './types.js';
import type { ModelMessage } from '../types.js';
import { partitionProviderStream } from './partition-stream.js';
import { stripThinkingTags } from '../shared/text/strip-thinking-tags.js';

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

    for await (const chunk of partitionProviderStream(provider.stream(generateOptions))) {
      collector.feed(chunk);
      if (options.onChunk) {
        await options.onChunk(chunk);
      }
    }

    const result = collector.result();
    // Final safety net: tags that survived partitioning (e.g. split across a
    // text/tool-call boundary) are stripped from the collected text.
    result.text = stripThinkingTags(result.text);
    return result;
  }
}
