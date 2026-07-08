import { describe, it, expect } from 'vitest';
import type { BusEvent } from '../src/bus-events.js';
import type { LanguageModelUsage } from '../src/types.js';

describe('BusEvent usage-change', () => {
  it('accepts usage-change event', () => {
    const usage: LanguageModelUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 };
    const event: BusEvent = { workspace: 'default', sessionId: 's1', type: 'usage-change', usage };
    expect(event.type).toBe('usage-change');
    expect(event.usage.totalTokens).toBe(30);
  });
});
