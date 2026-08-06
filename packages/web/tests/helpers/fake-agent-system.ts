import type {
  AgentSystem, AgentSystemEvent, AgentThread, SessionChatMessage, SessionInfo, TeamInfo, Message,
} from 'rem-agent-core';

export interface FakeAgentSystemOptions {
  sessions?: SessionInfo[];
  teams?: TeamInfo[];
  chat?: SessionChatMessage[];
  threads?: AgentThread[];
  threadMessages?: Message[];
  events?: AgentSystemEvent[];
  failOn?: Record<string, Error>;
}

export function createFakeAgentSystem(options: FakeAgentSystemOptions = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record = (method: string, args: unknown[]) => {
    calls.push({ method, args });
    const err = options.failOn?.[method];
    if (err) throw err;
  };
  const system: AgentSystem = {
    async createSession(input) {
      record('createSession', [input]);
      const info: SessionInfo = {
        sessionId: 's-new', workspace: input.workspace, updatedAt: Date.now(),
        messageCount: 0, mode: input.teamId ? 'multi-agent' : 'single', teamId: input.teamId,
      };
      return info;
    },
    async getSession(sessionId) {
      record('getSession', [sessionId]);
      const found = options.sessions?.find((s) => s.sessionId === sessionId);
      if (!found) throw new Error(`Session not found: ${sessionId}`);
      return found;
    },
    async listSessions(workspace) {
      record('listSessions', [workspace]);
      return options.sessions ?? [];
    },
    async getSessionThreads(sessionId) {
      record('getSessionThreads', [sessionId]);
      return options.threads ?? [];
    },
    async getSessionChat(sessionId) {
      record('getSessionChat', [sessionId]);
      return options.chat ?? [];
    },
    async getAgentThreadContext(sessionId, agentThreadId) {
      record('getAgentThreadContext', [sessionId, agentThreadId]);
      return options.threadMessages ?? [];
    },
    async send(input) {
      record('send', [input]);
    },
    async interrupt(sessionId) {
      record('interrupt', [sessionId]);
    },
    async listTeams() {
      record('listTeams', []);
      return options.teams ?? [];
    },
    async *events(signal?) {
      record('events', [signal]);
      for (const event of options.events ?? []) {
        if (signal?.aborted) return;
        yield event;
      }
    },
  };
  return { system, calls };
}
