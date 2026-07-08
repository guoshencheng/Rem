import { describe, it, expect } from 'vitest';
import { createTestService, getAgentState } from './shared.js';
import { DEFAULT_WORKSPACE } from './shared.js';

describe('AgentService interrupt and reset', { timeout: 20000 }, () => {
  it('interrupt() aborts run but does not finish it', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      getAgentState(service).startRun(summary.sessionId, 'default');
      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(true);

      await service.interrupt(DEFAULT_WORKSPACE, summary.sessionId);

      // interrupt only aborts; drive is not running so finishRun is never called.
      // State remains in memory but controller is aborted.
      const liveState = getAgentState(service).get(summary.sessionId)!;
      expect(liveState.runController?.signal.aborted).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('reset() aborts run and finishes it', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      getAgentState(service).startRun(summary.sessionId, 'default');
      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(true);

      await service.reset(DEFAULT_WORKSPACE, summary.sessionId);

      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(false);
      const liveState = getAgentState(service).get(summary.sessionId)!;
      expect(liveState.runController).toBeUndefined();
      expect(liveState.getSnapshot()).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('reset() clears snapshot and runController', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      getAgentState(service).startRun(summary.sessionId, 'default');
      getAgentState(service).startSnapshot(summary.sessionId, 'm1');
      getAgentState(service).appendSnapshotParts(summary.sessionId, {
        type: 'text-start',
        step: 0,
        partId: 'p1',
      });
      getAgentState(service).appendSnapshotParts(summary.sessionId, {
        type: 'text-delta',
        step: 0,
        partId: 'p1',
        text: 'x',
      });

      await service.reset(DEFAULT_WORKSPACE, summary.sessionId);

      expect(getAgentState(service).getSnapshot(summary.sessionId)).toBeUndefined();
      expect(getAgentState(service).get(summary.sessionId)?.runController).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('interrupt() is safe when session is not running', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      await expect(service.interrupt(DEFAULT_WORKSPACE, summary.sessionId)).resolves.toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('reset() is safe when session is not running', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      await expect(service.reset(DEFAULT_WORKSPACE, summary.sessionId)).resolves.toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
