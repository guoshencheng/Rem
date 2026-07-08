import { describe, it, expect, vi } from 'vitest';
import * as core from 'rem-agent-core';
import {
  createTestService,
  collectBusEvents,
  waitFor,
  getAgentState,
  simpleTextStream,
} from './shared.js';
import { DEFAULT_WORKSPACE } from './shared.js';

describe('AgentService.run background driver', { timeout: 30000 }, () => {
  it('run() resolves immediately and registers the run', async () => {
    const { service, cleanup } = await createTestService({
      provider: { name: 'mock-run-immediate', stream: simpleTextStream },
    });
    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      const { events, stop } = collectBusEvents(service, summary.sessionId);

      const p = service.run(DEFAULT_WORKSPACE, summary.sessionId, 'hi');
      await expect(p).resolves.toBeUndefined();
      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(true);

      // Wait for the background drive to finish before cleanup.
      await waitFor(events, (es) => es.some((e) => e.type === 'session-end'), 25000);
      stop();
    } finally {
      await cleanup();
    }
  });

  it('rejects concurrent run for the same session with 409', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      getAgentState(service).startRun(summary.sessionId, 'default');
      await expect(service.run(DEFAULT_WORKSPACE, summary.sessionId, 'hi')).rejects.toThrow(/already running/);
      getAgentState(service).finishRun(summary.sessionId, 'default');
    } finally {
      await cleanup();
    }
  });

  it('publishes session-start, chunks, and session-end via bus', async () => {
    const { service, cleanup } = await createTestService({
      provider: { name: 'mock-run-bus', stream: simpleTextStream },
    });
    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      const { events, stop } = collectBusEvents(service, summary.sessionId);

      await service.run(DEFAULT_WORKSPACE, summary.sessionId, 'hi');
      await waitFor(events, (es) => es.some((e) => e.type === 'session-end'), 25000);
      stop();

      const types = events.map((e) => e.type);
      expect(types).toContain('session-start');
      expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'message-start')).toBe(true);
      expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'text-delta')).toBe(true);
      expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'finish')).toBe(true);
      expect(types).toContain('session-end');
      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('publishes session-error when drive throws', async () => {
    const { service, cleanup } = await createTestService({
      provider: {
        name: 'mock-run-error',
        stream: () =>
          (async function* () {
            throw new Error('stream boom');
            yield { type: 'text' as const, text: 'x' };
          })(),
      },
    });
    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      const { events, stop } = collectBusEvents(service, summary.sessionId);

      await service.run(DEFAULT_WORKSPACE, summary.sessionId, 'hi');
      await waitFor(events, (es) => es.some((e) => e.type === 'session-error'), 25000);
      stop();

      expect(events.some((e) => e.type === 'session-error' && e.error.includes('stream boom'))).toBe(true);
      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('handles synchronous throw from coreRunAgent', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      const { events, stop } = collectBusEvents(service, summary.sessionId);

      const runAgentSpy = vi.spyOn(core, 'runAgent').mockImplementationOnce(() => {
        throw new Error('sync boom');
      });

      await expect(service.run(DEFAULT_WORKSPACE, summary.sessionId, 'hi')).rejects.toThrow('sync boom');
      await waitFor(events, (es) => es.some((e) => e.type === 'session-error'), 25000);
      stop();

      expect(events.some((e) => e.type === 'session-error' && e.error.includes('sync boom'))).toBe(true);
      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(false);
      runAgentSpy.mockRestore();
    } finally {
      await cleanup();
    }
  });
});
