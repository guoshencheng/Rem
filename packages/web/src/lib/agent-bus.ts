'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { IAgentService, BusEvent } from 'rem-agent-bridge/client';

type Listener = (event: BusEvent) => void;
type ReconnectListener = () => void;

function sseLog(message: string, context?: Record<string, unknown>): void {
  const ctx = context ? Object.entries(context).map(([k, v]) => `${k}=${String(v)}`).join(' ') : '';
  // eslint-disable-next-line no-console
  console.log(`[sse]${ctx ? ` ${ctx}` : ''} ${message}`);
}

/* ---- Module-level singleton SSE connection ---- */

let agentService: IAgentService | null = null;
let running = false;
let retryDelay = 1000;
let abortController: AbortController | null = null;
const listeners = new Set<Listener>();
const reconnectListeners = new Set<ReconnectListener>();

function notifyReconnect() {
  for (const listener of reconnectListeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

async function consume() {
  const controller = new AbortController();
  abortController = controller;
  try {
    retryDelay = 1000;
    const stream = agentService!.stream(controller.signal);
    for await (const event of stream) {
      if (controller.signal.aborted || !running) break;
      for (const listener of listeners) {
        listener(event);
      }
    }
  } catch (err) {
    if (controller.signal.aborted || !running) return;
    const message = err instanceof Error ? err.message : String(err);
    sseLog('stream error, reconnecting', { error: message, retryDelayMs: retryDelay });
    if (running) {
      await new Promise((r) => setTimeout(r, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 15000);
      sseLog('reconnecting after backoff', { retryDelayMs: retryDelay });
      notifyReconnect();
      consume();
    }
  }
}

function connect(service: IAgentService) {
  if (running && agentService === service) return;
  if (running) {
    running = false;
    abortController?.abort();
  }
  agentService = service;
  running = true;
  sseLog('connecting');
  consume();
}

function disconnect() {
  running = false;
  abortController?.abort();
  abortController = null;
}

/* ---- Public API ---- */

export function getAgentBus(service: IAgentService) {
  connect(service);
  return {
    onEvent(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onReconnect(listener: ReconnectListener): () => void {
      reconnectListeners.add(listener);
      return () => {
        reconnectListeners.delete(listener);
      };
    },
    async send(workspace: string, sessionId: string, content: string) {
      await service.run(workspace, sessionId, content);
    },
    async interrupt(workspace: string, sessionId: string) {
      await service.interrupt(workspace, sessionId);
    },
  };
}

/**
 * Hook that returns the shared agent bus.
 * The bus connection is a module-level singleton, so multiple components
 * can call this hook without creating duplicate SSE connections.
 */
export function useAgentBus(agentService: IAgentService) {
  const busRef = useRef(getAgentBus(agentService));

  useEffect(() => {
    busRef.current = getAgentBus(agentService);
    return () => {
      // Do NOT disconnect on unmount — the singleton connection is shared
      // and should persist across component remounts (Fast Refresh, etc.).
    };
  }, [agentService]);

  const onEvent = useCallback((listener: Listener) => busRef.current.onEvent(listener), []);
  const onReconnect = useCallback((listener: ReconnectListener) => busRef.current.onReconnect(listener), []);
  const send = useCallback(
    (workspace: string, sessionId: string, content: string) =>
      busRef.current.send(workspace, sessionId, content),
    [],
  );
  const interrupt = useCallback(
    (workspace: string, sessionId: string) => busRef.current.interrupt(workspace, sessionId),
    [],
  );

  return { onEvent, onReconnect, send, interrupt };
}
