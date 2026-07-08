import type { SessionProvider, ContentPart, AgentState, LanguageModelUsage } from 'rem-agent-core';
import { addUsage, emptyUsage } from 'rem-agent-core/token-usage';
import type { SessionSummary, SessionUpdate, UIMessage } from './types.js';
import { ServiceError } from './errors.js';

export class AgentSessionManager {
  constructor(
    private sessionProvider: SessionProvider,
    private agentState: AgentState,
  ) {}

  async createSession(): Promise<SessionSummary> {
    const session = await this.sessionProvider.create();
    return this.toSummary(session);
  }

  async listSessions(): Promise<SessionSummary[]> {
    const summaries = await this.sessionProvider.list();
    const enriched = await Promise.all(
      summaries.map(async (s) => {
        const session = await this.sessionProvider.load(s.sessionId);
        const tokenUsage = this.computeTotalTokenUsage(session?.metadata?.messageTokenUsage);
        return {
          sessionId: s.sessionId,
          title: s.title ?? 'New Chat',
          pinned: s.pinned,
          updatedAt: s.updatedAt.getTime(),
          messageCount: s.messageCount,
          tokenUsage,
        };
      }),
    );
    return enriched.sort((a, b) => {
      if (a.pinned === b.pinned) {
        return b.updatedAt - a.updatedAt;
      }
      return a.pinned ? -1 : 1;
    });
  }

  private computeTotalTokenUsage(messageTokenUsage: unknown): LanguageModelUsage | undefined {
    if (!messageTokenUsage || typeof messageTokenUsage !== 'object') return undefined;
    const entries = Object.values(messageTokenUsage) as LanguageModelUsage[];
    if (entries.length === 0) return undefined;
    return entries.reduce((acc, usage) => addUsage(acc, usage), emptyUsage());
  }

  async getMessages(sessionId: string): Promise<UIMessage[]> {
    const session = await this.sessionProvider.load(sessionId);
    if (!session) {
      throw new ServiceError('Session not found', 404);
    }

    const toolResults = new Map<string, ContentPart>();
    for (const msg of session.conversation) {
      if (msg.role !== 'tool') continue;
      for (const part of msg.content ?? []) {
        if (part.type === 'tool-result') {
          toolResults.set(part.toolCallId, part);
        }
      }
    }

    const messageTokenUsage = (session.metadata?.messageTokenUsage ?? {}) as Record<string, LanguageModelUsage>;

    return session.conversation
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => {
        const parts = (msg.content ?? []) as ContentPart[];
        const mergedParts: ContentPart[] = [];
        for (const part of parts) {
          mergedParts.push(part);
          if (part.type === 'tool-call') {
            const result = toolResults.get(part.toolCallId);
            if (result) {
              mergedParts.push(result);
            }
          }
        }
        return {
          id: msg.id,
          role: msg.role as 'user' | 'assistant',
          parts: mergedParts,
          status: 'done' as const,
          tokenUsage: messageTokenUsage[msg.id],
        };
      });
  }

  async updateSession(sessionId: string, updates: SessionUpdate): Promise<void> {
    const session = await this.sessionProvider.load(sessionId);
    if (!session) {
      throw new ServiceError('Session not found', 404);
    }
    if (updates.title !== undefined) {
      session.metadata.title = updates.title;
    }
    if (updates.pinned !== undefined) {
      session.metadata.pinned = updates.pinned;
    }
    session.updatedAt = new Date();
    await this.sessionProvider.save(session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.sessionProvider.load(sessionId);
    if (!session) {
      throw new ServiceError('Session not found', 404);
    }
    this.agentState.abortRun(sessionId);
    this.agentState.removeRun(sessionId);
    await this.sessionProvider.delete(sessionId);
    // 删除后清理内存中的 live state，避免后续 stream 重连时把已删除会话的
    // snapshot 推给前端。
    this.agentState.remove(sessionId);
  }

  private toSummary(session: { sessionId: string; metadata?: Record<string, unknown>; updatedAt: Date; conversation?: unknown[] }): SessionSummary {
    return {
      sessionId: session.sessionId,
      title: (session.metadata?.title as string | undefined) ?? 'New Chat',
      pinned: session.metadata?.pinned as boolean | undefined,
      updatedAt: session.updatedAt.getTime(),
      messageCount: Array.isArray(session.conversation) ? session.conversation.length : 0,
    };
  }
}
