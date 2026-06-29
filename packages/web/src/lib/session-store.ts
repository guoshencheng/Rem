'use client';

import { create } from 'zustand';
import type { SessionSummary, UIMessage, AgentStreamChunk, ContentPart } from './types';
import {
  listSessions, createSession, getSession, updateSession,
  deleteSession, interruptAgent,
} from './agent-client';

let assistantMessageId = '';

export const useSessionStore = create<{
  sessions: SessionSummary[];
  currentSessionId: string | null;
  searchQuery: string;
  messages: UIMessage[];
  streaming: boolean;
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
}>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  searchQuery: '',
  messages: [],
  streaming: false,
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
      const session = await createSession();
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
      error: null,
      streaming: true,
    });
  },

  onChunk: (chunk: AgentStreamChunk) => {
    set((s) => {
      const msgs = s.messages.map((m) => {
        if (m.id !== assistantMessageId) return m;
        const parts = [...m.parts];
        const msg = { ...m, parts };

        switch (chunk.type) {
          case 'text-start': {
            parts.push({ type: 'text', text: '' } as ContentPart);
            break;
          }
          case 'text-delta': {
            const last = parts[parts.length - 1];
            if (last?.type === 'text') {
              parts[parts.length - 1] = { ...last, text: last.text + chunk.text };
              msg.content += chunk.text;
            }
            break;
          }
          case 'reasoning-start': {
            parts.push({ type: 'reasoning', text: '' } as ContentPart);
            break;
          }
          case 'reasoning-delta': {
            const last = parts[parts.length - 1];
            if (last?.type === 'reasoning') {
              parts[parts.length - 1] = { ...last, text: last.text + chunk.text };
              msg.reasoning = (msg.reasoning ?? '') + chunk.text;
            }
            break;
          }
          case 'reasoning-finish': {
            break;
          }
          case 'tool-call-start': {
            parts.push({
              type: 'tool-call',
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              arguments: {},
            } as ContentPart);
            msg.toolCalls = [...msg.toolCalls, { id: chunk.toolCallId, name: chunk.toolName, arguments: {} }];
            break;
          }
          case 'tool-call': {
            const idx = parts.findIndex((p): p is ContentPart & { type: 'tool-call' } =>
              p.type === 'tool-call' && p.toolCallId === chunk.toolCallId,
            );
            if (idx >= 0) {
              parts[idx] = { ...parts[idx], arguments: (chunk.input as Record<string, unknown>) ?? {} } as ContentPart;
            }
            msg.toolCalls = msg.toolCalls.map((tc) =>
              tc.id === chunk.toolCallId ? { ...tc, arguments: (chunk.input as Record<string, unknown>) ?? {} } : tc,
            );
            break;
          }
          case 'tool-call-finish': {
            break;
          }
          case 'tool-result-start': {
            break;
          }
          case 'tool-result': {
            const idx = parts.findIndex((p): p is ContentPart & { type: 'tool-call' } =>
              p.type === 'tool-call' && p.toolCallId === chunk.toolCallId,
            );
            if (idx >= 0) {
              const part = parts[idx] as ContentPart & { type: 'tool-call'; result?: { success: boolean; output: string; error?: string; durationMs: number } };
              parts[idx] = {
                ...part,
                result: { success: !chunk.error, output: chunk.output ?? '', error: chunk.error, durationMs: 0 },
              };
            }
            msg.toolCalls = msg.toolCalls.map((tc) =>
              tc.id === chunk.toolCallId
                ? { ...tc, result: { success: !chunk.error, output: chunk.output ?? '', error: chunk.error, durationMs: 0 } }
                : tc,
            );
            break;
          }
          case 'finish': {
            msg.status = 'done';
            break;
          }
          case 'error': {
            msg.status = 'error';
            msg.error = String(chunk.error);
            break;
          }
        }

        return msg;
      });

      const streaming = chunk.type !== 'finish' && chunk.type !== 'error';
      return { messages: msgs, streaming };
    });
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
