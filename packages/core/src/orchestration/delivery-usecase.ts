import type { MessageDelivery } from './delivery-model.js';
import type { MessageDeliveryStore } from './delivery-store.js';
import { DeliveryError } from './delivery-errors.js';

/** delivery 状态机的唯一操作入口：批量创建校验、原子抢占与完成/失败/中断/恢复等状态迁移。 */
export class MessageDeliveryUsecase {
  constructor(private readonly store: MessageDeliveryStore) {}

  /** 批量创建 delivery，校验批次内 (kind, batchId, target) 不重复。 */
  async createBatch(items: MessageDelivery[]): Promise<void> {
    if (items.length === 0) throw new DeliveryError('Delivery batch cannot be empty');
    const identities = new Set(items.map((item) => `${item.kind}:${item.batchId}:${item.targetAgentThreadId}`));
    if (identities.size !== items.length) throw new DeliveryError('Delivery batch contains duplicate targets');
    await this.store.createBatch(items);
  }

  get(deliveryId: string): Promise<MessageDelivery | null> { return this.store.get(deliveryId); }
  listByRoot(sessionId: string, rootId: string): Promise<MessageDelivery[]> {
    return this.store.listByRoot(sessionId, rootId);
  }
  listQueued(sessionId: string, rootId: string): Promise<MessageDelivery[]> {
    return this.store.listQueued(sessionId, rootId);
  }
  /** 原子抢占 queued delivery，返回 false 表示已被其他执行者抢走，防并发重复执行。 */
  claim(deliveryId: string): Promise<boolean> { return this.store.claim(deliveryId); }
  complete(deliveryId: string): Promise<void> { return this.store.complete(deliveryId); }
  fail(deliveryId: string, error: string): Promise<void> { return this.store.fail(deliveryId, error); }
  interruptRoot(sessionId: string, rootId: string): Promise<number> {
    return this.store.interruptRoot(sessionId, rootId);
  }
  recoverProcessing(): Promise<number> { return this.store.recoverProcessing(); }
}
