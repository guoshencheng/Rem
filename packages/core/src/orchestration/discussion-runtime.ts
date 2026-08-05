import type { ResolvedOrchestrationConfig } from '../sdk/config-provider.js';
import { DiscussionBudget } from './discussion-budget.js';

export type DiscussionRuntimeStatus = 'running' | 'finishing' | 'completed' | 'failed' | 'interrupted';

/** 一轮讨论（一个 rootUserMessageId 引发的全部协作）的进程内生命周期：状态机、finishRequest、abortController 与预算账本。 */
export class DiscussionRuntime {
  readonly startedAt = Date.now();
  readonly abortController = new AbortController();
  readonly budget;
  status: DiscussionRuntimeStatus = 'running';
  finishRequest?: { requestedByAgentThreadId: string; answer: string };

  constructor(readonly rootUserMessageId: string, config: ResolvedOrchestrationConfig) {
    this.budget = new DiscussionBudget(config, this.startedAt);
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
