import type { AgentSystemEvent } from 'rem-agent-core';
import { parseBusEvent, parseSSEStream } from './sse';

export interface EventBusHandlers {
  onEvent: (event: AgentSystemEvent) => void;
  onReconnect: () => void;
}

const INITIAL_DELAY_MS = 1_000;
const MAX_DELAY_MS = 15_000;

export function startEventBus(handlers: EventBusHandlers): () => void {
  let stopped = false;
  let delay = INITIAL_DELAY_MS;
  let everConnected = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = async (): Promise<void> => {
    while (!stopped) {
      try {
        const res = await fetch('/api/rem/stream');
        if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
        if (everConnected) handlers.onReconnect();
        everConnected = true;
        delay = INITIAL_DELAY_MS;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('rem:sse-connected'));
        }
        for await (const frame of parseSSEStream(res.body.getReader())) {
          if (stopped) return;
          if (frame.event !== 'bus') continue;
          const event = parseBusEvent(frame.data);
          if (event) handlers.onEvent(event);
        }
        throw new Error('SSE stream ended');
      } catch {
        if (stopped) return;
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, delay);
        });
        delay = Math.min(delay * 2, MAX_DELAY_MS);
      }
    }
  };

  void connect();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
