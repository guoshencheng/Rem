import type { BusEvent } from './types.js';

export class BroadcastBus {
  private subscribers = new Set<(event: BusEvent) => void>();

  publish(event: BusEvent): void {
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch {
        // isolate subscriber errors
      }
    }
  }

  subscribe(fn: (event: BusEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }
}

export const bus = new BroadcastBus();
