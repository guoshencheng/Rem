import type { MessageDelivery } from './delivery-model.js';

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
