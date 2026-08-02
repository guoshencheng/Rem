import type { ResolvedOrchestrationConfig } from '../sdk/config-provider.js';
import { createDiscussionBudget } from './discussion-budget.js';

export type DiscussionRuntimeStatus = 'running' | 'finishing' | 'completed' | 'failed' | 'interrupted';

export class DiscussionRuntime {
  readonly startedAt = Date.now();
  readonly abortController = new AbortController();
  readonly budget;
  status: DiscussionRuntimeStatus = 'running';
  finishRequest?: { requestedByAgentThreadId: string; answer: string };

  constructor(readonly rootUserMessageId: string, config: ResolvedOrchestrationConfig) {
    this.budget = createDiscussionBudget(config);
  }

  requestFinish(requestedByAgentThreadId: string, answer: string): void {
    this.finishRequest = { requestedByAgentThreadId, answer };
    this.status = 'finishing';
  }

  interrupt(): void {
    this.abortController.abort();
    this.status = 'interrupted';
  }
}
