import type { ContentPart } from '../types.js';
import type { AgentLiveState } from '../state.js';

/* ---- Approval types ---- */

export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

export interface ApprovalRequest {
  approvalId: string;
  toolName: string;
  toolCallId?: string;
  title: string;
  description?: string;
  severity?: 'info' | 'warning' | 'critical';
  allowedDecisions: ApprovalDecision[];
  timeoutMs?: number;
  sessionId?: string;
}

/** @deprecated Use AgentLiveState directly */
export interface AgentRuntimeState {
  pendingApprovals: ApprovalRequest[];
}

/* ---- AgentLiveProvider ---- */

export interface AgentLiveProvider {
  get(sessionId: string): Promise<AgentLiveState | undefined>;
  set(sessionId: string, state: AgentLiveState): Promise<void>;
}

/** @deprecated Use AgentLiveProvider instead */
export type AgentStateProvider = AgentLiveProvider;
