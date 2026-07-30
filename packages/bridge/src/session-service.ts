import type { AgentDI, Session, SessionInfo, SessionSummary, SessionUpdate, UIMessage, Usage } from 'rem-agent-core';
import { AgentSessionManager, AgentState, SessionNotFoundError, addUsage, emptyUsage, log, normalizeUsage, normalizeUsageDetail, type TokenUsageDetail } from 'rem-agent-core';
import type { REMAgentEvent } from 'rem-agent-core';

/**
 * 会话持久化唯一写入方。
 * 查询（getMessages/update）委托 core 的 AgentSessionManager；
 * 写路径全部来自 handleAgentEvent（REMAgent 产出的事件驱动）。
 */
export class SessionService {
  private readonly di: AgentDI;
  private readonly manager: AgentSessionManager;
  private readonly loaded = new Map<string, Session>();

  constructor(di: AgentDI) {
    this.di = di;
    // AgentSessionManager 仅在 deleteSession 用到 AgentState（我们不委托 delete），
    // 传一个隔离实例即可。
    this.manager = new AgentSessionManager(di.sessionProvider, new AgentState());
  }

  // ---- 加载/创建 ----

  async loadOrCreate(sessionId: string, workspace: string): Promise<Session> {
    const cached = this.loaded.get(sessionId);
    if (cached) return cached;
    let session = await this.di.sessionProvider.load(sessionId);
    if (!session) {
      session = {
        sessionId, conversation: [], currentTurn: 0,
        metadata: { schemaVersion: 2, workspace }, createdAt: new Date(), updatedAt: new Date(),
      };
      await this.di.sessionProvider.save(session);
    } else if (!session.metadata.workspace) {
      session.metadata.workspace = workspace;
      await this.di.sessionProvider.save(session);
    }
    this.loaded.set(sessionId, session);
    return session;
  }

  async createChildSession(params: { parentSessionId: string; parentToolCallId?: string; workspace: string; title: string }): Promise<Session> {
    const child = await this.di.sessionProvider.create();
    child.metadata.parentSessionId = params.parentSessionId;
    child.metadata.parentToolCallId = params.parentToolCallId;
    child.metadata.workspace = params.workspace;
    child.metadata.title = params.title;
    await this.di.sessionProvider.save(child);
    this.loaded.set(child.sessionId, child);
    return child;
  }

  // ---- 事件驱动写路径（best-effort：失败记日志不中断流）----

  async handleAgentEvent(sessionId: string, event: REMAgentEvent): Promise<void> {
    try {
      if (event.type === 'message-persist') {
        const session = await this.requireLoaded(sessionId);
        await this.di.sessionProvider.appendMessage(session, event.message, event.messageId);
      } else if (event.type === 'usage') {
        const session = await this.requireLoaded(sessionId);
        const history = ((session.metadata.tokenUsageHistory as unknown[]) ?? []).map((e) =>
          normalizeUsageDetail(e as TokenUsageDetail));
        history.push({ ...event.usage, runAt: new Date(), turns: [event.usage] });
        session.metadata.tokenUsageHistory = history;
        if (event.assistantMessageId) {
          const mtu: Record<string, Usage> = {};
          for (const [k, v] of Object.entries(session.metadata.messageTokenUsage ?? {})) {
            mtu[k] = normalizeUsage(v as Usage);
          }
          mtu[event.assistantMessageId] = event.usage;
          session.metadata.messageTokenUsage = mtu;
        }
        await this.di.sessionProvider.save(session);
      } else if (event.type === 'session-title') {
        const session = await this.requireLoaded(sessionId);
        session.metadata.title = event.title;
        await this.di.sessionProvider.save(session);
      } else if (event.type === 'compress-end') {
        const session = await this.requireLoaded(sessionId);
        const latest = await this.di.storage.archiveStore.getLatest(sessionId);
        session.metadata.compressionHistory = [
          ...((session.metadata.compressionHistory as unknown[]) ?? []),
          {
            archiveId: event.archiveId,
            version: latest?.version ?? 1,
            compressedAt: new Date().toISOString(),
            removedMessageCount: event.removedMessageCount,
          },
        ];
        await this.di.sessionProvider.save(session);
      } else if (event.type === 'finish') {
        const session = await this.requireLoaded(sessionId);
        session.currentTurn++;
        session.updatedAt = new Date();
        await this.di.sessionProvider.save(session);
      }
    } catch (error) {
      log('session-service', 'persist failed', { sessionId, eventType: event.type, error: String(error) });
    }
  }

  private async requireLoaded(sessionId: string): Promise<Session> {
    const cached = this.loaded.get(sessionId);
    if (cached) return cached;
    const session = await this.di.sessionProvider.load(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    this.loaded.set(sessionId, session);
    return session;
  }

  // ---- 查询（委托 / SQL 过滤）----

  async create(workspace: string): Promise<SessionInfo> {
    return this.manager.createSession(workspace);
  }

  async listByWorkspace(workspace: string): Promise<SessionInfo[]> {
    const summaries: SessionSummary[] = await this.di.storage.sessionStore.listByWorkspace(workspace);
    const enriched: Array<SessionInfo | null> = await Promise.all(
      summaries.map(async (s): Promise<SessionInfo | null> => {
        const session = await this.di.sessionProvider.load(s.sessionId);
        if (!session) return null;
        return {
          sessionId: s.sessionId,
          workspace,
          title: s.title ?? 'New Chat',
          pinned: s.pinned,
          parentSessionId: session.metadata?.parentSessionId as string | undefined,
          parentToolCallId: session.metadata?.parentToolCallId as string | undefined,
          updatedAt: s.updatedAt.getTime(),
          messageCount: s.messageCount,
          tokenUsage: this.computeTotalTokenUsage(session.metadata?.messageTokenUsage),
        };
      }),
    );
    const filtered = enriched.filter((s): s is SessionInfo => s !== null);
    return filtered.sort((a, b) => (a.pinned === b.pinned ? b.updatedAt - a.updatedAt : a.pinned ? -1 : 1));
  }

  async search(workspace: string, q: string): Promise<SessionInfo[]> {
    const all = await this.listByWorkspace(workspace);
    const lower = q.toLowerCase();
    return all.filter((s) => (s.title ?? '').toLowerCase().includes(lower));
  }

  async getMessages(sessionId: string): Promise<UIMessage[]> {
    return this.manager.getMessages(sessionId);
  }

  async update(sessionId: string, updates: SessionUpdate): Promise<void> {
    return this.manager.updateSession(sessionId, updates);
  }

  async delete(sessionId: string): Promise<void> {
    const session = await this.di.sessionProvider.load(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    await this.di.sessionProvider.delete(sessionId);
    this.loaded.delete(sessionId);
  }

  private computeTotalTokenUsage(messageTokenUsage: unknown): Usage | undefined {
    if (!messageTokenUsage || typeof messageTokenUsage !== 'object') return undefined;
    const entries = Object.values(messageTokenUsage).map((e) => normalizeUsage(e as Usage));
    if (entries.length === 0) return undefined;
    return entries.reduce((acc, u) => addUsage(acc, u), emptyUsage());
  }
}
