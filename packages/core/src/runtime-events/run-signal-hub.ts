import type { RunEvent, RunSignal } from '../domain/event/types.js';

export const TERMINAL_RUN_SIGNAL_TYPES: readonly string[] = ['run.completed', 'run.failed', 'run.cancelled'];
export const isTerminalRunSignal = (type: string): boolean => TERMINAL_RUN_SIGNAL_TYPES.includes(type);

type SignalListener = (signal: RunSignal) => void;

export interface RunSignalSubscription extends AsyncIterable<RunSignal> {
  close(): void;
}

/**
 * 进程内 Signal fan-out。Signal 只是持久化 RunEvent 的提示，丢失不影响正确性：
 * 订阅方应以持久化 Run/事件状态为准（waitForCompletion 每次收到 Signal 后重读）。
 */
export class RunSignalHub {
  private readonly listeners = new Map<string, Set<SignalListener>>();

  publish(signal: RunSignal): void {
    const listeners = this.listeners.get(signal.runId);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(signal);
  }

  publishEvent(event: RunEvent): void {
    this.publish({ runId: event.runId, type: event.type, data: event.data, occurredAt: event.occurredAt });
  }

  subscribe(runId: string): RunSignalSubscription {
    const queue: RunSignal[] = [];
    let waiter: (() => void) | undefined;
    let closed = false;
    const listener: SignalListener = (signal) => {
      if (closed) return;
      queue.push(signal);
      waiter?.();
    };
    const close = (): void => {
      if (closed) return;
      closed = true;
      this.removeListener(runId, listener);
      waiter?.();
    };
    this.addListener(runId, listener);
    return {
      close,
      [Symbol.asyncIterator]() {
        return (async function* (): AsyncGenerator<RunSignal> {
          try {
            for (;;) {
              const signal = queue.shift();
              if (signal !== undefined) { yield signal; continue; }
              if (closed) return;
              await new Promise<void>((resolve) => { waiter = resolve; });
              waiter = undefined;
            }
          } finally { close(); }
        })();
      },
    };
  }

  private addListener(runId: string, listener: SignalListener): void {
    let listeners = this.listeners.get(runId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(runId, listeners);
    }
    listeners.add(listener);
  }

  private removeListener(runId: string, listener: SignalListener): void {
    const listeners = this.listeners.get(runId);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size === 0) this.listeners.delete(runId);
  }
}
