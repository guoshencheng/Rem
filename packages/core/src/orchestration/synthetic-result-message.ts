import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { CommunicationModelIdentity } from './communication-message.js';
import { createCommunicationMessage } from './communication-message.js';

export function createSyntheticFailureMessage(
  model: CommunicationModelIdentity,
  error: unknown,
): AssistantMessage {
  const detail = error instanceof Error ? error.message : String(error);
  return createCommunicationMessage(model, `Agent execution failed: ${detail}`);
}
