import { describe, it, expect } from 'vitest';
import { NoOpCompressor } from '../src/plugins/compressor/no-op/index.js';
import type { Session } from '../src/session.js';

describe('NoOpCompressor', () => {
  const compressor = new NoOpCompressor();

  it('should never compress', () => {
    const session: Session = {
      sessionId: 's1',
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(compressor.shouldCompress(session)).toBe(false);
  });

  it('should return messages unchanged', async () => {
    const messages = [
      { id: '1', role: 'user' as const, content: [{ type: 'text', text: 'Hello' }] },
      { id: '2', role: 'assistant' as const, content: [{ type: 'text', text: 'Hi' }] },
    ];
    const result = await compressor.compress(messages);
    expect(result).toEqual(messages);
  });
});
