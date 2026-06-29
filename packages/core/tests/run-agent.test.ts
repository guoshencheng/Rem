import { describe, it, expect } from 'vitest';
import { runAgent } from '../src/run-agent.js';

describe('runAgent', () => {
  it('returns a stream and output promise', async () => {
    const result = runAgent({
      input: { content: 'hello' },
      sessionId: 'test-session',
    });
    expect(result.stream).toBeDefined();
    expect(result.output).toBeInstanceOf(Promise);

    // Consume stream to completion
    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
  });
});
