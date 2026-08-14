import type { RuntimeSendMessageActions } from './runtime-send-message-tool.js';

export interface SingleAgentOrchestrationContext extends RuntimeSendMessageActions {
  nodeId: string;
  canSubmitResult(): Promise<boolean>;
  allowIntermediate: boolean;
  requiresFinal: boolean;
}
