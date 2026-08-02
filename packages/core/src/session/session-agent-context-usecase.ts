import type { ConfigProvider } from '../sdk/config-provider.js';
import type { AgentThread } from './agent-thread/model.js';
import type { AgentThreadUsecase } from './agent-thread/agent-thread-usecase.js';
import type { SessionProvider } from '../sdk/session-provider.js';
import type { Session } from './model.js';
import { projectThreadContext } from './messages/thread-context-projector.js';

export interface SessionAgentContextUsecaseDeps {
  sessionProvider: SessionProvider;
  configProvider: ConfigProvider;
  threadUsecase: AgentThreadUsecase;
}

/** 从中心消息与持久化身份构建一次 Agent 初始化所需的 Session 视图。 */
export class SessionAgentContextUsecase {
  constructor(private readonly deps: SessionAgentContextUsecaseDeps) {}

  async projectSession(session: Session, target: AgentThread): Promise<Session> {
    const [entries, leafId, threads] = await Promise.all([
      this.deps.sessionProvider.listEntries(session.sessionId),
      this.deps.sessionProvider.getActiveLeafId(session.sessionId),
      this.deps.threadUsecase.listBySession(session.sessionId),
    ]);
    const workspace = (session.metadata.workspace as string | undefined) ?? 'default';
    const config = this.deps.configProvider.forWorkspace?.(workspace) ?? this.deps.configProvider;
    const agents = [...new Set(threads.map((thread) => thread.agentId))]
      .map((agentId) => config.resolveAgent(agentId));
    return {
      ...session,
      conversation: projectThreadContext({ entries, leafId, target, threads, agents }),
      metadata: { ...session.metadata },
    };
  }
}
