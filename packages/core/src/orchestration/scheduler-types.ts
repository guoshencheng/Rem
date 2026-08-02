import type { MessageDeliveryUsecase } from './delivery-usecase.js';
import type { DeliveryExecutionPort } from './delivery-executor.js';
import type { MessageDelivery } from './delivery-model.js';
import type { DiscussionRuntime } from './discussion-runtime.js';
import type { DiscussionBudgetReason } from './discussion-budget.js';

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
