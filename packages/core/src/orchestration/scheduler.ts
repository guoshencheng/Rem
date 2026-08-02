import type { MessageDelivery } from './delivery-model.js';
import type { DiscussionRuntime } from './discussion-runtime.js';
import type { SchedulerDeps } from './scheduler-types.js';
import { BatchCompletion } from './batch-completion.js';
import { ConcurrencyLimiter } from './concurrency-limiter.js';

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
        this.resolveIdle(discussion, await this.deps.deliveries.listByRoot(
          sessionId, discussion.rootUserMessageId,
        ));
        return;
      }
      await Promise.all(queued.map((delivery) => this.limiter.run(() => this.execute(delivery, discussion))));
    }
  }

  private async execute(delivery: MessageDelivery, discussion: DiscussionRuntime): Promise<void> {
    if (discussion.abortController.signal.aborted || !await this.deps.deliveries.claim(delivery.deliveryId)) return;
    const processing = await this.deps.deliveries.get(delivery.deliveryId);
    if (processing) this.deps.onDeliveryChange?.(processing);
    discussion.budget.agentRuns += 1;
    try {
      await this.deps.executor.execute(delivery, discussion);
      if (discussion.abortController.signal.aborted) return;
      await this.deps.deliveries.complete(delivery.deliveryId);
    } catch (error) {
      await this.deps.deliveries.fail(
        delivery.deliveryId, error instanceof Error ? error.message : String(error),
      );
    }
    const terminal = await this.deps.deliveries.get(delivery.deliveryId);
    if (terminal) {
      this.deps.onDeliveryChange?.(terminal);
      await this.batches.createResumeIfComplete(terminal);
    }
  }

  private resolveIdle(discussion: DiscussionRuntime, deliveries: MessageDelivery[]): void {
    const active = deliveries.some((item) => item.status === 'queued' || item.status === 'processing');
    if (active) return;
    if (discussion.status === 'finishing' && discussion.finishRequest?.answer.trim()) {
      discussion.status = 'completed';
      return;
    }
    discussion.status = 'failed';
  }
}
