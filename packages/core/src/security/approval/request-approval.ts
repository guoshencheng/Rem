import type { AgentStreamEvent } from '../../agent/types.js';
import type { ApprovalRequest } from '../../sdk/agent-state-provider.js';
import type { CreateApprovalInput, ApprovalResolution } from './approval-engine.js';
import type { ApprovalEngine } from './approval-engine.js';
import { log } from '../../infrastructure/observability/debug-log.js';

/** 审批链路需要的最小 live state 面（由 bridge 的 REMSession 满足） */
export interface ApprovalLiveState {
  approvalEngine: ApprovalEngine;
  pendingApprovals: ApprovalRequest[];
}

export interface ApprovalStateHost {
  getOrCreate(sessionId: string): ApprovalLiveState;
}

export interface RequestApprovalParams {
  agentState: ApprovalStateHost;
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
