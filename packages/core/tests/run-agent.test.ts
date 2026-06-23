import { describe, it, expect, beforeEach } from 'vitest';
import { runAgent } from '../src/run-agent.js';
import { ProviderManager } from '../src/provider-manager.js';

describe('runAgent', () => {
  beforeEach(() => {
    ProviderManager.resetInstance();
  });

  it('returns a stream and output promise', async () => {
    await ProviderManager.getInstance();
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
