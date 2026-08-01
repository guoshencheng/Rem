import type { Usage } from '@earendil-works/pi-ai';
import type { REMAgentEvent } from '../agent/agent-event.js';
import { normalizeUsage, normalizeUsageDetail } from '../agent/token-usage/index.js';
import type { TokenUsageDetail } from '../agent/token-usage/index.js';
import type { AgentDI } from '../assembly/agent-di.js';
import type { Session } from './model.js';
import { AgentSessionManager } from './manager/agent-session-manager.js';
import { SessionNotFoundError } from './manager/errors.js';
import type { SessionInfo } from './manager/types.js';
import type { DelegationStatus } from '../delegation/types.js';
import { agentEventToMessagePayload } from './messages/event-payload.js';

/** Session 查询与 Agent 事件持久化的唯一业务写入方。 */
export class SessionUsecase {
  private readonly manager: AgentSessionManager;
  private readonly loaded = new Map<string, Session>();

  constructor(private readonly di: AgentDI) {
    this.manager = new AgentSessionManager(di.sessionProvider);
  }
  async create(workspace: string): Promise<SessionInfo> {
    const session = await this.di.sessionProvider.create();
    session.metadata.workspace = workspace;
    await this.di.sessionProvider.save(session);
    this.loaded.set(session.sessionId, session);
    return this.toInfo(session);
  }
  async get(sessionId: string): Promise<SessionInfo> {
    return this.toInfo(await this.requireSession(sessionId));
  }
  list(workspace: string): Promise<SessionInfo[]> {
    return this.manager.listSessions(workspace);
  }

  async createDelegationSession(input: {
    parentSessionId: string;
    parentToolCallId: string;
    workspace: string;
    task: string;
    depth: number;
  }): Promise<Session> {
    const session = await this.di.sessionProvider.create();
    Object.assign(session.metadata, {
      type: 'delegation',
      parentSessionId: input.parentSessionId,
      parentToolCallId: input.parentToolCallId,
      delegationStatus: 'running',
      delegationDepth: input.depth,
      workspace: input.workspace,
      title: input.task.trim().slice(0, 50),
    });
    await this.di.sessionProvider.save(session);
    this.loaded.set(session.sessionId, session);
    return session;
  }

  async setDelegationStatus(sessionId: string, status: DelegationStatus): Promise<void> {
    const session = await this.requireSession(sessionId);
    session.metadata.delegationStatus = status;
    session.updatedAt = new Date();
    await this.di.sessionProvider.save(session);
  }

  async recoverInterruptedDelegations(): Promise<number> {
    const summaries = await this.di.sessionProvider.list();
    let recovered = 0;
    for (const summary of summaries) {
      const session = await this.requireSession(summary.sessionId);
      if (session.metadata.type !== 'delegation' || session.metadata.delegationStatus !== 'running') continue;
      await this.setDelegationStatus(session.sessionId, 'interrupted');
      recovered += 1;
    }
    return recovered;
  }

  async requireSession(sessionId: string): Promise<Session> {
    const cached = this.loaded.get(sessionId);
    if (cached) return cached;
    const session = await this.di.sessionProvider.load(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    this.loaded.set(sessionId, session);
    return session;
  }

  async persistAgentEvent(
    sessionId: string,
    agentThreadId: string,
    event: REMAgentEvent,
  ): Promise<void> {
    if (event.type === 'message-persist') {
      const session = await this.requireSession(sessionId);
      await this.di.sessionProvider.appendMessage(
        session,
        agentEventToMessagePayload(event, agentThreadId),
      );
    } else if (event.type === 'usage') {
      await this.persistUsage(sessionId, event.usage, event.assistantMessageId);
    } else if (event.type === 'session-title') {
      const session = await this.requireSession(sessionId);
      session.metadata.title = event.title;
      await this.di.sessionProvider.save(session);
    } else if (event.type === 'compress-end') {
      await this.persistCompression(sessionId, event);
    } else if (event.type === 'finish') {
      const session = await this.requireSession(sessionId);
      session.currentTurn += 1;
      session.updatedAt = new Date();
      await this.di.sessionProvider.save(session);
    }
  }

  private async persistUsage(sessionId: string, usage: Usage, messageId?: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    const history = ((session.metadata.tokenUsageHistory as unknown[]) ?? [])
      .map((item) => normalizeUsageDetail(item));
    history.push({ ...usage, runAt: new Date(), turns: [usage] } satisfies TokenUsageDetail);
    session.metadata.tokenUsageHistory = history;
    if (messageId) {
      const byMessage = Object.fromEntries(Object.entries(
        (session.metadata.messageTokenUsage as Record<string, unknown> | undefined) ?? {},
      ).map(([id, item]) => [id, normalizeUsage(item)]));
      byMessage[messageId] = usage;
      session.metadata.messageTokenUsage = byMessage;
    }
    await this.di.sessionProvider.save(session);
  }

  private async persistCompression(
    sessionId: string,
    event: Extract<REMAgentEvent, { type: 'compress-end' }>,
  ): Promise<void> {
    const session = await this.requireSession(sessionId);
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
  }

  private toInfo(session: Session): SessionInfo {
    return {
      sessionId: session.sessionId,
      workspace: (session.metadata.workspace as string | undefined) ?? 'default',
      title: (session.metadata.title as string | undefined) ?? 'New Chat',
      pinned: session.metadata.pinned as boolean | undefined,
      updatedAt: session.updatedAt.getTime(),
      messageCount: session.conversation.length,
      parentSessionId: session.metadata.parentSessionId as string | undefined,
      parentToolCallId: session.metadata.parentToolCallId as string | undefined,
    };
  }
}
