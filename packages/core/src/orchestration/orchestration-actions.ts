export interface SendAgentMessageInput {
  toAgentIds: string[];
  content: string;
}

export interface AgentOrchestrationActions {
  sendMessage(input: SendAgentMessageInput): Promise<{ batchId: string }>;
  finishDiscussion?(answer: string): Promise<void>;
}
