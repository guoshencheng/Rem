import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message, Usage } from '@earendil-works/pi-ai';
import type { SessionProvider } from '../sdk/session-provider.js';
import type { Session } from '../session.js';
import { generateId } from '../shared/generate-id.js';
import { addUsage, emptyUsage } from '../token-usage.js';

export interface SessionWriterParams {
  sessionProvider: SessionProvider;
  session: Session;
}

export interface SessionWriter {
  listener: (event: AgentEvent) => Promise<void>;
  getTotalUsage: () => Usage;
  getLastAssistantMessage: () => AssistantMessage | undefined;
  getLastAssistantMessageId: () => string | undefined;
}

export function createSessionWriter(params: SessionWriterParams): SessionWriter {
  const { sessionProvider, session } = params;
  let totalUsage = emptyUsage();
  let lastAssistant: AssistantMessage | undefined;
  let lastAssistantMessageId: string | undefined;

  const listener = async (event: AgentEvent): Promise<void> => {
    if (event.type === 'turn_end') {
      if (event.message.role === 'assistant') {
        lastAssistant = event.message as AssistantMessage;
        totalUsage = addUsage(totalUsage, lastAssistant.usage);
      }
      return;
    }
    if (event.type !== 'message_end') return;
    const message = event.message as Message;
    const id = generateId();
    if (message.role === 'assistant') {
      lastAssistantMessageId = id;
    }
    await sessionProvider.appendMessage(session, message, id);
  };

  return {
    listener,
    getTotalUsage: () => totalUsage,
    getLastAssistantMessage: () => lastAssistant,
    getLastAssistantMessageId: () => lastAssistantMessageId,
  };
}
