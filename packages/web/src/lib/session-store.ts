'use client';

import { create } from 'zustand';
import type { SessionSummary, UIMessage, AgentStreamChunk } from './types.js';
import {
  isSSETextDelta, isSSEReasoningDelta, isSSEToolCallStart,
  isSSEToolResult, isSSEFinish, isSSEError,
} from './types.js';
import {
  listSessions, createSession, getSession, updateSession,
  deleteSession, runAgent, interruptAgent,
} from './agent-client.js';
import type { ToolCallRecord } from 'rem-agent-core';

let assistantMessageId = '';

export const useSessionStore = create<{
  sessions: SessionSummary[];
  currentSessionId: string | null;
  searchQuery: string;
  messages: UIMessage[];
  streaming: boolean;
  error: string | null;
  serverError: boolean;
  reconnecting: boolean;

  init: () => Promise<void>;
  createSession: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<{ streamUrl: string } | undefined>;
  interrupt: () => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setSearchQuery: (q: string) => void;

  onChunk: (chunk: AgentStreamChunk) => void;
  setReconnecting: (v: boolean) => void;
  clearError: () => void;
}>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  searchQuery: '',
  messages: [],
  streaming: false,
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
      const session = await createSession();
      set((s) => ({
        sessions: [session, ...s.sessions],
        currentSessionId: session.sessionId,
        messages: [],
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
        error: null,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '加载会话失败' });
    }
  },

  sendMessage: async (text: string) => {
    const { currentSessionId, messages } = get();
    if (!currentSessionId || get().streaming) return;

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      toolCalls: [],
      status: 'done',
    };
    const assistantMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      toolCalls: [],
      status: 'pending',
    };
    assistantMessageId = assistantMsg.id;

    set({ messages: [...messages, userMsg, assistantMsg], error: null });

    try {
      const result = await runAgent(currentSessionId, text);
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, status: 'streaming' as const } : m,
        ),
        streaming: true,
      }));
      return result;
    } catch (err) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, status: 'error' as const, error: err instanceof Error ? err.message : '发送失败' }
            : m,
        ),
      }));
    }
  },

  onChunk: (chunk: AgentStreamChunk) => {
    if (isSSETextDelta(chunk)) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessageId ? { ...m, content: m.content + chunk.text } : m,
        ),
      }));
    } else if (isSSEReasoningDelta(chunk)) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessageId ? { ...m, reasoning: (m.reasoning ?? '') + chunk.text } : m,
        ),
      }));
    } else if (isSSEToolCallStart(chunk)) {
      const newTool: ToolCallRecord = {
        id: chunk.toolCallId,
        name: chunk.toolName,
        arguments: {} as Record<string, unknown>,
        durationMs: 0,
        timestamp: new Date(),
      };
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessageId ? { ...m, toolCalls: [...m.toolCalls, newTool] } : m,
        ),
      }));
    } else if (isSSEToolResult(chunk)) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessageId
            ? {
                ...m,
                toolCalls: m.toolCalls.map((tc) =>
                  tc.id === chunk.toolCallId
                    ? {
                        ...tc,
                        result: {
                          success: !chunk.error,
                          output: chunk.output,
                          error: chunk.error,
                          durationMs: tc.durationMs,
                        },
                      }
                    : tc,
                ),
              }
            : m,
        ),
      }));
    } else if (isSSEFinish(chunk)) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessageId ? { ...m, status: 'done' as const } : m,
        ),
        streaming: false,
      }));
    } else if (isSSEError(chunk)) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessageId
            ? { ...m, status: 'error' as const, error: String(chunk.error) }
            : m,
        ),
        streaming: false,
      }));
    }
  },

  setReconnecting: (v: boolean) => set({ reconnecting: v }),
  clearError: () => set({ error: null }),

  interrupt: async () => {
    const { currentSessionId } = get();
    if (!currentSessionId) return;
    try { await interruptAgent(currentSessionId); } catch { /* ignore */ }
    set({ streaming: false });
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
      await deleteSession(id);
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
