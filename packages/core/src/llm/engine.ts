import { StreamCollector } from './stream-collector.js';
import type { GenerateResult, StreamChunk } from './types.js';
import type { ModelMessage } from '../types.js';
import { partitionProviderStream } from './partition-stream.js';
import { stripThinkingTags } from '../shared/text/strip-thinking-tags.js';

export interface InferOptions {
  messages: ModelMessage[];
  stream: AsyncIterable<StreamChunk>;
  onChunk?: (chunk: StreamChunk) => void | Promise<void>;
}

export interface InferenceResult extends GenerateResult {}

export class InferenceEngine {
  async infer(options: InferOptions): Promise<InferenceResult> {
    const collector = new StreamCollector();

    for await (const chunk of partitionProviderStream(options.stream)) {
      collector.feed(chunk);
      if (options.onChunk) {
        await options.onChunk(chunk);
      }
    }

    const result = collector.result();
    result.text = stripThinkingTags(result.text);
    return result;
  }
}
