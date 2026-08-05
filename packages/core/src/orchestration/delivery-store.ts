import type { MessageDelivery } from './delivery-model.js';

/** delivery 持久化接口，SQLite 实现见 plugins/storage。 */
export interface MessageDeliveryStore {
  createBatch(items: MessageDelivery[]): Promise<void>;
  get(deliveryId: string): Promise<MessageDelivery | null>;
  listByRoot(sessionId: string, rootUserMessageId: string): Promise<MessageDelivery[]>;
  listQueued(sessionId: string, rootUserMessageId: string): Promise<MessageDelivery[]>;
  claim(deliveryId: string): Promise<boolean>;
  complete(deliveryId: string): Promise<void>;
  fail(deliveryId: string, error: string): Promise<void>;
  interruptRoot(sessionId: string, rootUserMessageId: string): Promise<number>;
  recoverProcessing(): Promise<number>;
}
