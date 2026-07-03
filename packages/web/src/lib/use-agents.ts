'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { IAgentService, BusEvent, SessionActivity } from 'rem-agent-bridge/client';
import type { UIMessage } from 'rem-agent-bridge';
import { reduceStreamChunk } from 'rem-agent-bridge/client';
import { useAgentBus } from './use-agent-bus';

type SessionStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

interface SessionState {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  activity?: SessionActivity;
  pendingToolCalls: Set<string>;
}

export interface SessionSummary {
  sessionId: string;
  title?: string;
  updatedAt: number;
  messageCount: number;
  pinned?: boolean;
  activity?: SessionActivity;
}

interface UseAgentsOptions {
  workspace?: string;
}

export function useAgents(agentService: IAgentService, options?: UseAgentsOptions) {
  const workspace = options?.workspace ?? 'default';
  const bus = useAgentBus(agentService);

  const [sessionList, setSessionList] = useState<SessionSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const sessionMapRef = useRef<Map<string, SessionState>>(new Map());
  const [version, setVersion] = useState(0);
  const assistantMsgIdRef = useRef<Map<string, string>>(new Map());

  const notifyChange = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  const refreshSession = useCallback(
    async (sessionId: string) => {
      try {
        const messages = await agentService.getMessages(sessionId);
        const state = sessionMapRef.current.get(sessionId);
        if (!state) return;
        state.messages = messages.map((msg) => ({
          ...msg,
          status: 'done' as const,
        }));
        notifyChange();
      } catch {
        // ignore refresh errors
      }
    },
    [agentService, notifyChange],
  );

  const ensureSession = useCallback(
    async (sessionId: string) => {
      if (sessionMapRef.current.has(sessionId)) return;
      try {
        const messages = await agentService.getMessages(sessionId);
        sessionMapRef.current.set(sessionId, {
          messages,
          status: 'idle',
          error: null,
          pendingToolCalls: new Set(),
        });
      } catch {
        sessionMapRef.current.set(sessionId, {
          messages: [],
          status: 'idle',
          error: null,
          pendingToolCalls: new Set(),
        });
      }
      notifyChange();
    },
    [agentService, notifyChange],
  );

  // Init: load session list
  useEffect(() => {
    agentService.listSessions().then((list) => {
      setSessionList(list as SessionSummary[]);
      if (!currentId && list.length > 0) {
        const id = list[0].sessionId;
        setCurrentId(id);
        ensureSession(id);
      }
      setInitialized(true);
    }).catch(() => {
      setInitialized(true);
    });
  }, []);

  // Subscribe to bus events
  useEffect(() => {
    const unsubEvent = bus.onEvent((event: BusEvent) => {
      if (event.workspace !== workspace) return;

      const map = sessionMapRef.current;
      let state = map.get(event.sessionId);

      console.log(`[useAgents] bus-event session=${event.sessionId} type=${event.type} hasState=${!!state}`);

      switch (event.type) {
        case 'session-start': {
          if (!state) {
            ensureSession(event.sessionId);
            state = map.get(event.sessionId);
          }
          if (state) {
            state.status = 'loading';
            state.activity = state.activity ?? 'pending';
            notifyChange();
          }
          break;
        }
        case 'chunk': {
          if (!state) {
            ensureSession(event.sessionId);
            state = map.get(event.sessionId);
            if (!state) return;
          }
          const lastMsg = state.messages[state.messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            const newParts = reduceStreamChunk(lastMsg.parts, event.chunk);
            state.messages = [
              ...state.messages.slice(0, -1),
              {
                ...lastMsg,
                parts: newParts,
                status: event.chunk.type === 'finish' ? 'done'
                  : event.chunk.type === 'error' ? 'error'
                  : 'streaming',
                error: event.chunk.type === 'error' ? String(event.chunk.error) : undefined,
              },
            ];
          }
          state.status = event.chunk.type === 'finish' ? 'done'
            : event.chunk.type === 'error' ? 'error'
            : 'streaming';
          if (event.chunk.type === 'error') {
            state.error = String(event.chunk.error);
          }

          const chunk = event.chunk;
          if (chunk.type === 'finish' || chunk.type === 'error') {
            state.activity = 'idle';
            state.pendingToolCalls.clear();
          } else if (chunk.type === 'reasoning-start' || chunk.type === 'reasoning-delta') {
            state.activity = 'thinking';
          } else if (chunk.type === 'tool-call-start' || chunk.type === 'tool-call') {
            state.activity = 'calling-function';
            state.pendingToolCalls.add(chunk.toolCallId);
          } else if (chunk.type === 'tool-result-start' || chunk.type === 'tool-result' || chunk.type === 'tool-result-finish') {
            state.pendingToolCalls.delete(chunk.toolCallId);
            if (state.pendingToolCalls.size > 0) {
              state.activity = 'calling-function';
            }
          } else if (chunk.type === 'text-start' || chunk.type === 'text-delta') {
            if (state.pendingToolCalls.size === 0) {
              state.activity = 'outputting';
            }
          }

          notifyChange();
          break;
        }
        case 'session-end': {
          if (!state) return;
          state.status = 'done';
          state.activity = 'idle';
          notifyChange();
          break;
        }
        case 'session-error': {
          if (!state) return;
          state.status = 'error';
          state.error = event.error;
          notifyChange();
          break;
        }
        case 'activity-change': {
          if (!state) {
            ensureSession(event.sessionId);
            state = map.get(event.sessionId);
            if (!state) return;
          }
          state.activity = event.activity;
          setSessionList((prev) =>
            prev.map((s) =>
              s.sessionId === event.sessionId ? { ...s, activity: event.activity } : s,
            ),
          );
          notifyChange();
          break;
        }
      }
    });

    const unsubReconnect = bus.onReconnect(() => {
      // SSE reconnected; refresh known sessions to recover any missed events
      for (const sessionId of sessionMapRef.current.keys()) {
        refreshSession(sessionId);
      }
    });

    return () => {
      unsubEvent();
      unsubReconnect();
    };
  }, [workspace, bus, ensureSession, notifyChange, refreshSession]);

  const currentSession = useMemo(() => {
    if (!currentId) return null;
    const state = sessionMapRef.current.get(currentId);
    if (!state) return null;
    return {
      id: currentId,
      messages: state.messages,
      status: state.status,
      error: state.error,
      activity: state.activity,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, version]);

  const send = useCallback(
    async (content: string) => {
      if (!currentId) return;
      const map = sessionMapRef.current;
      const state = map.get(currentId);
      if (!state) return;

      const userMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: content }],
        status: 'done',
      };
      const assistantMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        parts: [],
        status: 'pending',
      };
      assistantMsgIdRef.current.set(currentId, assistantMsg.id);

      state.messages = [...state.messages, userMsg, assistantMsg];
      state.status = 'loading';
      state.error = null;
      state.activity = 'pending';
      notifyChange();

      console.log(`[useAgents] send session=${currentId} content="${content.slice(0, 50)}"`);

      try {
        await bus.send(currentId, content);
      } catch (err) {
        state.status = 'error';
        state.error = err instanceof Error ? err.message : 'Send failed';
        notifyChange();
      }
    },
    [currentId, bus, notifyChange],
  );

  const interrupt = useCallback(async () => {
    if (!currentId) return;
    await bus.interrupt(currentId);
    const state = sessionMapRef.current.get(currentId);
    if (state) {
      state.status = 'done';
      notifyChange();
    }
  }, [currentId, bus, notifyChange]);

  const switchSession = useCallback(
    async (id: string) => {
      if (!sessionMapRef.current.has(id)) {
        await ensureSession(id);
      }
      setCurrentId(id);
    },
    [ensureSession],
  );

  const createSession = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to create');
      const session = await res.json() as SessionSummary;
      setSessionList((prev) => [session, ...prev]);
      const id = session.sessionId;
      await ensureSession(id);
      setCurrentId(id);
    } catch (err) {
      // silent fail
    }
  }, [ensureSession]);

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
        sessionMapRef.current.delete(id);
        setSessionList((prev) => {
          const remaining = prev.filter((s) => s.sessionId !== id);
          if (currentId === id) {
            const next = remaining[0]?.sessionId ?? null;
            setCurrentId(next);
          }
          return remaining;
        });
        notifyChange();
      } catch {
        // silent fail
      }
    },
    [currentId, notifyChange],
  );

  return {
    currentSession,
    sessions: sessionList,
    switchSession,
    createSession,
    deleteSession,
    send,
    interrupt,
    initialized,
  };
}
