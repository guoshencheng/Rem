import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SessionProvider } from 'rem-agent-core';
import { ProviderManager } from 'rem-agent-core';
import { sendJson } from '../utils.js';

export async function handleListSessions(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const pm = await ProviderManager.getInstance();
  const sessionProvider = pm.require<SessionProvider>('session');
  const sessions = await sessionProvider.list();
  sendJson(res, 200, sessions);
}
