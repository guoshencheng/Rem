import type { ToolHook, ToolHookContext, ToolHookResult } from '../sdk/tool-hook.js';
import type { ApprovalDecision, ApprovalManager, ApprovalRequestHandle } from './approval-manager.js';

export interface ToolHookRunnerOptions {
  hooks?: ToolHook[];
  approvalManager: ApprovalManager;
}

export interface ToolHookRunOutcome {
  blocked?: { reason: string };
  approved?: boolean;
  params?: unknown;
  approvalId?: string;
}

export class ToolHookRunner {
  constructor(private options: ToolHookRunnerOptions) {}

  async run(ctx: ToolHookContext): Promise<ToolHookRunOutcome> {
    let currentParams = ctx.input;
    let lastApprovalId: string | undefined;

    for (const hook of this.options.hooks ?? []) {
      const result = await hook({ ...ctx, input: currentParams });
      if (!result) continue;

      if (result.block) {
        return { blocked: result.block };
      }

      if (result.requireApproval) {
        const handle = this.requestApproval(ctx, result.requireApproval);
        lastApprovalId = handle.request.approvalId;
        const decision = await handle.waitForDecision();

        if (result.requireApproval.onDecision && decision !== null) {
          result.requireApproval.onDecision(decision);
        }

        if (decision !== 'allow-once' && decision !== 'allow-always') {
          let reason: string;
          if (decision === 'deny') {
            reason = 'Approval denied';
          } else if (decision === null) {
            reason = 'Approval timed out';
          } else {
            reason = `Approval ${decision}`;
          }
          if (result.requireApproval.description) {
            reason += `: ${result.requireApproval.description}`;
          }
          return {
            blocked: { reason },
            approvalId: lastApprovalId,
          };
        }
      }

      if (result.params !== undefined) {
        currentParams = result.params;
      }
    }

    return { approved: true, params: currentParams, approvalId: lastApprovalId };
  }

  private requestApproval(
    ctx: ToolHookContext,
    requirement: NonNullable<ToolHookResult['requireApproval']>,
  ): ApprovalRequestHandle {
    return this.options.approvalManager.create(
      {
        toolName: ctx.toolName,
        toolCallId: ctx.toolCallId,
        title: requirement.title,
        description: requirement.description,
        severity: requirement.severity,
        allowedDecisions: requirement.allowedDecisions,
        timeoutMs: requirement.timeoutMs,
      },
      requirement.timeoutMs,
    );
  }
}
