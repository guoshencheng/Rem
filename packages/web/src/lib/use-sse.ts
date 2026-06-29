'use client';

import { useRef, useCallback } from 'react';
import type { AgentStreamChunk } from './types.js';
import { parseSSEStream, parseAgentStreamEvent } from './stream-parser.js';

type ChunkHandler = (chunk: AgentStreamChunk) => void;
type StatusHandler = (status: 'connecting' | 'reconnecting' | 'error' | 'done') => void;

export function useSSE() {
  const abortRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  const connect = useCallback(
    (
      url: string,
      onChunk: ChunkHandler,
      onError?: (err: Error) => void,
      onStatus?: StatusHandler,
    ) => {
      const abort = new AbortController();
      abortRef.current = abort;

      async function start() {
        try {
          onStatus?.('connecting');
          const response = await fetch(url, { signal: abort.signal });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          retryCountRef.current = 0;
          const reader = response.body?.getReader();
          if (!reader) throw new Error('No readable stream');

          for await (const sse of parseSSEStream(reader)) {
            const chunk = parseAgentStreamEvent(sse);
            onChunk(chunk);
            if (chunk.type === 'finish' || chunk.type === 'error') {
              onStatus?.(chunk.type === 'error' ? 'error' : 'done');
              return;
            }
          }
          onStatus?.('done');
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
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
    [],
  );

  const disconnect = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    retryCountRef.current = 0;
  }, []);

  return { connect, disconnect };
}
