import type { Rule } from '../security/rules/rule.js';
import type { ApprovalDecision, ApprovalRequest } from '../sdk/agent-state-provider.js';
import { generateId } from '../shared/generate-id.js';

export type { ApprovalDecision };

export interface CreateApprovalInput {
  toolCallId: string;
  toolName: string;
  patterns: string[];
  title?: string;
  description?: string;
  severity?: ApprovalRequest['severity'];
  alwaysOptions: Array<{ label: string; rule: Omit<Rule, 'source'> }>;
}

export interface ApprovalResolution {
  decision: ApprovalDecision;
  rule?: Omit<Rule, 'source'>;
}

export class ApprovalEngine {
  private pending = new Map<string, {
    request: ApprovalRequest;
    resolve: (value: ApprovalResolution) => void;
  }>();

  constructor(private sessionId: string) {}

  createRequest(input: CreateApprovalInput): ApprovalRequest {
    const approvalId = generateId();
    const request: ApprovalRequest = {
      approvalId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      patterns: input.patterns,
      title: input.title ?? `Run ${input.toolName}`,
      description: input.description,
      severity: input.severity ?? 'warning',
      allowedDecisions: this.buildAllowedDecisions(input.alwaysOptions),
      alwaysOptions: input.alwaysOptions,
    };

    // Placeholder resolver; replaced by wait()
    this.pending.set(approvalId, { request, resolve: () => {} });
    return request;
  }

  wait(approvalId: string): Promise<ApprovalResolution> {
    const entry = this.pending.get(approvalId);
    if (!entry) return Promise.resolve({ decision: 'deny' });
    return new Promise<ApprovalResolution>((resolve) => {
      entry.resolve = (res) => {
        this.pending.delete(approvalId);
        resolve(res);
      };
    });
  }

  resolve(approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    entry.resolve({ decision, rule });
    return true;
  }

  denyAll(): void {
    for (const [id, entry] of this.pending) {
      entry.resolve({ decision: 'deny' });
      this.pending.delete(id);
    }
  }

  isPending(approvalId: string): boolean {
    return this.pending.has(approvalId);
  }

  private buildAllowedDecisions(options: Array<{ label: string; rule: Omit<Rule, 'source'> }>): Array<'allow-once' | 'allow-always' | 'deny'> {
    const decisions: Array<'allow-once' | 'allow-always' | 'deny'> = ['allow-once', 'deny'];
    if (options.length > 0) decisions.push('allow-always');
    return decisions;
  }
}
