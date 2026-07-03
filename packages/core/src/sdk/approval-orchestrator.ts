import type { AgentStreamChunk } from '../types.js';
import type { ApprovalDecision, ApprovalRequest } from './agent-state-provider.js';
import type { ToolHookContext } from './tool-hook.js';

export interface ApprovalRequirement {
  title: string;
  description?: string;
  severity?: 'info' | 'warning' | 'critical';
  allowedDecisions: ApprovalDecision[];
  timeoutMs?: number;
}

export interface ApprovalChunkEmitter {
  emit(chunk: AgentStreamChunk): void;
}

export interface ApprovalOrchestrator {
  requestApproval(
    ctx: ToolHookContext,
    requirement: ApprovalRequirement,
    emit: ApprovalChunkEmitter,
  ): Promise<ApprovalDecision | null>;
}
