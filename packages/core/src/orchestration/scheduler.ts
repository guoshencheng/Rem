import type { MessageDelivery } from './delivery-model.js';
import type { DiscussionRuntime } from './discussion-runtime.js';
import type { SchedulerDeps } from './scheduler-types.js';
import { BatchCompletion } from './batch-completion.js';
import { ConcurrencyLimiter } from './concurrency-limiter.js';

export const BUDGET_SUMMARY_BATCH_PREFIX = 'budget-summary:';

export class OrchestrationScheduler {
  private readonly limiter: ConcurrencyLimiter;
  private readonly batches: BatchCompletion;

  constructor(private readonly deps: SchedulerDeps) {
    this.limiter = new ConcurrencyLimiter(deps.maxParallelAgents);
    this.batches = new BatchCompletion(deps.deliveries);
  }

  async drive(sessionId: string, discussion: DiscussionRuntime): Promise<void> {
    while (discussion.status === 'running' || discussion.status === 'finishing') {
      const queued = await this.deps.deliveries.listQueued(
        sessionId, discussion.rootUserMessageId,
      );
      if (queued.length === 0) {
        const deliveries = await this.deps.deliveries.listByRoot(sessionId, discussion.rootUserMessageId);
        if (await this.resolveIdle(discussion, deliveries)) continue;
        return;
      }
      await Promise.all(queued.map((delivery) => this.limiter.run(() => this.execute(delivery, discussion))));
    }
  }

  private async execute(delivery: MessageDelivery, discussion: DiscussionRuntime): Promise<void> {
    const restrictedSummary = delivery.kind === 'resume'
      && delivery.batchId.startsWith(BUDGET_SUMMARY_BATCH_PREFIX);
    const budgetReason = restrictedSummary ? null : discussion.budget.reserveRun(delivery.depth);
    if (budgetReason) {
      if (!discussion.budget.restrictedSummaryQueued) {
        discussion.budget.restrictedSummaryQueued = true;
        await this.deps.onBudgetExhausted?.(budgetReason, delivery, discussion);
      }
      return;
    }
    if (discussion.abortController.signal.aborted || !await this.deps.deliveries.claim(delivery.deliveryId)) {
      if (!restrictedSummary) discussion.budget.releaseRun();
      return;
    }
    const processing = await this.deps.deliveries.get(delivery.deliveryId);
    if (processing) this.deps.onDeliveryChange?.(processing);
    if (restrictedSummary) discussion.budget.recordRun(delivery.depth);
    try {
      await this.deps.executor.execute(delivery, discussion);
      if (discussion.abortController.signal.aborted) return;
      if ((await this.deps.deliveries.get(delivery.deliveryId))?.status === 'processing') {
        await this.deps.deliveries.complete(delivery.deliveryId);
      }
    } catch (error) {
      if ((await this.deps.deliveries.get(delivery.deliveryId))?.status === 'processing') {
        await this.deps.deliveries.fail(
          delivery.deliveryId, error instanceof Error ? error.message : String(error),
        );
      }
      await this.deps.onExecutionFailure?.(delivery, error, discussion);
    }
    const terminal = await this.deps.deliveries.get(delivery.deliveryId);
    if (terminal) {
      this.deps.onDeliveryChange?.(terminal);
      await this.batches.createResumeIfComplete(terminal);
    }
  }

  private async resolveIdle(
    discussion: DiscussionRuntime,
    deliveries: MessageDelivery[],
  ): Promise<boolean> {
    const active = deliveries.some((item) => item.status === 'queued' || item.status === 'processing');
    if (active) return false;
    if (discussion.status === 'finishing' && discussion.finishRequest?.answer.trim()) {
      discussion.status = 'completed';
      return false;
    }
    const reason = discussion.budget.check();
    const last = deliveries.at(-1);
    if (reason && last && this.deps.onBudgetExhausted && !discussion.budget.restrictedSummaryQueued) {
      discussion.budget.restrictedSummaryQueued = true;
      await this.deps.onBudgetExhausted(reason, last, discussion);
      return true;
    }
    discussion.status = 'failed';
    return false;
  }
}
