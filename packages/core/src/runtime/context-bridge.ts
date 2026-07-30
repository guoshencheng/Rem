import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { ContextCompressor } from '../sdk/compressor.js';
import type { AgentStreamEvent } from '../agent/types.js';

export interface ContextBridgeParams {
  compressor: ContextCompressor;
  shouldCompress: (messages: Message[]) => boolean;
  estimatedTokens: () => number;
  threshold: () => number;
  archive: (before: Message[], after: Message[]) => Promise<string>;
  emit: (event: AgentStreamEvent) => void;
  sessionId: string;
}

export interface ContextBridge {
  transformContext: (messages: AgentMessage[]) => Promise<AgentMessage[]>;
}

export function createContextBridge(params: ContextBridgeParams): ContextBridge {
  let compressedBase: Message[] | null = null;
  let compressedAtCount = 0;

  const transformContext = async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    if (!compressedBase) {
      const asMessages = messages as Message[];
      if (!params.shouldCompress(asMessages)) return messages;
      params.emit({ type: 'compress-start', sessionId: params.sessionId, estimatedTokens: params.estimatedTokens(), threshold: params.threshold() });
      const compressed = await params.compressor.compress(asMessages);
      const removedCount = asMessages.length - compressed.length;
      const archiveId = await params.archive(asMessages, compressed);
      compressedBase = compressed;
      compressedAtCount = asMessages.length;
      params.emit({ type: 'compress-end', sessionId: params.sessionId, archiveId, removedMessageCount: removedCount });
      return compressed;
    }
    return [...compressedBase, ...messages.slice(compressedAtCount)];
  };

  return { transformContext };
}
