import type { AgentProfileService } from '../agent-profile/service.js';
import type { AgentThread } from './agent-thread/model.js';
import type { AgentThreadService } from './agent-thread/service.js';
import type { SessionProvider } from '../sdk/session-provider.js';
import type { Session } from './model.js';
import { projectThreadContext } from './messages/thread-context-projector.js';

export interface SessionAgentContextServiceDeps {
  sessionProvider: SessionProvider;
  profileService: AgentProfileService;
  threadService: AgentThreadService;
}

/** 从中心消息与持久化身份构建一次 Agent 初始化所需的 Session 视图。 */
export class SessionAgentContextService {
  constructor(private readonly deps: SessionAgentContextServiceDeps) {}

  async projectSession(session: Session, target: AgentThread): Promise<Session> {
    const [entries, leafId, threads, profiles] = await Promise.all([
      this.deps.sessionProvider.listEntries(session.sessionId),
      this.deps.sessionProvider.getActiveLeafId(session.sessionId),
      this.deps.threadService.listBySession(session.sessionId),
      this.deps.profileService.list(),
    ]);
    return {
      ...session,
      conversation: projectThreadContext({ entries, leafId, target, threads, profiles }),
      metadata: { ...session.metadata },
    };
  }
}
