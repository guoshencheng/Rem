import { randomUUID } from 'node:crypto';

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
}

export interface ApprovalRequestHandle {
  request: ApprovalRequest;
  waitForDecision(): Promise<ApprovalDecision | null>;
}

interface PendingEntry {
  request: ApprovalRequest;
  resolve: (value: ApprovalDecision | null) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000;

export class ApprovalManager {
  private pending = new Map<string, PendingEntry>();

  create(
    params: Omit<ApprovalRequest, 'approvalId'>,
    timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS,
  ): ApprovalRequestHandle {
    const approvalId = `approval:${randomUUID()}`;
    const request: ApprovalRequest = { ...params, approvalId, timeoutMs };

    let resolveFn: (value: ApprovalDecision | null) => void;
    let rejectFn: (err: Error) => void;

    const decisionPromise = new Promise<ApprovalDecision | null>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const timer = setTimeout(() => {
      this.pending.delete(approvalId);
      resolveFn(null);
    }, timeoutMs);

    this.pending.set(approvalId, {
      request,
      resolve: resolveFn!,
      reject: rejectFn!,
      timer,
    });

    return {
      request,
      waitForDecision: () => decisionPromise,
    };
  }

  resolve(approvalId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(approvalId);
    entry.resolve(decision);
    return true;
  }

  cancel(approvalId: string): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(approvalId);
    entry.reject(new Error('Approval cancelled'));
    return true;
  }

  getPending(approvalId: string): ApprovalRequest | undefined {
    return this.pending.get(approvalId)?.request;
  }

  listPending(): ApprovalRequest[] {
    return Array.from(this.pending.values()).map((entry) => entry.request);
  }
}
