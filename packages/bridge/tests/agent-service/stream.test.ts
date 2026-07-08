import { describe, it, expect } from 'vitest';
import { createTestService, getAgentState } from './shared.js';
import { DEFAULT_WORKSPACE } from './shared.js';
import type { BusEvent } from '../../src/types.js';

describe('AgentService stream', { timeout: 20000 }, () => {
  it('replays snapshots for running sessions then yields live events', async () => {
    const { service, cleanup } = await createTestService();
    try {
      getAgentState(service).startRun('s1', 'default');
      getAgentState(service).startSnapshot('s1', 'm1');
      getAgentState(service).appendSnapshotParts('s1', {
        type: 'text-start',
        step: 0,
        partId: 'p1',
      });
      getAgentState(service).appendSnapshotParts('s1', {
        type: 'text-delta',
        step: 0,
        partId: 'p1',
        text: 'hello',
      });

      const iterator = service.stream(DEFAULT_WORKSPACE)[Symbol.asyncIterator]();

      setTimeout(() =>
        getAgentState(service).publish({ workspace: 'default', sessionId: 's1', type: 'session-end' }),
      );

      const first = await iterator.next();
      expect((first.value as BusEvent).type).toBe('snapshot');

      const second = await iterator.next();
      expect((second.value as BusEvent).type).toBe('session-end');

      await iterator.return?.();
    } finally {
      await cleanup();
    }
  });

  it('filters events by workspace', async () => {
    const { service, cleanup } = await createTestService({ workspace: 'ws-a' });
    try {
      const iterator = service.stream('ws-a')[Symbol.asyncIterator]();

      setTimeout(() => {
        getAgentState(service).publish({ workspace: 'ws-b', sessionId: 's1', type: 'session-start' });
        getAgentState(service).publish({ workspace: 'ws-a', sessionId: 's1', type: 'session-end' });
      });

      const first = await iterator.next();
      expect((first.value as BusEvent).type).toBe('session-end');
      expect((first.value as BusEvent).workspace).toBe('ws-a');

      await iterator.return?.();
    } finally {
      await cleanup();
    }
  });

  it('supports multiple concurrent subscribers', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const iter1 = service.stream(DEFAULT_WORKSPACE)[Symbol.asyncIterator]();
      const iter2 = service.stream(DEFAULT_WORKSPACE)[Symbol.asyncIterator]();

      const p1 = iter1.next();
      const p2 = iter2.next();

      setTimeout(() =>
        getAgentState(service).publish({ workspace: 'default', sessionId: 's1', type: 'session-start' }),
      );

      const [v1, v2] = await Promise.all([p1, p2]);
      expect((v1.value as BusEvent).type).toBe('session-start');
      expect((v2.value as BusEvent).type).toBe('session-start');

      await iter1.return?.();
      await iter2.return?.();
    } finally {
      await cleanup();
    }
  });

  it('unsubscribes on break/return', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const iter = service.stream(DEFAULT_WORKSPACE)[Symbol.asyncIterator]();
      await iter.return?.();

      // After return, subscriber is removed; no errors on publish.
      expect(() =>
        getAgentState(service).publish({ workspace: 'default', sessionId: 's1', type: 'session-start' }),
      ).not.toThrow();
    } finally {
      await cleanup();
    }
  });

  it('replays no snapshots when no sessions are running', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const iterator = service.stream(DEFAULT_WORKSPACE)[Symbol.asyncIterator]();

      setTimeout(() =>
        getAgentState(service).publish({ workspace: 'default', sessionId: 's1', type: 'session-start' }),
      );

      const first = await iterator.next();
      expect((first.value as BusEvent).type).toBe('session-start');

      await iterator.return?.();
    } finally {
      await cleanup();
    }
  });
});
