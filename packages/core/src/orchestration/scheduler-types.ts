import type { MessageDeliveryUsecase } from './delivery-usecase.js';
import type { DeliveryExecutionPort } from './delivery-executor.js';

export interface SchedulerDeps {
  deliveries: MessageDeliveryUsecase;
  executor: DeliveryExecutionPort;
  maxParallelAgents: number;
}
