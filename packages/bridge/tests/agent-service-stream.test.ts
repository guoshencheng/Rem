import { describe, it, expect, beforeEach } from 'vitest';
import { streamingSnapshots, getStreamingSnapshotEvents } from '../src/streaming-snapshots.js';
import { bus } from '../src/broadcast-bus.js';
import { AgentService } from '../src/agent.js';
import type { BusEvent } from '../src/types.js';

function makeServiceForWorkspace(workspace: string): AgentService {
  const service = Object.create(AgentService.prototype) as AgentService;
  (service as unknown as { workspace: string }).workspace = workspace;
  return service;
}

describe('streaming snapshots', () => {
  beforeEach(() => {
    for (const id of streamingSnapshots.runningSessionIds()) streamingSnapshots.clear(id);
  });

  it('getStreamingSnapshotEvents returns snapshot events for running sessions', () => {
    streamingSnapshots.start('s1', 'm1');
    streamingSnapshots.update('s1', [{ type: 'text', text: 'hello' }]);

    const events = getStreamingSnapshotEvents('default');
    expect(events).toEqual([
      {
        workspace: 'default',
        sessionId: 's1',
        type: 'snapshot',
        messageId: 'm1',
        parts: [{ type: 'text', text: 'hello' }],
      },
    ]);
  });

  it('AgentService.stream is a pure bus subscription (no snapshot replay)', async () => {
    streamingSnapshots.start('s1', 'm1');
    streamingSnapshots.update('s1', [{ type: 'text', text: 'hello' }]);

    const service = makeServiceForWorkspace('default');
    const iterator = service.stream()[Symbol.asyncIterator]();

    queueMicrotask(() => bus.publish({ workspace: 'default', sessionId: 's1', type: 'session-end' }));
    const first = await iterator.next();
    expect((first.value as BusEvent).type).toBe('session-end');
  });
});
