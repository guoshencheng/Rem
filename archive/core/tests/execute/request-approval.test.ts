import { describe, it, expect } from 'vitest';
import { AgentState } from '../../src/agent-state.js';
import { requestApproval } from '../../src/execute/request-approval.js';
import type { AgentStreamEvent } from '../../src/types.js';

describe('requestApproval', () => {
  it('emits request/resolved events and resolves with the decision', async () => {
    const agentState = new AgentState();
    const events: AgentStreamEvent[] = [];
    const promise = requestApproval({
      agentState,
      sessionId: 's1',
      input: {
        toolCallId: 'tc1', toolName: 'bash', patterns: ['bash:ls'],
        alwaysOptions: [],
      },
      emit: (e) => events.push(e),
    });
    const liveState = agentState.getOrCreate('s1');
    const request = liveState.pendingApprovals[0];
    expect(request).toBeDefined();
    liveState.approvalEngine.resolve(request.approvalId, 'allow-once');
    const resolution = await promise;
    expect(resolution.decision).toBe('allow-once');
    expect(events.map((e) => e.type)).toEqual(['approval-request', 'approval-resolved']);
    expect(liveState.pendingApprovals).toHaveLength(0);
  });
});
