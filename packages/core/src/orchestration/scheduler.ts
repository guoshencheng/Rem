import type { MessageDelivery } from './delivery-model.js';
import type { DiscussionRuntime } from './discussion-runtime.js';
import type { SchedulerDeps } from './scheduler-types.js';
import { BatchCompletion } from './batch-completion.js';
import { ConcurrencyLimiter } from './concurrency-limiter.js';

/** 预算耗尽后给 organizer 做受限收尾总结用的特殊批次前缀，该批次的 resume 不再占用预算。 */
export const BUDGET_SUMMARY_BATCH_PREFIX = 'budget-summary:';

/** 调度主循环：拉取 queued delivery → 经 ConcurrencyLimiter 并发执行 → 完成/失败落库 → 触发批次完成检查，直到 discussion 结束。 */
export class OrchestrationScheduler {
  private readonly limiter: ConcurrencyLimiter;
  private readonly batches: BatchCompletion;

  constructor(private readonly deps: SchedulerDeps) {
    this.limiter = new ConcurrencyLimiter(deps.maxParallelAgents);
    this.batches = new BatchCompletion(deps.deliveries);
  }

  /** 主循环（连续调度）：扫描 queued delivery，按 thread 空闲放行执行，任何一条完成立即重扫；真空时交给 resolveIdle 收尾或退出。 */
  async drive(sessionId: string, discussion: DiscussionRuntime): Promise<void> {
    const busyThreads = new Set<string>();
    let inFlight = 0;
    let wake: () => void = () => {};
    while (discussion.status === 'running' || discussion.status === 'finishing') {
      const queued = await this.deps.deliveries.listQueued(
        sessionId, discussion.rootUserMessageId,
      );
      for (const delivery of queued) {
        if (busyThreads.has(delivery.targetAgentThreadId)) continue;
        busyThreads.add(delivery.targetAgentThreadId);
        inFlight += 1;
        void this.limiter.run(() => this.execute(delivery, discussion))
          .catch(() => undefined)
          .finally(() => {
            busyThreads.delete(delivery.targetAgentThreadId);
            inFlight -= 1;
            wake();
          });
      }
      if (inFlight === 0) {
        const deliveries = await this.deps.deliveries.listByRoot(sessionId, discussion.rootUserMessageId);
        if (await this.resolveIdle(discussion, deliveries)) continue;
        return;
      }
      await new Promise<void>((resolve) => { wake = resolve; });
    }
  }

  /** 执行单条 delivery：先过 budget.reserveRun 预算护栏，再 claim 原子抢占防并发重复执行，执行后落库并触发批次完成检查。 */
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

  /** 无 queued delivery 时的收尾决策：finishing 则完成 / 预算耗尽则触发 onBudgetExhausted / 否则标记 failed。 */
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
