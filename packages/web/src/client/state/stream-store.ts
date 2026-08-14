import { create } from 'zustand';
import type { RunSignal } from 'rem-agent-core';
import type { RuntimeChatMessage, WorkbenchSession } from '@/types';
import {
  applyRuntimeRunSignal, createRuntimeRunProjection, type RuntimeChat,
  type RuntimeRunProjection, type RuntimeToolResult,
} from './runtime-stream-projection';

export interface SessionState {
  chat: RuntimeChatMessage[];
  toolResults: Record<string, RuntimeToolResult>;
  chatVersion: number;
  runtimeRun?: RuntimeRunProjection;
  error?: string;
}

interface StreamStore {
  sessions: WorkbenchSession[];
  bySession: Record<string, SessionState>;
  setSessions: (sessions: WorkbenchSession[]) => void;
  setChat: (sessionId: string, chat: RuntimeChat) => void;
  beginRuntimeRun: (sessionId: string, runId: string, content: string) => void;
  applyRuntimeSignal: (sessionId: string, signal: RunSignal) => void;
  failRuntimeRun: (sessionId: string, runId: string, error: string, status?: 'failed' | 'cancelled') => void;
  setError: (sessionId: string, error?: string) => void;
  reset: () => void;
}

const emptySessionState = (): SessionState => ({ chat: [], toolResults: {}, chatVersion: 0 });

export const useStreamStore = create<StreamStore>((set) => {
  const patchSession = (sessionId: string, patch: (state: SessionState) => Partial<SessionState>) =>
    set((state) => {
      const current = state.bySession[sessionId] ?? emptySessionState();
      return { bySession: { ...state.bySession, [sessionId]: { ...current, ...patch(current) } } };
    });

  return {
    sessions: [],
    bySession: {},
    setSessions: (sessions) => set({ sessions }),
    setChat: (sessionId, chat) => patchSession(sessionId, () => ({
      chat: chat.messages, toolResults: chat.toolResults, runtimeRun: undefined, chatVersion: 0,
    })),
    beginRuntimeRun: (sessionId, runId, content) => patchSession(sessionId, (state) => ({
      chat: [...state.chat, {
        messageId: `runtime:${runId}:user`,
        message: { role: 'user', content, timestamp: Date.now() },
      }],
      runtimeRun: createRuntimeRunProjection(runId), error: undefined,
    })),
    applyRuntimeSignal: (sessionId, signal) => patchSession(sessionId, (state) => {
      if (!state.runtimeRun || state.runtimeRun.runId !== signal.runId) return {};
      return { runtimeRun: applyRuntimeRunSignal(state.runtimeRun, signal) };
    }),
    failRuntimeRun: (sessionId, runId, error, status = 'failed') => patchSession(sessionId, (state) => ({
      error,
      ...(state.runtimeRun?.runId === runId
      ? { runtimeRun: { ...state.runtimeRun, status, error } }
        : {}),
    })),
    setError: (sessionId, error) => patchSession(sessionId, () => ({ error })),
    reset: () => set({ sessions: [], bySession: {} }),
  };
});
