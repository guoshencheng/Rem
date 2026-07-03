import type { ToolHook, ToolHookContext, ToolHookResult } from '../sdk/tool-hook.js';
import type { ApprovalOrchestrator, ApprovalChunkEmitter } from '../sdk/approval-orchestrator.js';

export interface ToolHookRunnerOptions {
  hooks?: ToolHook[];
  approvalOrchestrator?: ApprovalOrchestrator;
}

export interface ToolHookRunOutcome {
  blocked?: { reason: string };
  approved?: boolean;
  params?: unknown;
}

export class ToolHookRunner {
  constructor(private options: ToolHookRunnerOptions) {}

  async run(ctx: ToolHookContext, emit?: ApprovalChunkEmitter): Promise<ToolHookRunOutcome> {
    let currentParams = ctx.input;

    for (const hook of this.options.hooks ?? []) {
      const result = await hook({ ...ctx, input: currentParams });
      if (!result) continue;

      if (result.block) {
        return { blocked: result.block };
      }

      if (result.requireApproval) {
        const orchestrator = this.options.approvalOrchestrator;
        if (orchestrator) {
          const decision = await orchestrator.requestApproval(
            ctx,
            result.requireApproval,
            emit ?? { emit: () => {} },
          );

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
            return { blocked: { reason } };
          }
        }
      }

      if (result.params !== undefined) {
        currentParams = result.params;
      }
    }

    return { approved: true, params: currentParams };
  }
}
