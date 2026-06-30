import type { AgentStreamChunk, AgentStream } from 'rem-agent-core';
import { runAgent as coreRunAgent } from 'rem-agent-core';
import type { AgentOutput } from 'rem-agent-core';
import type { ProviderManager } from 'rem-agent-core';
import type { SessionProvider } from 'rem-agent-core';
import { reduceStreamChunk } from './stream-reducer.js';
import { ServiceError } from './errors.js';
import { bus } from './broadcast-bus.js';
import type { BusEvent } from './types.js';
import type { IAgentService } from './agent-service.interface.js';
import type { SessionSummary, UIMessage } from './types.js';

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
  private activeRuns = new Map<string, AbortController>();
  private sessionProvider: SessionProvider;
  private workspace: string;

  constructor(private providerManager: ProviderManager, workspace = 'default') {
    this.sessionProvider = providerManager.require<SessionProvider>('session');
    this.workspace = workspace;
  }

  /* ---- Agent lifecycle ---- */

  async run(sessionId: string, input: string): Promise<AsyncIterable<AgentStreamChunk>> {
    if (this.activeRuns.has(sessionId)) {
      throw new ServiceError('Session is already running', 409);
    }

    bus.publish({ workspace: this.workspace, sessionId, type: 'session-start' });

    const abortController = new AbortController();
    const result = coreRunAgent({
      input: { content: input, timestamp: new Date() },
      sessionId,
      signal: abortController.signal,
      pm: this.providerManager,
    });
    this.activeRuns.set(sessionId, abortController);

    let accumulatedParts: NonNullable<unknown>[] = [];
    const sessionProvider = this.sessionProvider;
    const workspace = this.workspace;

    const wrapped: AsyncIterable<AgentStreamChunk> = {
      [Symbol.asyncIterator]: async function* () {
        for await (const chunk of result.stream.fullStream) {
          yield chunk;

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
      this.activeRuns.delete(sessionId);
    });

    return wrapped;
  }

  async interrupt(sessionId: string): Promise<void> {
    const controller = this.activeRuns.get(sessionId);
    if (controller) {
      controller.abort();
    }
  }

  async reset(sessionId: string): Promise<void> {
    const controller = this.activeRuns.get(sessionId);
    if (controller) controller.abort();
    this.activeRuns.delete(sessionId);
  }

  /* ---- Message tracking ---- */

  async getMessages(sessionId: string): Promise<UIMessage[]> {
    const session = await this.sessionProvider.load(sessionId);
    if (!session) return [];

    return session.conversation
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        parts: msg.content,
        status: 'done' as const,
      }));
  }

  async listSessions(): Promise<SessionSummary[]> {
    const summaries = await this.sessionProvider.list();
    return summaries.map((s) => ({
      sessionId: s.sessionId,
      title: s.title ?? 'New Chat',
      updatedAt: Date.now(),
      messageCount: s.messageCount,
    }));
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
