import type { ModelMessage, ToolSet } from 'ai';
import { resolveProvider } from './api-registry.js';
import { StreamCollector } from './types.js';
import type { GenerateOptions, GenerateResult, StreamChunk } from './types.js';
import { createThinkingTagPartitioner } from '../shared/text/thinking-tag-partitioner.js';
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

async function* partitionProviderStream(
  stream: AsyncIterable<StreamChunk>,
): AsyncGenerator<StreamChunk> {
  const partitioner = createThinkingTagPartitioner();
  let thinking = false;

  function* mapDeltas(deltas: ReturnType<ReturnType<typeof createThinkingTagPartitioner>['push']>): Generator<StreamChunk> {
    for (const delta of deltas) {
      if (!delta.text) {
        continue;
      }
      if (delta.type === 'thinking') {
        if (!thinking) {
          console.error('[stream] thinking start');
          thinking = true;
        }
        console.error(`[stream] thinking-delta: "${delta.text.slice(0, 80)}"`);
        yield { type: 'reasoning', text: delta.text };
      } else {
        if (thinking) {
          console.error('[stream] thinking end');
          thinking = false;
        }
        yield { type: 'text', text: delta.text };
      }
    }
  }

  for await (const chunk of stream) {
    console.error(`[stream] provider chunk type=${chunk.type} text_len=${('text' in chunk ? chunk.text.length : 0)}`);
    if ('text' in chunk && chunk.text) {
      console.error(`[stream]   text="${chunk.text.slice(0, 100)}"`);
    }
    if (chunk.type === 'text') {
      const deltas = partitioner.push(chunk.text);
      console.error(`[stream]   partitioned into ${deltas.length} deltas: ${deltas.map(d => d.type).join(', ')}`);
      yield* mapDeltas(deltas);
    } else {
      yield* mapDeltas(partitioner.flush());
      yield chunk;
    }
  }

  yield* mapDeltas(partitioner.flush());
  if (thinking) {
    console.error('[stream] thinking end (stream end)');
  }
}

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
