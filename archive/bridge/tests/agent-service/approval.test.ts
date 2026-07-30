import { describe, it, expect } from 'vitest';
import { createTestService, getAgentState } from './shared.js';
import { DEFAULT_WORKSPACE } from './shared.js';

describe('AgentService approval flow', { timeout: 20000 }, () => {
  it('listPendingApprovals() returns pending requests from AgentState', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      const liveState = getAgentState(service).getOrCreate(summary.sessionId);
      liveState.pendingApprovals.push({
        approvalId: 'ap1',
        toolCallId: 'tc1',
        toolName: 'write',
        title: 'Write file',
        allowedDecisions: ['allow-once', 'deny'],
        patterns: [],
        alwaysOptions: [],
      });

      const pending = await service.listPendingApprovals(DEFAULT_WORKSPACE, summary.sessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].approvalId).toBe('ap1');
    } finally {
      await cleanup();
    }
  });

  it('resolveApproval() resolves pending approval and returns true', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      const liveState = getAgentState(service).getOrCreate(summary.sessionId);
      const request = liveState.approvalEngine.createRequest({
        toolCallId: 'tc1',
        toolName: 'write',
        patterns: [],
        alwaysOptions: [],
      });
      const waitP = liveState.approvalEngine.wait(request.approvalId);

      const resolved = await service.resolveApproval(DEFAULT_WORKSPACE, summary.sessionId, request.approvalId, 'allow-once');
      expect(resolved).toBe(true);
      await expect(waitP).resolves.toEqual({ decision: 'allow-once' });
    } finally {
      await cleanup();
    }
  });

  it('resolveApproval() returns false for unknown approvalId', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      const resolved = await service.resolveApproval(DEFAULT_WORKSPACE, summary.sessionId, 'unknown', 'allow-once');
      expect(resolved).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
