import type { AgentSystemEvent } from '../agent/bus-events.js';
import type { BroadcastBus } from '../agent/broadcast-bus.js';

/** 将同步广播适配为每个调用方独立消费的异步事件流。 */
export async function* streamSystemEvents(
  bus: BroadcastBus,
  signal?: AbortSignal,
): AsyncIterable<AgentSystemEvent> {
  const queue: AgentSystemEvent[] = [];
  let wake: (() => void) | undefined;
  let ended = signal?.aborted ?? false;
  const unsubscribe = bus.subscribe((event) => {
    queue.push(event);
    wake?.();
    wake = undefined;
  });
  const abort = () => {
    ended = true;
    wake?.();
    wake = undefined;
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (!ended) {
      const event = queue.shift();
      if (event) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => { wake = resolve; });
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    unsubscribe();
  }
}
