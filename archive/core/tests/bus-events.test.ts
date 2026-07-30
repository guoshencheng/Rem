import { describe, it, expect } from 'vitest';
import type { BusEvent } from '../src/bus-events.js';
import type { Usage } from '@earendil-works/pi-ai';

describe('BusEvent usage-change', () => {
  it('accepts usage-change event', () => {
    const usage: Usage = { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const event: BusEvent = { workspace: 'default', sessionId: 's1', type: 'usage-change', usage };
    expect(event.type).toBe('usage-change');
    expect(event.usage.totalTokens).toBe(30);
  });
});
