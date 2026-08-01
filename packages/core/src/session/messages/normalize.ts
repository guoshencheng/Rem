import type { MessageEntryPayload, NormalizedMessageEntryPayload } from './payload.js';
import { MessagePayloadError, validateMessagePayload } from './payload.js';

export function normalizeMessagePayload(
  payload: MessageEntryPayload,
  primaryThreadId: string,
): NormalizedMessageEntryPayload {
  const validated = validateMessagePayload(payload);
  if (validated.author && validated.scope) {
    return validated as NormalizedMessageEntryPayload;
  }
  const role = (validated.message as { role: string }).role;
  switch (role) {
    case 'user':
      return { ...validated, author: validated.author ?? { type: 'user' }, scope: validated.scope ?? { type: 'session' } };
    case 'assistant':
      return withPrimaryDefaults(validated, primaryThreadId, 'agent', 'session');
    case 'toolResult':
      return withPrimaryDefaults(validated, primaryThreadId, 'tool', 'thread');
    default:
      throw new MessagePayloadError(`unsupported message role: ${role}`);
  }
}

function withPrimaryDefaults(
  payload: MessageEntryPayload,
  primaryThreadId: string,
  authorType: 'agent' | 'tool',
  scopeType: 'session' | 'thread',
): NormalizedMessageEntryPayload {
  if (!primaryThreadId) throw new MessagePayloadError('primaryThreadId is required');
  return {
    ...payload,
    author: payload.author ?? { type: authorType, agentThreadId: primaryThreadId },
    scope: payload.scope ?? (scopeType === 'session'
      ? { type: 'session' }
      : { type: 'thread', agentThreadId: primaryThreadId }),
  } as NormalizedMessageEntryPayload;
}
