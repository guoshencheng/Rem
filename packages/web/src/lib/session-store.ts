'use client';

import { create } from 'zustand';
import type { SessionSummary, UIMessage, AgentStreamChunk, ContentPart } from './types';
import { reduceStreamChunk, type StreamPart } from 'rem-agent-bridge/client';

async function listSessions(q?: string): Promise<SessionSummary[]> {
  const params = q ? `?q=${encodeURIComponent(q)}` : '';
  const res = await fetch(`/api/sessions${params}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to list sessions: ${res.status} ${text}`);
  }
  return res.json() as Promise<SessionSummary[]>;
}

async function createSessionApi(): Promise<SessionSummary> {
  const res = await fetch('/api/sessions', { method: 'POST' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to create session: ${res.status} ${text}`);
  }
  return res.json() as Promise<SessionSummary>;
}

async function getSession(id: string): Promise<{ sessionId: string; title?: string; messages: unknown[] }> {
  const res = await fetch(`/api/sessions/${id}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to get session: ${res.status} ${text}`);
  }
  return res.json();
}

async function updateSession(id: string, updates: { title?: string; pinned?: boolean }): Promise<void> {
  const res = await fetch(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to update session: ${res.status} ${text}`);
  }
}

async function deleteSessionById(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to delete session: ${res.status} ${text}`);
  }
}

async function interruptAgent(id: string): Promise<void> {
  await fetch('/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: id, interrupt: true }),
  });
}

let assistantMessageId = '';

export const useSessionStore = create<{
  sessions: SessionSummary[];
  currentSessionId: string | null;
  searchQuery: string;
  messages: UIMessage[];
  streaming: boolean;
  pendingContent: string | null;
  streamParts: StreamPart[];
  initialized: boolean;
  error: string | null;
  serverError: boolean;
  reconnecting: boolean;

  init: () => Promise<void>;
  createSession: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  sendMessage: (text: string) => void;
  interrupt: () => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setSearchQuery: (q: string) => void;

  onChunk: (chunk: AgentStreamChunk) => void;
  setReconnecting: (v: boolean) => void;
  clearError: () => void;
  clearPending: () => void;
}>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  searchQuery: '',
  messages: [],
  streaming: false,
  pendingContent: null,
  streamParts: [],
  initialized: false,
  error: null,
  serverError: false,
  reconnecting: false,

  init: async () => {
    try {
      const sessions = await listSessions();
      set({ sessions });
    } catch {
      set({ serverError: true });
    }
  },

  createSession: async () => {
    try {
      const session = await createSessionApi();
      set((s) => ({
        sessions: [session, ...s.sessions],
        currentSessionId: session.sessionId,
        messages: [],
        initialized: true,
        error: null,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '创建会话失败' });
    }
  },

  selectSession: async (id: string) => {
    if (get().streaming) {
      try { await interruptAgent(get().currentSessionId!); } catch { /* ignore */ }
    }
    try {
      const detail = await getSession(id);
      set({
        currentSessionId: id,
        messages: (detail.messages ?? []) as UIMessage[],
        streaming: false,
        initialized: true,
        error: null,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '加载会话失败' });
    }
  },

  sendMessage: (text: string) => {
    const { currentSessionId, messages } = get();
    if (!currentSessionId || get().streaming) return;

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      toolCalls: [],
      parts: [{ type: 'text', text } as ContentPart],
      status: 'done',
    };
    const assistantMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      toolCalls: [],
      parts: [] as ContentPart[],
      status: 'pending',
    };
    assistantMessageId = assistantMsg.id;

    set({
      messages: [...messages, userMsg, assistantMsg],
      streamParts: [],
      error: null,
      streaming: true,
      pendingContent: text,
    });
  },

  onChunk: (chunk: AgentStreamChunk) => {
    set((s) => {
      if (chunk.type === 'session-title') {
        return {
          sessions: s.currentSessionId
            ? s.sessions.map((ses) =>
                ses.sessionId === s.currentSessionId
                  ? { ...ses, title: chunk.title }
                  : ses,
              )
            : s.sessions,
        };
      }

      const newParts = reduceStreamChunk(s.streamParts, chunk);

      const msgs = s.messages.map((m) => {
        if (m.id !== assistantMessageId) return m;
        return {
          ...m,
          content: newParts.filter((p) => p.type === 'text').map((p) => p.content).join(''),
          reasoning: newParts.filter((p) => p.type === 'reasoning').map((p) => p.content).join(''),
          parts: newParts.map((p) => {
            if (p.type === 'text') return { type: 'text', text: p.content } as ContentPart;
            if (p.type === 'reasoning') return { type: 'reasoning', text: p.content } as ContentPart;
            return {
              type: 'tool-call',
              toolCallId: p.toolCallId ?? '',
              toolName: p.toolName ?? '',
              arguments: (p.input as Record<string, unknown>) ?? {},
              result: p.status ? {
                success: p.status === 'success',
                output: p.output ?? '',
                error: p.error,
                durationMs: p.duration ?? 0,
              } : undefined,
            } as ContentPart;
          }),
          toolCalls: newParts.filter((p) => p.type === 'tool').map((p) => ({
            id: p.toolCallId ?? '',
            name: p.toolName ?? '',
            arguments: (p.input as Record<string, unknown>) ?? {},
            result: p.status ? {
              success: p.status === 'success',
              output: p.output ?? '',
              error: p.error,
              durationMs: p.duration ?? 0,
            } : undefined,
          })),
          status: chunk.type === 'finish' ? 'done' as const : chunk.type === 'error' ? 'error' as const : 'streaming' as const,
          error: chunk.type === 'error' ? String(chunk.error) : undefined,
        };
      });

      const streaming = chunk.type !== 'finish' && chunk.type !== 'error';
      return { messages: msgs, streamParts: newParts, streaming };
    });
  },

  setReconnecting: (v: boolean) => set({ reconnecting: v }),
  clearError: () => set({ error: null }),
  clearPending: () => set({ pendingContent: null }),

  interrupt: async () => {
    const { currentSessionId } = get();
    if (!currentSessionId) return;
    try { await interruptAgent(currentSessionId); } catch { /* ignore */ }
    set((s) => ({
      streaming: false,
      messages: s.messages.map((m) =>
        m.id === assistantMessageId ? { ...m, status: 'error' as const, error: '用户中断' } : m,
      ),
    }));
  },

  renameSession: async (id: string, title: string) => {
    try {
      await updateSession(id, { title });
      set((s) => ({
        sessions: s.sessions.map((ses) => (ses.sessionId === id ? { ...ses, title } : ses)),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '重命名失败' });
    }
  },

  deleteSession: async (id: string) => {
    try {
      await deleteSessionById(id);
      set((s) => {
        const remaining = s.sessions.filter((ses) => ses.sessionId !== id);
        const next = remaining[0]?.sessionId ?? null;
        return {
          sessions: remaining,
          currentSessionId: s.currentSessionId === id ? next : s.currentSessionId,
          messages: s.currentSessionId === id ? [] : s.messages,
        };
      });
      if (!get().currentSessionId) {
        get().createSession();
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '删除失败' });
    }
  },

  togglePin: async (id: string) => {
    const session = get().sessions.find((s) => s.sessionId === id);
    if (!session) return;
    const pinned = !session.pinned;
    try {
      await updateSession(id, { pinned });
      set((s) => ({
        sessions: s.sessions.map((ses) => (ses.sessionId === id ? { ...ses, pinned } : ses)),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '操作失败' });
    }
  },

  setSearchQuery: (q: string) => {
    set({ searchQuery: q });
    listSessions(q).then((sessions) => set({ sessions })).catch(() => {});
  },
}));
