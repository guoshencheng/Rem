import type { AgentStreamChunk, AgentStream, AgentOutput, ProviderManager, SessionProvider } from 'rem-agent-core';
import { runAgent as coreRunAgent } from 'rem-agent-core';
import { reduceStreamChunk } from './stream-reducer.js';
import { ServiceError } from './errors.js';
import { bus } from './broadcast-bus.js';
import { runRegistry } from './run-registry.js';
import type { BusEvent, SessionActivity, SessionSummary, SessionUpdate, UIMessage } from './types.js';
import type { IAgentService } from './agent-service.interface.js';
import { AgentSessionManager } from './agent-session.js';
import { SessionActivityTracker } from './session-activity-tracker.js';

export interface RunParams {
  sessionId: string;
  content: string;
}

export interface RunResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}

export interface InterruptResult {
  sessionId: string;
  interrupted: boolean;
}

export interface ResetResult {
  sessionId: string;
  reset: boolean;
}

export class AgentService implements IAgentService {
  private sessionProvider: SessionProvider;
  private workspace: string;
  private sessionManager: AgentSessionManager;
  private activityTracker: SessionActivityTracker;

  constructor(private providerManager: ProviderManager, workspace = 'default') {
    this.sessionProvider = providerManager.require<SessionProvider>('session');
    this.workspace = workspace;
    this.sessionManager = new AgentSessionManager(this.sessionProvider);
    this.activityTracker = new SessionActivityTracker((sessionId, activity) => {
      bus.publish({
        workspace: this.workspace,
        sessionId,
        type: 'activity-change',
        activity,
      });
    });
  }

  /* ---- Agent lifecycle ---- */

  async run(sessionId: string, input: string): Promise<AsyncIterable<AgentStreamChunk>> {
    const abortController = new AbortController();
    if (!runRegistry.register(sessionId, abortController)) {
      throw new ServiceError('Session is already running', 409);
    }

    console.log(`[Agent] run start session=${sessionId} input="${input.slice(0, 50)}"`);

    bus.publish({ workspace: this.workspace, sessionId, type: 'session-start' });
    this.activityTracker.start(sessionId);

    let result: ReturnType<typeof coreRunAgent>;
    try {
      result = coreRunAgent({
        input: { content: input, timestamp: new Date() },
        sessionId,
        signal: abortController.signal,
        pm: this.providerManager,
      });
    } catch (err) {
      runRegistry.remove(sessionId);
      throw err;
    }

    let accumulatedParts: NonNullable<unknown>[] = [];
    const sessionProvider = this.sessionProvider;
    const workspace = this.workspace;

    const self = this;

    const wrapped: AsyncIterable<AgentStreamChunk> = {
      [Symbol.asyncIterator]: async function* () {
        for await (const chunk of result.stream.fullStream) {
          yield chunk;

          console.log(`[Agent] chunk session=${sessionId} type=${chunk.type}`);

          self.activityTracker.applyChunk(sessionId, chunk);

          if (
            chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' ||
            chunk.type === 'tool-call' || chunk.type === 'tool-result' ||
            chunk.type === 'text-start' || chunk.type === 'reasoning-start' ||
            chunk.type === 'tool-call-start' || chunk.type === 'tool-result-start'
          ) {
            try {
              accumulatedParts = reduceStreamChunk(accumulatedParts as Parameters<typeof reduceStreamChunk>[0], chunk);
              const session = await sessionProvider.load(sessionId);
              if (session) {
                const lastMsg = session.conversation[session.conversation.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  lastMsg.content = accumulatedParts as typeof lastMsg.content;
                  await sessionProvider.save(session);
                }
              }
            } catch {
              // persistence is best-effort during streaming
            }
          }

          bus.publish({
            workspace,
            sessionId,
            type: 'chunk',
            chunk,
          });

          if (chunk.type === 'finish') {
            bus.publish({ workspace, sessionId, type: 'session-end' });
          }
          if (chunk.type === 'error') {
            bus.publish({
              workspace,
              sessionId,
              type: 'session-error',
              error: String(chunk.error),
            });
          }
        }
      },
    };

    result.output.catch(() => {}).finally(() => {
      runRegistry.remove(sessionId);
      self.activityTracker.finish(sessionId);
    });

    return wrapped;
  }

  async interrupt(sessionId: string): Promise<void> {
    runRegistry.abort(sessionId);
  }

  async reset(sessionId: string): Promise<void> {
    runRegistry.abort(sessionId);
    runRegistry.remove(sessionId);
  }

  /* ---- Message tracking ---- */

  async getMessages(sessionId: string): Promise<UIMessage[]> {
    return this.sessionManager.getMessages(sessionId);
  }

  async createSession(): Promise<SessionSummary> {
    return this.sessionManager.createSession();
  }

  async listSessions(): Promise<SessionSummary[]> {
    const list = await this.sessionManager.listSessions();
    return list.map((s) => ({
      ...s,
      activity: this.activityTracker.get(s.sessionId) ?? 'idle',
    }));
  }

  async updateSession(sessionId: string, updates: SessionUpdate): Promise<void> {
    return this.sessionManager.updateSession(sessionId, updates);
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.sessionManager.deleteSession(sessionId);
  }

  /* ---- Broadcast stream ---- */

  async *stream(): AsyncIterable<BusEvent> {
    let resolveNext: ((event: BusEvent) => void) | null = null;
    const queue: BusEvent[] = [];

    const unsub = bus.subscribe((event) => {
      if (event.workspace !== this.workspace) return;
      if (resolveNext) {
        resolveNext(event);
        resolveNext = null;
      } else {
        queue.push(event);
      }
    });

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          yield await new Promise<BusEvent>((r) => { resolveNext = r; });
        }
      }
    } finally {
      unsub();
    }
  }
}
