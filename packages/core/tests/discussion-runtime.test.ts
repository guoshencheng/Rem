import { describe, expect, it } from 'vitest';
import { DiscussionRuntime } from '../src/orchestration/discussion-runtime.js';

const config = { maxAgentRuns: 20, maxMessages: 50, maxDepth: 8, timeoutMs: 300_000,
  maxTokens: 200_000, maxParallelAgents: 4 };

describe('DiscussionRuntime', () => {
  it('owns finish request and root interruption', () => {
    const runtime = new DiscussionRuntime('root', config);
    runtime.requestFinish('organizer', 'answer');
    expect(runtime.status).toBe('finishing');
    expect(runtime.finishRequest).toEqual({ requestedByAgentThreadId: 'organizer', answer: 'answer' });
    runtime.interrupt();
    expect(runtime.abortController.signal.aborted).toBe(true);
    expect(runtime.status).toBe('interrupted');
  });
});
