import type { REMAgentEvent } from '../../agent/agent-event.js';
import type { MessageEntryPayload } from './payload.js';
import { MessagePayloadError } from './payload.js';

export function agentEventToMessagePayload(
  event: Extract<REMAgentEvent, { type: 'message-persist' }>,
  agentThreadId: string,
): MessageEntryPayload {
  const base = { message: event.message, messageId: event.messageId };
  switch (event.message.role) {
    case 'user':
      return { ...base, author: { type: 'user' }, scope: { type: 'session' } };
    case 'assistant':
      return {
        ...base,
        author: { type: 'agent', agentThreadId },
        scope: { type: 'session' },
      };
    case 'toolResult':
      return {
        ...base,
        author: { type: 'tool', agentThreadId },
        scope: { type: 'thread', agentThreadId },
      };
    default:
      throw new MessagePayloadError('unsupported Agent message role');
  }
}
