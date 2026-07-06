'use client';

import { useRef, useEffect, useCallback } from 'react';
import type { IAgentService, BusEvent } from 'rem-agent-bridge/client';

type Listener = (event: BusEvent) => void;
type ReconnectListener = () => void;

export function useAgentBus(agentService: IAgentService) {
  const listenersRef = useRef<Set<Listener>>(new Set());
  const reconnectListenersRef = useRef<Set<ReconnectListener>>(new Set());
  const runningRef = useRef(false);
  const retryDelayRef = useRef(1000);

  const onEvent = useCallback((listener: Listener): (() => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const onReconnect = useCallback((listener: ReconnectListener): (() => void) => {
    reconnectListenersRef.current.add(listener);
    return () => {
      reconnectListenersRef.current.delete(listener);
    };
  }, []);

  const notifyReconnect = useCallback(() => {
    for (const listener of reconnectListenersRef.current) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;

    async function consume() {
      try {
        retryDelayRef.current = 1000;
        console.log('[useAgentBus] stream connected');
        const stream = agentService.stream();
        for await (const event of stream) {
          console.log(`[useAgentBus] recv session=${event.sessionId} type=${event.type} listeners=${listenersRef.current.size}`);
          for (const listener of listenersRef.current) {
            listener(event);
          }
        }
        console.log('[useAgentBus] stream ended');
      } catch (err) {
        console.error('[useAgentBus] stream error, reconnecting...', err);
        // Stream disconnected, reconnect with backoff
        if (runningRef.current) {
          await new Promise((r) => setTimeout(r, retryDelayRef.current));
          retryDelayRef.current = Math.min(retryDelayRef.current * 2, 15000);
          notifyReconnect();
          consume();
        }
      }
    }

    consume();
  }, [agentService, notifyReconnect]);

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
      // UI updates come from the broadcast bus, not from this call.
    },
    [agentService],
  );

  const interrupt = useCallback(
    async (sessionId: string) => {
      await agentService.interrupt(sessionId);
    },
    [agentService],
  );

  return { onEvent, onReconnect, send, interrupt };
}
