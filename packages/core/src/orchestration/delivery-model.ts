export type MessageDeliveryKind = 'message' | 'resume';
export type MessageDeliveryStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'interrupted';

/** 持久化投递模型：一次"把消息送达某个 AgentThread 并执行"的任务，状态机 queued → processing → completed/failed/interrupted。 */
export interface MessageDelivery {
  deliveryId: string;
  sessionId: string;
  /** message 为消息投递；resume 为批次完成后对发起方的唤醒投递。 */
  kind: MessageDeliveryKind;
  batchId: string;
  messageId: string;
  rootUserMessageId: string;
  targetAgentThreadId: string;
  requestedByAgentThreadId?: string;
  status: MessageDeliveryStatus;
  attempt: number;
  /** 协作链深度，用于预算的 maxDepth 控制。 */
  depth: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}
