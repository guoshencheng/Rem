import { describe, it, expect, beforeEach } from 'vitest';
import { streamingSnapshots } from '../src/streaming-snapshots.js';
import { bus } from '../src/broadcast-bus.js';
import { AgentService } from '../src/agent.js';
import type { ProviderManager } from 'rem-agent-core';
import type { BusEvent } from '../src/types.js';

function makeServiceForWorkspace(workspace: string): AgentService {
  const service = Object.create(AgentService.prototype) as AgentService;
  (service as unknown as { workspace: string }).workspace = workspace;
  return service;
}

describe('AgentService.stream snapshot push', () => {
  beforeEach(() => {
    for (const id of streamingSnapshots.runningSessionIds()) streamingSnapshots.clear(id);
  });

  it('pushes current snapshot to a new subscriber before subsequent chunks', async () => {
    streamingSnapshots.start('s1', 'm1');
    streamingSnapshots.update('s1', [{ type: 'text', text: 'hello' }]);

    const service = makeServiceForWorkspace('default');
    const iterator = service.stream()[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toMatchObject({
      type: 'snapshot',
      sessionId: 's1',
      messageId: 'm1',
      parts: [{ type: 'text', text: 'hello' }],
    });

    queueMicrotask(() => bus.publish({ workspace: 'default', sessionId: 's1', type: 'session-end' }));
    const second = await iterator.next();
    expect((second.value as BusEvent).type).toBe('session-end');
  });
});
