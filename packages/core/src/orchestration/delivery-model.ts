export type MessageDeliveryKind = 'message' | 'resume';
export type MessageDeliveryStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'interrupted';

export interface MessageDelivery {
  deliveryId: string;
  sessionId: string;
  kind: MessageDeliveryKind;
  batchId: string;
  messageId: string;
  rootUserMessageId: string;
  targetAgentThreadId: string;
  requestedByAgentThreadId?: string;
  status: MessageDeliveryStatus;
  attempt: number;
  depth: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}
