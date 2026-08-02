import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { CommunicationModelIdentity } from './communication-message.js';
import { createCommunicationMessage } from './communication-message.js';

export function createSyntheticFailureMessage(
  model: CommunicationModelIdentity,
  error: unknown,
): AssistantMessage {
  const detail = describeError(error);
  return createCommunicationMessage(model, `Agent execution failed: ${detail}`);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const candidate = error as { errorMessage?: unknown; content?: Array<{ type?: string; text?: string }> };
    if (typeof candidate.errorMessage === 'string') return candidate.errorMessage;
    const text = candidate.content?.find((part) => part.type === 'text')?.text;
    if (text) return text;
  }
  return String(error);
}
