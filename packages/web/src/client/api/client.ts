import type {
  AgentThread, Message, SessionChatMessage, SessionInfo, TeamInfo,
} from 'rem-agent-core';

const BASE = '/api/rem';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* 非 JSON 错误响应 */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function post(body?: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  };
}

export const api = {
  listSessions: () => request<SessionInfo[]>('/sessions'),
  createSession: (teamId?: string) =>
    request<SessionInfo>('/sessions', post(teamId ? { teamId } : {})),
  getChat: (sessionId: string) =>
    request<SessionChatMessage[]>(`/sessions/${sessionId}/chat`),
  getThreads: (sessionId: string) =>
    request<AgentThread[]>(`/sessions/${sessionId}/threads`),
  getThreadMessages: (sessionId: string, threadId: string) =>
    request<Message[]>(`/sessions/${sessionId}/threads/${threadId}/messages`),
  sendMessage: (sessionId: string, content: string) =>
    request<void>(`/sessions/${sessionId}/send`, post({ content })),
  interrupt: (sessionId: string) => request<void>(`/sessions/${sessionId}/interrupt`, post()),
  listTeams: () => request<TeamInfo[]>('/teams'),
};
