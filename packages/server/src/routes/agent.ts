import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SessionProvider } from 'rem-agent-core';
import { runAgent, ProviderManager } from 'rem-agent-core';
import type {
  RunRequest,
  InterruptRequest,
  ResetRequest,
} from 'rem-agent-sdk';
import { getRequestBody, sendJson, sendError } from '../utils.js';
import { activeRuns, activeStreams } from '../state.js';

export async function handleAgentRun(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await getRequestBody(req);
  const { sessionId, content } = JSON.parse(body) as RunRequest;

  if (activeRuns.has(sessionId)) {
    sendError(res, 409, 'Session is already running');
    return;
  }

  const abortController = new AbortController();
  activeRuns.set(sessionId, abortController);

  const result = runAgent({
    input: { content, timestamp: new Date() },
    sessionId,
    signal: abortController.signal,
  });

  activeStreams.set(sessionId, result);

  result.output.finally(() => {
    activeRuns.delete(sessionId);
    activeStreams.delete(sessionId);
  });

  sendJson(res, 202, {
    sessionId,
    streamUrl: `/api/stream/${encodeURIComponent(sessionId)}`,
  });
}

export async function handleAgentInterrupt(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await getRequestBody(req);
  const { sessionId } = JSON.parse(body) as InterruptRequest;
  const controller = activeRuns.get(sessionId);
  if (controller) {
    controller.abort();
  }
  sendJson(res, 200, { sessionId, interrupted: !!controller });
}

export async function handleAgentReset(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await getRequestBody(req);
  const { sessionId } = JSON.parse(body) as ResetRequest;
  const pm = await ProviderManager.getInstance();
  const sessionProvider = pm.require<SessionProvider>('session');
  const session = await sessionProvider.load(sessionId);
  if (session) {
    session.conversation = [];
    session.metadata = {};
    await sessionProvider.save(session);
  }
  sendJson(res, 200, { sessionId, reset: true });
}
