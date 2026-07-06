'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { ApprovalDecision, ApprovalRequest } from 'rem-agent-core';
import type { IAgentService, BusEvent, SessionActivity, AgentStreamChunk } from 'rem-agent-bridge/client';
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
  pendingApprovals: ApprovalRequest[];
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
  const currentMsgIdRef = useRef<Map<string, string>>(new Map());
  const pendingEventsRef = useRef<Map<string, BusEvent[]>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const handleEventRef = useRef<(event: BusEvent) => void>(() => {});

  const notifyChange = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  const refreshSession = useCallback(
    async (sessionId: string) => {
      try {
        const persisted = await agentService.getMessages(sessionId);
        const state = sessionMapRef.current.get(sessionId);
        if (!state) return;
        const persistedIds = new Set(persisted.map((m) => m.id));
        const streamingTail = state.messages.filter(
          (m) => m.status === 'streaming' && !persistedIds.has(m.id),
        );
        state.messages = [
          ...persisted.map((m) => ({ ...m, status: 'done' as const })),
          ...streamingTail,
        ];
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
        const [messages, pendingApprovals] = await Promise.all([
          agentService.getMessages(sessionId),
          agentService.listPendingApprovals(sessionId).catch(() => [] as ApprovalRequest[]),
        ]);
        sessionMapRef.current.set(sessionId, {
          messages,
          status: 'idle',
          error: null,
          pendingToolCalls: new Set(),
          pendingApprovals,
        });
      } catch {
        sessionMapRef.current.set(sessionId, {
          messages: [],
          status: 'idle',
          error: null,
          pendingToolCalls: new Set(),
          pendingApprovals: [],
        });
      }
      notifyChange();
    },
    [agentService, notifyChange],
  );

  const ensureAssistantMessage = useCallback(
    (state: SessionState, messageId: string) => {
      const existing = state.messages.find((m) => m.id === messageId);
      if (existing) {
        if (existing.status !== 'streaming') {
          state.messages = state.messages.map((m) =>
            m.id === messageId ? { ...m, status: 'streaming' as const } : m,
          );
        }
        return;
      }
      state.messages = [
        ...state.messages,
        {
          id: messageId,
          role: 'assistant',
          parts: [],
          status: 'streaming',
        },
      ];
    },
    [],
  );

  const bufferEvent = useCallback(
    (event: BusEvent) => {
      const buf = pendingEventsRef.current.get(event.sessionId) ?? [];
      buf.push(event);
      pendingEventsRef.current.set(event.sessionId, buf);
      if (!loadingRef.current.has(event.sessionId)) {
        loadingRef.current.add(event.sessionId);
        ensureSession(event.sessionId)
          .then(() => {
            loadingRef.current.delete(event.sessionId);
            const pending = pendingEventsRef.current.get(event.sessionId) ?? [];
            pendingEventsRef.current.delete(event.sessionId);
            for (const e of pending) handleEventRef.current(e);
          })
          .catch(() => {
            loadingRef.current.delete(event.sessionId);
            pendingEventsRef.current.delete(event.sessionId);
          });
      }
    },
    [ensureSession],
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
    const handleEvent = (event: BusEvent) => {
      if (event.workspace !== workspace) return;

      const map = sessionMapRef.current;
      let state = map.get(event.sessionId);

      console.log(`[useAgents] bus-event session=${event.sessionId} type=${event.type} hasState=${!!state}`);

      switch (event.type) {
        case 'session-start': {
          if (!state) {
            bufferEvent(event);
            return;
          }
          state.status = 'loading';
          state.activity = state.activity ?? 'pending';
          notifyChange();
          break;
        }
        case 'snapshot': {
          if (!state) {
            bufferEvent(event);
            return;
          }
          ensureAssistantMessage(state, event.messageId);
          currentMsgIdRef.current.set(event.sessionId, event.messageId);
          state.messages = state.messages.map((m) =>
            m.id === event.messageId && m.status === 'streaming'
              ? { ...m, parts: event.parts }
              : m,
          );
          notifyChange();
          break;
        }
        case 'chunk': {
          if (!state) {
            bufferEvent(event);
            return;
          }

          const chunk = event.chunk;

          if (chunk.type === 'message-start') {
            ensureAssistantMessage(state, chunk.messageId);
            currentMsgIdRef.current.set(event.sessionId, chunk.messageId);
          }

          const msgId = currentMsgIdRef.current.get(event.sessionId);
          if (msgId) {
            state.messages = state.messages.map((m) => {
              if (m.id === msgId && m.status === 'streaming') {
                const newParts = reduceStreamChunk(m.parts, chunk);
                return {
                  ...m,
                  parts: newParts,
                  status: chunk.type === 'finish' ? 'done'
                    : chunk.type === 'error' ? 'error'
                    : 'streaming',
                  error: chunk.type === 'error' ? String(chunk.error) : undefined,
                };
              }
              return m;
            });
          }

          state.status = chunk.type === 'finish' ? 'done'
            : chunk.type === 'error' ? 'error'
            : 'streaming';
          if (chunk.type === 'error') {
            state.error = String(chunk.error);
          }

          if (chunk.type === 'approval-request') {
            if (!state.pendingApprovals.some((r) => r.approvalId === chunk.request.approvalId)) {
              state.pendingApprovals.push(chunk.request);
            }
          } else if (chunk.type === 'approval-resolved') {
            state.pendingApprovals = state.pendingApprovals.filter(
              (r) => r.approvalId !== chunk.approvalId,
            );
          } else if (chunk.type === 'finish' || chunk.type === 'error') {
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
            bufferEvent(event);
            return;
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
    };

    handleEventRef.current = handleEvent;

    const unsubReconnect = bus.onReconnect(() => {
      for (const sessionId of sessionMapRef.current.keys()) {
        refreshSession(sessionId);
      }
    });

    const unsubEvent = bus.onEvent(handleEvent);

    return () => {
      unsubEvent();
      unsubReconnect();
    };
  }, [workspace, bus, ensureSession, notifyChange, refreshSession, bufferEvent, ensureAssistantMessage]);

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
      pendingApprovals: state.pendingApprovals,
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

      state.messages = [...state.messages, userMsg];
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

  const resolveApproval = useCallback(
    async (approvalId: string, decision: ApprovalDecision) => {
      try {
        await agentService.resolveApproval(approvalId, decision);
      } catch {
        // silent fail; resolved chunks will update state if successful
      }
    },
    [agentService],
  );

  return {
    currentSession,
    sessions: sessionList,
    switchSession,
    createSession,
    deleteSession,
    send,
    interrupt,
    resolveApproval,
    initialized,
  };
}
