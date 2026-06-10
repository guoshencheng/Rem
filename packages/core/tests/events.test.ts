import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/events.js';

describe('EventBus', () => {
  it('should call handlers in priority order', async () => {
    const bus = new EventBus();
    const order: number[] = [];

    bus.on('turn:before', () => { order.push(2); }, 50);
    bus.on('turn:before', () => { order.push(1); }, 100);
    bus.on('turn:before', () => { order.push(3); }, 10);

    await bus.emit('turn:before', { harness: {} as any, state: {} as any });
    expect(order).toEqual([1, 2, 3]);
  });

  it('should allow unsubscribing', async () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const off = bus.on('turn:before', handler);
    off();

    await bus.emit('turn:before', { harness: {} as any, state: {} as any });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should pass context to handlers', async () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('turn:after', handler);
    const ctx = { harness: {} as any, state: { currentTurn: 5 } as any };

    await bus.emit('turn:after', ctx);
    expect(handler).toHaveBeenCalledWith(ctx);
  });

  it('should handle async handlers', async () => {
    const bus = new EventBus();
    let resolved = false;

    bus.on('turn:before', async () => {
      await new Promise(r => setTimeout(r, 10));
      resolved = true;
    });

    await bus.emit('turn:before', { harness: {} as any, state: {} as any });
    expect(resolved).toBe(true);
  });
});
