import type { MessageDeliveryUsecase } from './delivery-usecase.js';
import type { DeliveryExecutionPort } from './delivery-executor.js';
import type { MessageDelivery } from './delivery-model.js';

export interface SchedulerDeps {
  deliveries: MessageDeliveryUsecase;
  executor: DeliveryExecutionPort;
  maxParallelAgents: number;
  onDeliveryChange?(delivery: MessageDelivery): void;
}
