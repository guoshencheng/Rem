import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { SessionProvider } from '../sdk/session-provider.js';
import type { Session } from '../session.js';
import { generateId } from '../shared/generate-id.js';

export interface SessionWriterParams {
  sessionProvider: SessionProvider;
  session: Session;
  idOf: (message: Message) => string | undefined;
}

export function createSessionWriter(params: SessionWriterParams): (event: AgentEvent) => Promise<void> {
  const { sessionProvider, session, idOf } = params;
  return async (event: AgentEvent) => {
    if (event.type !== 'message_end') return;
    await sessionProvider.appendMessage(session, event.message, idOf(event.message) ?? generateId());
  };
}
