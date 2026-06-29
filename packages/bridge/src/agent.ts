import type { AgentStreamChunk, RunAgentResult } from 'rem-agent-core';
import { runAgent as coreRunAgent } from 'rem-agent-core';
import type { ServerMessage, ContentPart } from 'rem-agent-core';
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

function buildPartsFromContent(content: unknown): ContentPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content } as ContentPart];
  }
  if (!Array.isArray(content)) return [];
  return content.map((item: Record<string, unknown>) => {
    if (item.type === 'text') return { type: 'text', text: String(item.text ?? '') } as ContentPart;
    if (item.type === 'reasoning') return { type: 'reasoning', text: String(item.text ?? '') } as ContentPart;
    if (item.type === 'tool-call') return {
      type: 'tool-call',
      toolCallId: String(item.toolCallId ?? ''),
      toolName: String(item.toolName ?? ''),
      arguments: (item.input as Record<string, unknown>) ?? {},
      result: item.result ? {
        success: Boolean((item.result as Record<string, unknown>).success),
        output: String((item.result as Record<string, unknown>).output ?? ''),
        error: (item.result as Record<string, unknown>).error as string | undefined,
        durationMs: Number((item.result as Record<string, unknown>).durationMs ?? 0),
      } : undefined,
    } as ContentPart;
    return { type: 'text', text: '' } as ContentPart;
  });
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
  });

    return { sessionId: params.sessionId };
  }

  private tapFullStream(
    source: AsyncIterable<AgentStreamChunk>,
    sessionId: string,
  ): AsyncIterable<AgentStreamChunk> {
    const parts: ContentPart[] = [];

    const applyChunk = (chunk: AgentStreamChunk) => {
      switch (chunk.type) {
        case 'text-start': {
          parts.push({ type: 'text', text: '' });
          break;
        }
        case 'text-delta': {
          const last = parts[parts.length - 1];
          if (last?.type === 'text') last.text += chunk.text;
          break;
        }
        case 'reasoning-start': {
          parts.push({ type: 'reasoning', text: '' });
          break;
        }
        case 'reasoning-delta': {
          const last = parts[parts.length - 1];
          if (last?.type === 'reasoning') last.text += chunk.text;
          break;
        }
        case 'tool-call-start': {
          parts.push({
            type: 'tool-call',
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            arguments: {},
          });
          break;
        }
        case 'tool-call': {
          const part = parts.find((p): p is ContentPart & { type: 'tool-call' } =>
            p.type === 'tool-call' && p.toolCallId === chunk.toolCallId,
          );
          if (part) part.arguments = (chunk.input as Record<string, unknown>) ?? {};
          break;
        }
        case 'tool-result': {
          const part = parts.find((p): p is ContentPart & { type: 'tool-call' } =>
            p.type === 'tool-call' && p.toolCallId === chunk.toolCallId,
          );
          if (part) {
            part.result = {
              success: !chunk.error,
              output: chunk.output ?? '',
              error: chunk.error,
              durationMs: 0,
            };
          }
          break;
        }
        case 'finish': {
          const id = crypto.randomUUID();
          const msg: ServerMessage = {
            id,
            role: 'assistant',
            content: parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join(''),
            reasoning: parts.filter((p) => p.type === 'reasoning').map((p) => (p as { text: string }).text).join(''),
            toolCalls: parts
              .filter((p) => p.type === 'tool-call')
              .map((p) => ({
                id: p.toolCallId,
                name: p.toolName,
                arguments: p.arguments,
                result: p.result,
              })),
            parts,
            status: 'done',
          };
          const existing = this.msgCache.get(sessionId) ?? [];
          this.msgCache.set(sessionId, [...existing, msg]);
          break;
        }
        case 'error': {
          const id = crypto.randomUUID();
          const msg: ServerMessage = {
            id,
            role: 'assistant',
            content: '',
            toolCalls: [],
            parts,
            status: 'error',
            error: String(chunk.error),
          };
          const existing = this.msgCache.get(sessionId) ?? [];
          this.msgCache.set(sessionId, [...existing, msg]);
          break;
        }
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
        parts: [{ type: 'text', text: content } as ContentPart],
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

  async listSessions(): Promise<{ sessionId: string; title: string; messageCount: number }[]> {
    const summaries = await this.sessionProvider.list();
    return summaries.map((s) => ({
      sessionId: s.sessionId,
      title: s.title ?? 'New Chat',
      messageCount: s.messageCount,
    }));
  }
}
