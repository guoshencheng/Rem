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
