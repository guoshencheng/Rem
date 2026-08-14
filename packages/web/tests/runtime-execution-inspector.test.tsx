// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listRuns: vi.fn(),
  getRunInspector: vi.fn(),
}));

vi.mock('@/api/client', () => ({ api: mocks }));

import { RuntimeExecutionInspector } from '@/components/runtime-execution-inspector';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('RuntimeExecutionInspector', () => {
  it('按 Session 加载 Run，并展示节点与工具审计', async () => {
    mocks.listRuns.mockResolvedValue([{
      runId: 'run-1', agentId: 'worker', agentRevision: '1', status: 'completed', executionType: 'team',
    }]);
    mocks.getRunInspector.mockResolvedValue({
      run: { runId: 'run-1', agentId: 'worker', agentRevision: '1', status: 'completed', executionType: 'team' },
      nodes: [{ nodeId: 'node-1', role: 'organizer', agentId: 'worker', status: 'completed' }],
      entries: [{ entryId: 'entry-1' }], deliveries: [{ deliveryId: 'delivery-1' }],
      invocations: [{ invocationId: 'inv-1', toolName: 'lookup', toolCallId: 'call-1', status: 'succeeded' }],
    });

    render(<RuntimeExecutionInspector sessionId="session-1" />);

    await waitFor(() => expect(mocks.listRuns).toHaveBeenCalledWith('session-1'));
    await waitFor(() => expect(mocks.getRunInspector).toHaveBeenCalledWith('run-1'));
    expect(screen.getByText('运行检查器')).toBeTruthy();
    expect(screen.getByText('organizer · worker')).toBeTruthy();
    expect(screen.getByText('lookup')).toBeTruthy();
  });
});
