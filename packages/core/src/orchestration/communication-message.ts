import type { AssistantMessage } from '@earendil-works/pi-ai';

export interface CommunicationModelIdentity {
  api: string;
  provider: string;
  id: string;
}

export function createCommunicationMessage(
  model: CommunicationModelIdentity,
  content: string,
): AssistantMessage {
  return {
    role: 'assistant', api: model.api, provider: model.provider, model: model.id,
    content: [{ type: 'text', text: content }], stopReason: 'stop', timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}
