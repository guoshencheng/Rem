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
        input: { path: './x.txt' },
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
      const waitP = liveState.approvalRegistry.wait('ap1');

      const resolved = await service.resolveApproval(DEFAULT_WORKSPACE, summary.sessionId, 'ap1', 'allow-once');
      expect(resolved).toBe(true);
      await expect(waitP).resolves.toBe('allow-once');
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
