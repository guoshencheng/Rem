import type { Message } from '@earendil-works/pi-ai';
import type { ContextCompressor } from '../sdk/compressor.js';
import type { AgentStreamEvent } from '../agent/types.js';

export function createCompressionTransform(params: {
  compressor: ContextCompressor;
  shouldCompress: (messages: Message[]) => boolean;
  estimatedTokens: () => number;
  threshold: () => number;
  archive: (before: Message[], after: Message[]) => Promise<string>;
  emit: (event: AgentStreamEvent) => void;
  sessionId: string;
}): (messages: Message[]) => Promise<Message[]> {
  let compressedBase: Message[] | null = null;
  let compressedAtCount = 0;

  return async (messages) => {
    if (!compressedBase) {
      if (!params.shouldCompress(messages)) return messages;
      params.emit({ type: 'compress-start', sessionId: params.sessionId, estimatedTokens: params.estimatedTokens(), threshold: params.threshold() });
      const compressed = await params.compressor.compress(messages);
      const removedCount = messages.length - compressed.length;
      const archiveId = await params.archive(messages, compressed);
      compressedBase = compressed;
      compressedAtCount = messages.length;
      params.emit({ type: 'compress-end', sessionId: params.sessionId, archiveId, removedMessageCount: removedCount });
      return compressed;
    }
    return [...compressedBase, ...messages.slice(compressedAtCount)];
  };
}
