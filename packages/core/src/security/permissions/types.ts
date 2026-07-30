import type { ToolCall, ToolDefinition } from '../../sdk/tool-provider.js';
import type { Rule } from '../rules/rule.js';

export interface ApprovalRequestInput {
  toolCallId: string;
  toolName: string;
  patterns: string[];
  title: string;
  description?: string;
  severity?: 'info' | 'warning' | 'critical';
  alwaysOptions: Array<{ label: string; rule: Omit<Rule, 'source'> }>;
}

export type PermissionDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'ask'; request: ApprovalRequestInput };

export interface ToolPermissionEvaluator {
  evaluate(toolCall: ToolCall, toolDef: ToolDefinition): Promise<PermissionDecision>;
}
