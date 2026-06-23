import type { ToolContext } from './tool-provider.js';

export interface ToolHookContext extends ToolContext {
  toolName: string;
  toolCallId?: string;
  input: unknown;
}

export type ToolApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

export interface ToolHookResult {
  block?: { reason: string };
  requireApproval?: {
    title: string;
    description?: string;
    severity?: 'info' | 'warning' | 'critical';
    allowedDecisions: Array<'allow-once' | 'allow-always' | 'deny'>;
    timeoutMs?: number;
    onDecision?: (decision: ToolApprovalDecision) => void;
  };
  params?: unknown;
}

export type ToolHook = (ctx: ToolHookContext) => Promise<ToolHookResult | undefined> | ToolHookResult | undefined;
