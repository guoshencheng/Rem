import { describe, it, expect } from 'vitest';
import { NoOpCompressor } from '../src/defaults/no-op-compressor.js';
import { AgentState } from '../src/state.js';

describe('NoOpCompressor', () => {
  const compressor = new NoOpCompressor();

  it('should never compress', () => {
    const state = new AgentState();
    expect(compressor.shouldCompress()).toBe(false);
  });

  it('should return messages unchanged', async () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi' },
    ];
    const result = await compressor.compress(messages);
    expect(result).toEqual(messages);
  });
});
