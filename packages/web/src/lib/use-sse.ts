'use client';

import { useRef, useCallback } from 'react';
import type { IAgentService } from 'rem-agent-bridge/client';
import type { AgentStreamChunk } from 'rem-agent-bridge/client';

type ChunkHandler = (chunk: AgentStreamChunk) => void;
type StatusHandler = (status: 'connecting' | 'reconnecting' | 'error' | 'done') => void;

export function useSSE(agentService: IAgentService) {
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  const connect = useCallback(
    (
      sessionId: string,
      content: string,
      onChunk: ChunkHandler,
      onError?: (err: Error) => void,
      onStatus?: StatusHandler,
    ) => {
      async function start() {
        try {
          onStatus?.('connecting');
          const chunks = await agentService.run(sessionId, content);
          retryCountRef.current = 0;
          for await (const chunk of chunks) {
            onChunk(chunk);
            if (chunk.type === 'finish' || chunk.type === 'error') {
              onStatus?.(chunk.type === 'error' ? 'error' : 'done');
              return;
            }
          }
          onStatus?.('done');
        } catch (err: unknown) {
          if (retryCountRef.current < maxRetries) {
            retryCountRef.current++;
            onStatus?.('reconnecting');
            await new Promise((r) => setTimeout(r, 3000));
            start();
          } else {
            onStatus?.('error');
            onError?.(err instanceof Error ? err : new Error(String(err)));
          }
        }
      }

      start();
    },
    [agentService],
  );

  const disconnect = useCallback(() => {
    retryCountRef.current = 0;
  }, []);

  return { connect, disconnect };
}
