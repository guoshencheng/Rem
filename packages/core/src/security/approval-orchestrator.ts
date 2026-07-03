import type { AgentStateProvider, ApprovalDecision, ApprovalRequest } from '../sdk/agent-state-provider.js';
import type { ToolHookContext } from '../sdk/tool-hook.js';
import type {
  ApprovalChunkEmitter,
  ApprovalRequirement,
  ApprovalOrchestrator as IApprovalOrchestrator,
} from '../sdk/approval-orchestrator.js';
import { ApprovalManager, DEFAULT_APPROVAL_TIMEOUT_MS } from './approval-manager.js';

export class ApprovalOrchestrator implements IApprovalOrchestrator {
  private approvalToSession = new Map<string, string>();
  private emitters = new Map<string, ApprovalChunkEmitter>();

  constructor(
    private stateProvider: AgentStateProvider,
    private approvalManager: ApprovalManager,
  ) {}

  async requestApproval(
    ctx: ToolHookContext,
    requirement: ApprovalRequirement,
    emit: ApprovalChunkEmitter,
  ): Promise<ApprovalDecision | null> {
    const sessionId = ctx.sessionId;
    if (!sessionId) {
      throw new Error('sessionId is required for approval');
    }

    const handle = this.approvalManager.create(
      {
        sessionId,
        toolName: ctx.toolName,
        toolCallId: ctx.toolCallId,
        title: requirement.title,
        description: requirement.description,
        severity: requirement.severity,
        allowedDecisions: requirement.allowedDecisions,
      },
      requirement.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS,
    );

    const request = handle.request;

    this.approvalToSession.set(request.approvalId, sessionId);
    this.emitters.set(request.approvalId, emit);

    const state = await this.stateProvider.getState(sessionId);
    await this.stateProvider.setState(sessionId, {
      pendingApprovals: [...state.pendingApprovals, request],
    });

    emit.emit({ type: 'approval-request', sessionId, request });

    return this.awaitDecision(request.approvalId, handle, ctx.signal);
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision): boolean {
    return this.approvalManager.resolve(approvalId, decision);
  }

  async listPending(sessionId?: string): Promise<ApprovalRequest[]> {
    if (!sessionId) {
      return [];
    }
    const state = await this.stateProvider.getState(sessionId);
    return state.pendingApprovals;
  }

  private async awaitDecision(
    approvalId: string,
    handle: { waitForDecision(): Promise<ApprovalDecision | null> },
    signal?: AbortSignal,
  ): Promise<ApprovalDecision | null> {
    try {
      const decision = signal
        ? await this.raceWithSignal(handle, signal, approvalId)
        : await handle.waitForDecision();
      await this.finalize(approvalId, decision);
      return decision;
    } catch (err) {
      await this.finalize(approvalId, null);
      throw err;
    }
  }

  private raceWithSignal(
    handle: { waitForDecision(): Promise<ApprovalDecision | null> },
    signal: AbortSignal,
    approvalId: string,
  ): Promise<ApprovalDecision | null> {
    const wait = handle.waitForDecision();
    wait.catch(() => {});

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        this.approvalManager.cancel(approvalId);
        reject(new Error('Approval aborted'));
      };

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener('abort', onAbort, { once: true });

      wait.then(
        (decision) => {
          cleanup();
          resolve(decision);
        },
        (err) => {
          cleanup();
          reject(err);
        },
      );
    });
  }

  private async finalize(approvalId: string, decision: ApprovalDecision | null): Promise<void> {
    const sessionId = this.approvalToSession.get(approvalId);
    if (!sessionId) {
      return;
    }

    try {
      const state = await this.stateProvider.getState(sessionId);
      await this.stateProvider.setState(sessionId, {
        pendingApprovals: state.pendingApprovals.filter((r) => r.approvalId !== approvalId),
      });

      const emit = this.emitters.get(approvalId);
      if (emit) {
        emit.emit({ type: 'approval-resolved', sessionId, approvalId, decision });
      }
    } finally {
      this.cleanup(approvalId);
    }
  }

  private cleanup(approvalId: string): void {
    this.approvalToSession.delete(approvalId);
    this.emitters.delete(approvalId);
  }
}
