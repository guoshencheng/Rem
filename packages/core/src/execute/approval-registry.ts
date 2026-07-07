import type { ApprovalDecision } from '../sdk/agent-state-provider.js';

export class ApprovalRegistry {
  private pending = new Map<string, {
    resolve: (d: ApprovalDecision) => void;
    reject: (e: Error) => void;
  }>();

  wait(approvalId: string, timeoutMs?: number): Promise<ApprovalDecision | null> {
    const promise = new Promise<ApprovalDecision>((resolve, reject) => {
      this.pending.set(approvalId, { resolve, reject });
    });

    if (timeoutMs && timeoutMs > 0) {
      return Promise.race([
        promise,
        new Promise<ApprovalDecision | null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
    }

    return promise;
  }

  resolve(approvalId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    entry.resolve(decision);
    this.pending.delete(approvalId);
    return true;
  }

  reject(approvalId: string, error: Error): void {
    const entry = this.pending.get(approvalId);
    if (!entry) return;
    entry.reject(error);
    this.pending.delete(approvalId);
  }
}
