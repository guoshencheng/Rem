import type { ContentPart } from '../types.js';
import type { AgentLiveState } from '../state.js';
import type { Rule } from '../security/rules/rule.js';

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
  sessionId?: string;
  patterns: string[];
  alwaysOptions: Array<{ label: string; rule: Omit<Rule, 'source'> }>;
}

/** @deprecated Use AgentLiveState directly */
export interface AgentRuntimeState {
  pendingApprovals: ApprovalRequest[];
}

/* ---- AgentLiveProvider ---- */

export interface AgentLiveProvider {
  get(sessionId: string): Promise<AgentLiveState | undefined>;
  /** 获取或创建：不存在时自动创建并保存，保证始终返回有效状态 */
  getOrCreate(sessionId: string): Promise<AgentLiveState>;
  set(sessionId: string, state: AgentLiveState): Promise<void>;
}

/** @deprecated Use AgentLiveProvider instead */
export type AgentStateProvider = AgentLiveProvider;
