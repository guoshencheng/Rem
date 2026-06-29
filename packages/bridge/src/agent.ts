import type { SessionProvider, RunAgentResult } from 'rem-agent-core';
import { runAgent, ProviderManager } from 'rem-agent-core';
import { ServiceError } from './errors.js';

export interface RunParams {
  sessionId: string;
  content: string;
}

export interface RunResult {
  sessionId: string;
}

export interface InterruptResult {
  sessionId: string;
  interrupted: boolean;
}

export interface ResetResult {
  sessionId: string;
  reset: boolean;
}

export class AgentService {
  private activeRuns = new Map<string, AbortController>();
  private activeStreams = new Map<string, RunAgentResult>();

  run(params: RunParams): RunResult {
    if (this.activeRuns.has(params.sessionId)) {
      throw new ServiceError('Session is already running', 409);
    }

    const abortController = new AbortController();
    this.activeRuns.set(params.sessionId, abortController);

    const result = runAgent({
      input: { content: params.content, timestamp: new Date() },
      sessionId: params.sessionId,
      signal: abortController.signal,
    });

    this.activeStreams.set(params.sessionId, result);

    result.output.finally(() => {
      this.activeRuns.delete(params.sessionId);
      this.activeStreams.delete(params.sessionId);
    });

    return { sessionId: params.sessionId };
  }

  interrupt(sessionId: string): InterruptResult {
    const controller = this.activeRuns.get(sessionId);
    if (controller) {
      controller.abort();
    }
    return { sessionId, interrupted: !!controller };
  }

  async reset(sessionId: string): Promise<ResetResult> {
    const pm = await ProviderManager.getInstance();
    const sessionProvider = pm.require<SessionProvider>('session');
    const session = await sessionProvider.load(sessionId);
    if (session) {
      session.conversation = [];
      session.metadata = {};
      await sessionProvider.save(session);
    }
    return { sessionId, reset: true };
  }

  getStream(sessionId: string): RunAgentResult | undefined {
    return this.activeStreams.get(sessionId);
  }
}
