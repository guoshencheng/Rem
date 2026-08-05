import type { MessageDelivery } from './delivery-model.js';
import type { MessageDeliveryUsecase } from './delivery-usecase.js';
import { generateId } from '../shared/generate-id.js';

const TERMINAL = new Set(['completed', 'failed', 'interrupted']);

/** 批次完成检测：同一 batchId 的 message delivery 全部进入终态时，为发起方生成 resume delivery，唤醒其继续讨论。 */
export class BatchCompletion {
  constructor(private readonly deliveries: MessageDeliveryUsecase) {}

  /** 若所属批次已全部终态则创建 resume delivery；unique constraint 冲突视为已有 resume，直接忽略。 */
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
