import { create } from 'zustand';
import type {
  AgentSystemEvent, AgentThread, Message, SessionChatMessage, SessionInfo,
} from 'rem-agent-core';
import { reduceStreamEvent, type ContentBlock } from './stream-reducer';

export interface SessionState {
  chat: SessionChatMessage[];
  threads: AgentThread[];
  threadMessages: Record<string, Message[]>;
  streaming: Record<string, ContentBlock[]>;
  chatVersion: number;
  threadVersions: Record<string, number>;
  error?: string;
}

interface StreamStore {
  sessions: SessionInfo[];
  bySession: Record<string, SessionState>;
  setSessions: (sessions: SessionInfo[]) => void;
  setChat: (sessionId: string, chat: SessionChatMessage[]) => void;
  setThreads: (sessionId: string, threads: AgentThread[]) => void;
  setThreadMessages: (key: { sessionId: string; threadId: string }, messages: Message[]) => void;
  applyEvent: (event: AgentSystemEvent) => void;
  reset: () => void;
}

const emptySessionState = (): SessionState => ({
  chat: [],
  threads: [],
  threadMessages: {},
  streaming: {},
  chatVersion: 0,
  threadVersions: {},
});

export const useStreamStore = create<StreamStore>((set) => {
  const patchSession = (sessionId: string, patch: (s: SessionState) => Partial<SessionState>) =>
    set((state) => {
      const current = state.bySession[sessionId] ?? emptySessionState();
      return { bySession: { ...state.bySession, [sessionId]: { ...current, ...patch(current) } } };
    });

  return {
    sessions: [],
    bySession: {},
    setSessions: (sessions) => set({ sessions }),
    setChat: (sessionId, chat) => patchSession(sessionId, () => ({ chat })),
    setThreads: (sessionId, threads) => patchSession(sessionId, () => ({ threads })),
    setThreadMessages: ({ sessionId, threadId }, messages) =>
      patchSession(sessionId, (s) => ({
        threadMessages: { ...s.threadMessages, [threadId]: messages },
      })),
    applyEvent: (event) => {
      switch (event.type) {
        case 'chunk': {
          const threadId = event.agentThreadId ?? 'primary';
          const chunk = event.chunk;
          if (chunk.type === 'message_update') {
            patchSession(event.sessionId, (s) => ({
              streaming: {
                ...s.streaming,
                [threadId]: reduceStreamEvent(
                  s.streaming[threadId] ?? [],
                  chunk.assistantMessageEvent,
                ),
              },
            }));
          } else if (chunk.type === 'message_end' || chunk.type === 'finish') {
            patchSession(event.sessionId, (s) => {
              const streaming = { ...s.streaming };
              delete streaming[threadId];
              return {
                streaming,
                chatVersion: s.chatVersion + 1,
                threadVersions: {
                  ...s.threadVersions,
                  [threadId]: (s.threadVersions[threadId] ?? 0) + 1,
                },
              };
            });
          }
          break;
        }
        case 'activity-change':
          set((state) => ({
            sessions: state.sessions.map((s) =>
              s.sessionId === event.sessionId ? { ...s, activity: event.activity } : s),
          }));
          break;
        case 'session-end':
          patchSession(event.sessionId, (s) => ({ chatVersion: s.chatVersion + 1 }));
          break;
        case 'session-error':
          patchSession(event.sessionId, () => ({ error: event.error }));
          break;
        default:
          break;
      }
    },
    reset: () => set({ sessions: [], bySession: {} }),
  };
});
