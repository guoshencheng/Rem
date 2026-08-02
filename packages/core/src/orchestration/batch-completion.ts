import type { MessageDelivery } from './delivery-model.js';
import type { MessageDeliveryUsecase } from './delivery-usecase.js';
import { generateId } from '../shared/generate-id.js';

const TERMINAL = new Set(['completed', 'failed', 'interrupted']);

export class BatchCompletion {
  constructor(private readonly deliveries: MessageDeliveryUsecase) {}

  async createResumeIfComplete(delivery: MessageDelivery): Promise<void> {
    if (delivery.kind !== 'message' || !delivery.requestedByAgentThreadId) return;
    const root = await this.deliveries.listByRoot(delivery.sessionId, delivery.rootUserMessageId);
    const batch = root.filter((item) => item.kind === 'message' && item.batchId === delivery.batchId);
    if (batch.length === 0 || batch.some((item) => !TERMINAL.has(item.status))) return;
    const now = new Date();
    try {
      await this.deliveries.createBatch([{
        deliveryId: generateId(), sessionId: delivery.sessionId, kind: 'resume',
        batchId: delivery.batchId, messageId: delivery.messageId,
        rootUserMessageId: delivery.rootUserMessageId,
        targetAgentThreadId: delivery.requestedByAgentThreadId,
        status: 'queued', attempt: 0, depth: delivery.depth, createdAt: now, updatedAt: now,
      }]);
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
    }
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}
