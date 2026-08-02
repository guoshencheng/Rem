import type { ResolvedOrchestrationConfig } from '../sdk/config-provider.js';

export type DiscussionBudgetReason = 'agent-runs' | 'messages' | 'depth' | 'timeout' | 'tokens';

export class DiscussionBudget {
  agentRuns = 0;
  messages = 0;
  maxDepthReached = 0;
  tokens = 0;
  restrictedSummaryQueued = false;

  constructor(readonly limits: ResolvedOrchestrationConfig, readonly startedAt = Date.now()) {}

  check(nextDepth?: number, now = Date.now()): DiscussionBudgetReason | null {
    if (this.agentRuns >= this.limits.maxAgentRuns) return 'agent-runs';
    if (this.messages >= this.limits.maxMessages) return 'messages';
    if (nextDepth !== undefined && nextDepth > this.limits.maxDepth) return 'depth';
    if (now - this.startedAt >= this.limits.timeoutMs) return 'timeout';
    if (this.tokens >= this.limits.maxTokens) return 'tokens';
    return null;
  }

  recordRun(depth: number): void {
    this.agentRuns += 1;
    this.maxDepthReached = Math.max(this.maxDepthReached, depth);
  }

  reserveRun(depth: number): DiscussionBudgetReason | null {
    const reason = this.check(depth);
    if (reason) return reason;
    this.recordRun(depth);
    return null;
  }

  releaseRun(): void { this.agentRuns = Math.max(0, this.agentRuns - 1); }

  recordMessage(): void { this.messages += 1; }
  recordTokens(tokens: number): void { this.tokens += Math.max(0, tokens); }
}
