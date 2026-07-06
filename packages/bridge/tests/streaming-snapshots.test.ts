import { describe, it, expect, beforeEach } from 'vitest';
import { streamingSnapshots } from '../src/streaming-snapshots.js';
import type { ContentPart } from 'rem-agent-core';

describe('streamingSnapshots', () => {
  beforeEach(() => {
    for (const id of streamingSnapshots.runningSessionIds()) {
      streamingSnapshots.clear(id);
    }
  });

  it('starts, updates, gets and clears a snapshot', () => {
    streamingSnapshots.start('s1', 'm1');
    expect(streamingSnapshots.get('s1')).toEqual({ messageId: 'm1', parts: [] });

    const parts: ContentPart[] = [{ type: 'text', text: 'hi' }];
    streamingSnapshots.update('s1', parts);
    expect(streamingSnapshots.get('s1')).toEqual({ messageId: 'm1', parts });

    streamingSnapshots.clear('s1');
    expect(streamingSnapshots.get('s1')).toBeUndefined();
  });

  it('start resets parts for a new message', () => {
    streamingSnapshots.start('s1', 'm1');
    streamingSnapshots.update('s1', [{ type: 'text', text: 'a' }]);
    streamingSnapshots.start('s1', 'm2');
    expect(streamingSnapshots.get('s1')).toEqual({ messageId: 'm2', parts: [] });
  });

  it('lists running session ids', () => {
    streamingSnapshots.start('s1', 'm1');
    streamingSnapshots.start('s2', 'm2');
    expect(streamingSnapshots.runningSessionIds().sort()).toEqual(['s1', 's2']);
  });

  it('update on unknown session is a no-op', () => {
    streamingSnapshots.update('missing', [{ type: 'text', text: 'x' }]);
    expect(streamingSnapshots.get('missing')).toBeUndefined();
  });
});
