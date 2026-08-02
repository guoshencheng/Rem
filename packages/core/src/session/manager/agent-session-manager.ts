import type { Usage } from '@earendil-works/pi-ai';
import type { SessionProvider } from '../../sdk/session-provider.js';
import { addUsage, emptyUsage, normalizeUsage } from '../../agent/token-usage/index.js';
import type { SessionInfo } from './types.js';

/** 按 workspace 查询并汇总持久化 Session。 */
export class AgentSessionManager {
  constructor(
    private sessionProvider: SessionProvider,
  ) {}

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
          mode: session.metadata.mode === 'multi-agent' ? 'multi-agent' as const : 'single' as const,
          teamId: session.metadata.teamId as string | undefined,
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

  private computeTotalTokenUsage(messageTokenUsage: unknown): Usage | undefined {
    if (!messageTokenUsage || typeof messageTokenUsage !== 'object') return undefined;
    const entries = Object.values(messageTokenUsage).map((entry) => normalizeUsage(entry));
    if (entries.length === 0) return undefined;
    return entries.reduce((acc, usage) => addUsage(acc, usage), emptyUsage());
  }
}
