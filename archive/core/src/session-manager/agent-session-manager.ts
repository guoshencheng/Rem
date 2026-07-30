import type { Usage } from '@earendil-works/pi-ai';
import type { TextContent } from '@earendil-works/pi-ai';
import type { SessionProvider } from '../sdk/session-provider.js';
import { AgentState } from '../agent-state.js';
import { addUsage, emptyUsage, normalizeUsage } from '../token-usage.js';
import type { SessionInfo, SessionUpdate, UIMessage, ToolResultBlock } from './types.js';
import { SessionNotFoundError } from './errors.js';
import { messageToContentBlocks } from './message-blocks.js';

/** 会话管理的通用内置逻辑：创建/列表/检索/更新/删除 + UIMessage 组装。 */
export class AgentSessionManager {
  constructor(
    private sessionProvider: SessionProvider,
    private agentState: AgentState,
  ) {}

  async createSession(workspace: string): Promise<SessionInfo> {
    const session = await this.sessionProvider.create();
    session.metadata.workspace = workspace;
    await this.sessionProvider.save(session);
    return this.toInfo(session, workspace);
  }

  async listSessions(workspace: string): Promise<SessionInfo[]> {
    const summaries = await this.sessionProvider.list();
    const enriched = await Promise.all(
      summaries.map(async (s) => {
        const session = await this.sessionProvider.load(s.sessionId);
        if (!session) return null;
        const sessionWorkspace = (session.metadata?.workspace as string | undefined) ?? 'default';
        if (sessionWorkspace !== workspace) return null;
        const tokenUsage = this.computeTotalTokenUsage(session.metadata?.messageTokenUsage);
        return {
          sessionId: s.sessionId,
          workspace: sessionWorkspace,
          title: s.title ?? 'New Chat',
          pinned: s.pinned,
          parentSessionId: (session.metadata?.parentSessionId as string | undefined),
          parentToolCallId: (session.metadata?.parentToolCallId as string | undefined),
          updatedAt: s.updatedAt.getTime(),
          messageCount: s.messageCount,
          tokenUsage,
        };
      }),
    );
    const filtered = enriched.filter((s): s is NonNullable<typeof s> => s !== null);
    return filtered.sort((a, b) => {
      if (a.pinned === b.pinned) {
        return b.updatedAt - a.updatedAt;
      }
      return a.pinned ? -1 : 1;
    });
  }

  async searchSessions(workspace: string, q: string): Promise<SessionInfo[]> {
    const all = await this.listSessions(workspace);
    const lower = q.toLowerCase();
    return all.filter((s) => (s.title ?? '').toLowerCase().includes(lower));
  }

  async getMessages(sessionId: string): Promise<UIMessage[]> {
    const session = await this.sessionProvider.load(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    const toolResultsMap = new Map<string, ToolResultBlock>();
    for (const msg of session.conversation) {
      if (msg.role !== 'toolResult') continue;
      const content = typeof msg.content === 'string' ? [] : msg.content;
      const output = content
        .filter((c): c is TextContent => c.type === 'text')
        .map((c) => c.text)
        .join('');
      toolResultsMap.set(msg.toolCallId, {
        type: 'toolResult',
        toolCallId: msg.toolCallId,
        toolName: msg.toolName,
        output,
        error: msg.isError ? 'error' : undefined,
      });
    }

    const messageTokenUsage = (session.metadata?.messageTokenUsage ?? {}) as Record<string, Usage>;

    const uiMessages: UIMessage[] = [];
    for (let i = 0; i < session.conversation.length; i++) {
      const msg = session.conversation[i];
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;

      const messageId = String((msg as any).id ?? i);
      const parts = messageToContentBlocks(msg);
      const messageToolResults: Record<string, ToolResultBlock> = {};
      for (const part of parts) {
        if (part.type === 'toolCall') {
          const result = toolResultsMap.get(part.id);
          if (result) {
            messageToolResults[part.id] = result;
          }
        }
      }
      uiMessages.push({
        id: messageId,
        role: msg.role as 'user' | 'assistant',
        parts,
        status: 'done' as const,
        tokenUsage: normalizeUsage(messageTokenUsage[messageId]),
        toolResults: Object.keys(messageToolResults).length > 0 ? messageToolResults : undefined,
      });
    }
    return uiMessages;
  }

  async updateSession(sessionId: string, updates: SessionUpdate): Promise<void> {
    const session = await this.sessionProvider.load(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
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
      throw new SessionNotFoundError(sessionId);
    }
    this.agentState.abortRun(sessionId);
    this.agentState.removeRun(sessionId);
    await this.sessionProvider.delete(sessionId);
    // 删除后清理内存中的 live state，避免后续 stream 重连时把已删除会话的
    // snapshot 推给前端。
    this.agentState.remove(sessionId);
  }

  private computeTotalTokenUsage(messageTokenUsage: unknown): Usage | undefined {
    if (!messageTokenUsage || typeof messageTokenUsage !== 'object') return undefined;
    const entries = Object.values(messageTokenUsage).map((entry) => normalizeUsage(entry));
    if (entries.length === 0) return undefined;
    return entries.reduce((acc, usage) => addUsage(acc, usage), emptyUsage());
  }

  private toInfo(
    session: { sessionId: string; metadata?: Record<string, unknown>; updatedAt: Date; conversation?: unknown[] },
    workspace?: string,
  ): SessionInfo {
    return {
      sessionId: session.sessionId,
      workspace: workspace ?? (session.metadata?.workspace as string | undefined) ?? 'default',
      title: (session.metadata?.title as string | undefined) ?? 'New Chat',
      pinned: session.metadata?.pinned as boolean | undefined,
      parentSessionId: (session.metadata?.parentSessionId as string | undefined),
      updatedAt: session.updatedAt.getTime(),
      messageCount: Array.isArray(session.conversation) ? session.conversation.length : 0,
    };
  }
}
