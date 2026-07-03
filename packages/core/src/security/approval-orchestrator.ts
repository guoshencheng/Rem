import type { AgentStateProvider, ApprovalDecision, ApprovalRequest } from '../sdk/agent-state-provider.js';
import type { ToolHookContext } from '../sdk/tool-hook.js';
import { generateId } from '../shared/generate-id.js';
import type { AgentStreamChunk } from '../types.js';

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

const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000;

export class ApprovalOrchestrator {
  private approvalToSession = new Map<string, string>();
  private emitters = new Map<string, ApprovalChunkEmitter>();

  constructor(private stateProvider: AgentStateProvider) {}

  async requestApproval(
    ctx: ToolHookContext,
    requirement: ApprovalRequirement,
    emit: ApprovalChunkEmitter,
  ): Promise<ApprovalDecision | null> {
    const sessionId = ctx.sessionId;
    if (!sessionId) {
      throw new Error('sessionId is required for approval');
    }

    const approvalId = `approval:${generateId()}`;
    const request: ApprovalRequest = {
      approvalId,
      sessionId,
      toolName: ctx.toolName,
      toolCallId: ctx.toolCallId,
      title: requirement.title,
      description: requirement.description,
      severity: requirement.severity,
      allowedDecisions: requirement.allowedDecisions,
      timeoutMs: requirement.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS,
    };

    const state = await this.stateProvider.getState(sessionId);
    await this.stateProvider.setState(sessionId, {
      pendingApprovals: [...state.pendingApprovals, request],
    });

    this.approvalToSession.set(approvalId, sessionId);
    this.emitters.set(approvalId, emit);

    emit.emit({ type: 'approval-request', sessionId, request });

    return new Promise<ApprovalDecision | null>((resolve) => {
      const timer = setTimeout(() => {
        this.stateProvider.resolveApproval(approvalId, null);
        resolve(null);
      }, request.timeoutMs);

      this.stateProvider.registerPendingApproval(approvalId, (decision) => {
        clearTimeout(timer);
        resolve(decision);
      });
    });
  }

  async resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean> {
    const sessionId = this.approvalToSession.get(approvalId);
    const emit = this.emitters.get(approvalId);
    if (!sessionId) {
      return false;
    }

    const success = this.stateProvider.resolveApproval(approvalId, decision);
    if (!success) {
      return false;
    }

    const state = await this.stateProvider.getState(sessionId);
    await this.stateProvider.setState(sessionId, {
      pendingApprovals: state.pendingApprovals.filter((r) => r.approvalId !== approvalId),
    });

    if (emit) {
      emit.emit({ type: 'approval-resolved', sessionId, approvalId, decision });
    }

    this.approvalToSession.delete(approvalId);
    this.emitters.delete(approvalId);
    return true;
  }

  async listPending(sessionId?: string): Promise<ApprovalRequest[]> {
    if (!sessionId) {
      return [];
    }
    const state = await this.stateProvider.getState(sessionId);
    return state.pendingApprovals;
  }
}
