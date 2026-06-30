'use client';

import { useRef, useEffect, useCallback } from 'react';
import type { IAgentService, BusEvent } from 'rem-agent-bridge/client';

type Listener = (event: BusEvent) => void;

export function useAgentBus(agentService: IAgentService) {
  const listenersRef = useRef<Set<Listener>>(new Set());
  const runningRef = useRef(false);
  const retryDelayRef = useRef(1000);

  const onEvent = useCallback((listener: Listener): (() => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const connect = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;

    async function consume() {
      try {
        retryDelayRef.current = 1000;
        const stream = agentService.stream();
        for await (const event of stream) {
          for (const listener of listenersRef.current) {
            listener(event);
          }
        }
      } catch {
        // Stream disconnected, reconnect with backoff
        if (runningRef.current) {
          await new Promise((r) => setTimeout(r, retryDelayRef.current));
          retryDelayRef.current = Math.min(retryDelayRef.current * 2, 15000);
          consume();
        }
      }
    }

    consume();
  }, [agentService]);

  const disconnect = useCallback(() => {
    runningRef.current = false;
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  const send = useCallback(
    async (sessionId: string, content: string) => {
      await agentService.run(sessionId, content);
    },
    [agentService],
  );

  const interrupt = useCallback(
    async (sessionId: string) => {
      await agentService.interrupt(sessionId);
    },
    [agentService],
  );

  return { onEvent, send, interrupt };
}
