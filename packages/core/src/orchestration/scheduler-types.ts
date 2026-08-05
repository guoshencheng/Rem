import type { MessageDeliveryUsecase } from './delivery-usecase.js';
import type { DeliveryExecutionPort } from './delivery-executor.js';
import type { MessageDelivery } from './delivery-model.js';
import type { DiscussionRuntime } from './discussion-runtime.js';
import type { DiscussionBudgetReason } from './discussion-budget.js';

/** OrchestrationScheduler 的外部依赖契约：delivery 操作用例、执行端口、并发上限，以及投递变更 / 预算耗尽 / 执行失败三个回调。 */
export interface SchedulerDeps {
  deliveries: MessageDeliveryUsecase;
  executor: DeliveryExecutionPort;
  maxParallelAgents: number;
  onDeliveryChange?(delivery: MessageDelivery): void;
  onBudgetExhausted?(
    reason: DiscussionBudgetReason,
    delivery: MessageDelivery,
    discussion: DiscussionRuntime,
  ): Promise<void>;
  onExecutionFailure?(
    delivery: MessageDelivery,
    error: unknown,
    discussion: DiscussionRuntime,
  ): Promise<void>;
}
