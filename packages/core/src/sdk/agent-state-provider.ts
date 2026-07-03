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

export interface AgentRuntimeState {
  pendingApprovals: ApprovalRequest[];
}

export interface AgentStateProvider {
  getState(sessionId: string): Promise<AgentRuntimeState>;
  setState(sessionId: string, state: AgentRuntimeState): Promise<void>;
}
