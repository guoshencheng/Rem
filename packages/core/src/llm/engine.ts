import { StreamCollector } from './stream-collector.js';
import type { GenerateResult, StreamChunk } from './types.js';
import type { ModelMessage } from '../types.js';
import { partitionProviderStream } from './partition-stream.js';
import { stripThinkingTags } from '../shared/text/strip-thinking-tags.js';
import { log } from '../shared/debug-log.js';

export interface InferOptions {
  messages: ModelMessage[];
  stream: AsyncIterable<StreamChunk>;
  onChunk?: (chunk: StreamChunk) => void | Promise<void>;
}

export interface InferenceResult extends GenerateResult {}

export class InferenceEngine {
  async infer(options: InferOptions): Promise<InferenceResult> {
    const collector = new StreamCollector();
    log('llm:engine', 'inference stream start');

    let chunkCount = 0;
    for await (const chunk of partitionProviderStream(options.stream)) {
      collector.feed(chunk);
      if (options.onChunk) {
        await options.onChunk(chunk);
      }
      chunkCount++;
    }

    const result = collector.result();
    result.text = stripThinkingTags(result.text);
    log('llm:engine', 'inference stream end', { chunkCount, textLength: result.text.length, reasoningLength: result.reasoning?.length });
    return result;
  }
}
