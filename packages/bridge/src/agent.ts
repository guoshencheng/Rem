import type { AgentStreamChunk, RunAgentResult } from 'rem-agent-core';
import { runAgent as coreRunAgent } from 'rem-agent-core';
import type { ServerMessage } from 'rem-agent-core';
import type { ProviderManager } from 'rem-agent-core';
import type { SessionProvider } from 'rem-agent-core';
import { ServiceError } from './errors.js';

export type { ServerMessage } from 'rem-agent-core';

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
  private sessionProvider: SessionProvider;
  private msgCache = new Map<string, ServerMessage[]>();

  constructor(private providerManager: ProviderManager) {
    this.sessionProvider = providerManager.require<SessionProvider>('session');
  }

  /* ---- Agent lifecycle ---- */

  async run(params: RunParams): Promise<RunResult> {
    if (this.activeRuns.has(params.sessionId)) {
      throw new ServiceError('Session is already running', 409);
    }

    const abortController = new AbortController();
    this.activeRuns.set(params.sessionId, abortController);

    const result = coreRunAgent({
      input: { content: params.content, timestamp: new Date() },
      sessionId: params.sessionId,
      signal: abortController.signal,
      pm: this.providerManager,
    });

    const tapped = this.tapFullStream(result.stream.fullStream, params.sessionId);
    const tappedStream = { ...result.stream, fullStream: tapped };

    this.activeStreams.set(params.sessionId, {
      stream: tappedStream,
      output: result.output,
    });

    result.output.finally(() => {
      this.activeRuns.delete(params.sessionId);
      this.activeStreams.delete(params.sessionId);
    });

    return { sessionId: params.sessionId };
  }

  private tapFullStream(
    source: AsyncIterable<AgentStreamChunk>,
    sessionId: string,
  ): AsyncIterable<AgentStreamChunk> {
    type TC = { id: string; name: string; arguments: Record<string, unknown>; result?: { success: boolean; output?: string; error?: string; durationMs: number } };
    const assistantMsgId = crypto.randomUUID();
    const assistant: ServerMessage = { id: assistantMsgId, role: 'assistant', content: '', toolCalls: [], status: 'pending' };

    const applyChunk = (chunk: AgentStreamChunk) => {
      if (chunk.type === 'text-delta') {
        assistant.content += chunk.text;
        assistant.status = 'streaming';
      } else if (chunk.type === 'reasoning-delta') {
        assistant.reasoning = (assistant.reasoning ?? '') + chunk.text;
        assistant.status = 'streaming';
      } else if (chunk.type === 'tool-call-start') {
        assistant.toolCalls.push({ id: chunk.toolCallId, name: chunk.toolName, arguments: {} });
        assistant.status = 'streaming';
      } else if (chunk.type === 'tool-call') {
        const tc = assistant.toolCalls.find((t: TC) => t.id === chunk.toolCallId) as TC | undefined;
        if (tc) tc.arguments = (chunk.input as Record<string, unknown>) ?? {};
      } else if (chunk.type === 'tool-result') {
        const tc = assistant.toolCalls.find((t: TC) => t.id === chunk.toolCallId) as TC | undefined;
        if (tc) { tc.result = { success: !chunk.error, output: chunk.output, error: chunk.error, durationMs: 0 }; }
      } else if (chunk.type === 'finish') {
        assistant.status = 'done';
        const existing = this.msgCache.get(sessionId) ?? [];
        this.msgCache.set(sessionId, [...existing, assistant]);
      } else if (chunk.type === 'error') {
        assistant.status = 'error';
        assistant.error = String(chunk.error);
        const existing = this.msgCache.get(sessionId) ?? [];
        this.msgCache.set(sessionId, [...existing, assistant]);
      }
    };

    return {
      [Symbol.asyncIterator]() {
        const it = source[Symbol.asyncIterator]();
        return {
          async next() {
            const r = await it.next();
            if (r.value) applyChunk(r.value);
            return r;
          }
        };
      }
    };
  }

  interrupt(sessionId: string): InterruptResult {
    const controller = this.activeRuns.get(sessionId);
    if (controller) {
      controller.abort();
    }
    return { sessionId, interrupted: !!controller };
  }

  getStream(sessionId: string): RunAgentResult | undefined {
    return this.activeStreams.get(sessionId);
  }

  async reset(sessionId: string): Promise<ResetResult> {
    const controller = this.activeRuns.get(sessionId);
    if (controller) controller.abort();
    this.activeRuns.delete(sessionId);
    this.activeStreams.delete(sessionId);
    return { sessionId, reset: true };
  }

  /* ---- Message tracking ---- */

  addUserMessage(sessionId: string, content: string): void {
    this.msgCache.set(sessionId, [
      {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        toolCalls: [],
        status: 'done',
      },
    ]);
  }

  async getMessages(sessionId: string): Promise<ServerMessage[]> {
    const cached = this.msgCache.get(sessionId);
    if (cached) return cached;

    const session = await this.sessionProvider.load(sessionId);
    if (!session) return [];

    return session.conversation
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        id: crypto.randomUUID(),
        role: msg.role as 'user' | 'assistant',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        toolCalls: [],
        status: 'done' as const,
      }));
  }

  async listSessions(): Promise<{ sessionId: string; title: string; messageCount: number }[]> {
    const summaries = await this.sessionProvider.list();
    return summaries.map((s) => ({
      sessionId: s.sessionId,
      title: s.title ?? 'New Chat',
      messageCount: s.messageCount,
    }));
  }
}
