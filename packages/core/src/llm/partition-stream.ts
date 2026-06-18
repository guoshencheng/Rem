import type { StreamChunk } from "./types.js";
import type { ThinkingTagDelta } from "../shared/text/thinking-tag/index.js";
import { ThinkingTagPartitioner } from "../shared/text/thinking-tag/index.js";

function* mapDeltas(deltas: ThinkingTagDelta[]): Generator<StreamChunk> {
  for (const delta of deltas) {
    if (!delta.text) continue;
    if (delta.type === "thinking") {
      yield { type: "reasoning", text: delta.text };
    } else {
      yield { type: "text", text: delta.text };
    }
  }
}

export async function* partitionProviderStream(
  stream: AsyncIterable<StreamChunk>,
): AsyncGenerator<StreamChunk> {
  const partitioner = new ThinkingTagPartitioner();

  for await (const chunk of stream) {
    if (chunk.type === "text") {
      yield* mapDeltas(partitioner.push(chunk.text));
    } else {
      yield* mapDeltas(partitioner.flush());
      yield chunk;
    }
  }

  yield* mapDeltas(partitioner.flush());
}
