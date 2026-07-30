import type { AgentState } from '../agent-state.js';
import type { AgentStreamEvent } from '../types.js';
import type { CreateApprovalInput, ApprovalResolution } from './approval-engine.js';
import { log } from '../shared/debug-log.js';

export interface RequestApprovalParams {
  agentState: AgentState;
  sessionId: string;
  input: CreateApprovalInput;
  emit: (event: AgentStreamEvent) => void;
}

export async function requestApproval(params: RequestApprovalParams): Promise<ApprovalResolution> {
  const { agentState, sessionId, input, emit } = params;
  const liveState = agentState.getOrCreate(sessionId);
  const request = liveState.approvalEngine.createRequest(input);

  liveState.pendingApprovals.push(request);
  emit({ type: 'approval-request', sessionId, request });
  log('tools', 'approval requested', { sessionId, toolCallId: input.toolCallId, approvalId: request.approvalId });

  const resolution = await liveState.approvalEngine.wait(request.approvalId);

  liveState.pendingApprovals = liveState.pendingApprovals.filter((r) => r.approvalId !== request.approvalId);
  emit({ type: 'approval-resolved', sessionId, approvalId: request.approvalId, decision: resolution.decision });
  log('tools', 'approval resolved', { sessionId, toolCallId: input.toolCallId, approvalId: request.approvalId, decision: resolution.decision });

  return resolution;
}
