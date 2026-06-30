import type { AgentStreamChunk, AgentStream } from 'rem-agent-core';
import { runAgent as coreRunAgent } from 'rem-agent-core';
import type { ServerMessage, ContentPart, AgentOutput } from 'rem-agent-core';
import type { ProviderManager } from 'rem-agent-core';
import type { SessionProvider } from 'rem-agent-core';
import { ServiceError } from './errors.js';
import type { IAgentService } from './agent-service.interface.js';
import type { SessionSummary } from './types.js';
import { tapFullStream } from './stream-tap.js';
import { buildPartsFromContent } from './content-builder.js';

export type { ServerMessage } from 'rem-agent-core';

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

  constructor(private providerManager: ProviderManager) {
    this.sessionProvider = providerManager.require<SessionProvider>('session');
  }

  /* ---- Agent lifecycle ---- */

  async run(sessionId: string, input: string): Promise<AsyncIterable<AgentStreamChunk>> {
    if (this.activeRuns.has(sessionId)) {
      throw new ServiceError('Session is already running', 409);
    }

    const abortController = new AbortController();
    const result = coreRunAgent({
      input: { content: input, timestamp: new Date() },
      sessionId,
      signal: abortController.signal,
      pm: this.providerManager,
    });
    this.activeRuns.set(sessionId, abortController);

    const tapped = tapFullStream(result.stream.fullStream, sessionId);

    result.output.catch(() => {}).finally(() => {
      this.activeRuns.delete(sessionId);
    });

    return tapped;
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

  async getMessages(sessionId: string): Promise<ServerMessage[]> {
    const session = await this.sessionProvider.load(sessionId);
    if (!session) return [];

    return session.conversation
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => {
        const parts = buildPartsFromContent(msg.content);
        return {
          id: crypto.randomUUID(),
          role: msg.role as 'user' | 'assistant',
          content: parts.filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text').map((p) => p.text).join(''),
          reasoning: parts.filter((p): p is Extract<ContentPart, { type: 'reasoning' }> => p.type === 'reasoning').map((p) => p.text).join(''),
          toolCalls: parts
            .filter((p): p is Extract<ContentPart, { type: 'tool-call' }> => p.type === 'tool-call')
            .map((p) => ({ id: p.toolCallId, name: p.toolName, arguments: p.arguments, result: p.result })),
          parts,
          status: 'done' as const,
        };
      });
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
}
