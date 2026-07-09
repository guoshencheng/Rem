'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { ApprovalDecision, ApprovalRequest, LanguageModelUsage } from 'rem-agent-core';
import type { IAgentService, BusEvent, SessionActivity } from 'rem-agent-bridge/client';
import type { UIMessage } from 'rem-agent-bridge';
import { reduceStreamChunk } from 'rem-agent-bridge/client';
import { useAgentBus } from './use-agent-bus';

type SessionStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

function isContentChunkType(type: string): boolean {
  return type === 'text-delta' || type === 'reasoning-delta' ||
    type === 'tool-call' || type === 'tool-result' ||
    type === 'text-start' || type === 'reasoning-start' ||
    type === 'tool-call-start' || type === 'tool-result-start';
}

interface SessionState {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  activity?: SessionActivity;
  pendingToolCalls: Set<string>;
  pendingApprovals: ApprovalRequest[];
  tokenUsage?: LanguageModelUsage;
}

export interface SessionSummary {
  sessionId: string;
  title?: string;
  updatedAt: number;
  messageCount: number;
  pinned?: boolean;
  activity?: SessionActivity;
  tokenUsage?: LanguageModelUsage;
}

interface UseAgentsOptions {
  workspace: string;
}

export function useAgents(agentService: IAgentService, options: UseAgentsOptions) {
  const workspace = options.workspace;
  const bus = useAgentBus(agentService, workspace);

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
        const persisted = await agentService.getMessages(workspace, sessionId);
        const state = sessionMapRef.current.get(sessionId);
        if (!state) return;

        // Preserve streaming messages that have more recent content than the
        // persisted snapshot. This prevents a reconnect/refresh from replacing
        // a live streaming assistant message with a stale partial snapshot from
        // disk, which makes the message appear to disappear or truncate.
        const streamingMap = new Map(
          state.messages.filter((m) => m.status === 'streaming').map((m) => [m.id, m]),
        );

        const merged: UIMessage[] = [];
        for (const m of persisted) {
          const streaming = streamingMap.get(m.id);
          if (streaming) {
            merged.push(streaming);
            streamingMap.delete(m.id);
          } else {
            merged.push({ ...m, status: 'done' as const });
          }
        }
        // Append any streaming messages that do not yet exist in persisted storage.
        merged.push(...streamingMap.values());

        state.messages = merged;
        notifyChange();
      } catch {
        // ignore refresh errors
      }
    },
    [agentService, notifyChange, workspace],
  );

  const ensureSession = useCallback(
    async (sessionId: string, initialTokenUsage?: LanguageModelUsage) => {
      if (sessionMapRef.current.has(sessionId)) return;
      try {
        const [messages, pendingApprovals] = await Promise.all([
          agentService.getMessages(workspace, sessionId),
          agentService.listPendingApprovals(workspace, sessionId).catch(() => [] as ApprovalRequest[]),
        ]);
        sessionMapRef.current.set(sessionId, {
          messages,
          status: 'idle',
          error: null,
          pendingToolCalls: new Set(),
          pendingApprovals,
          tokenUsage: initialTokenUsage,
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
    [agentService, notifyChange, workspace],
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

  // Init: load session list (skip when no workspace selected)
  useEffect(() => {
    if (!workspace) {
      setSessionList([]);
      setCurrentId(null);
      setInitialized(true);
      return;
    }
    agentService.listSessions(workspace).then((list) => {
      setSessionList(list as SessionSummary[]);
      if (!currentId && list.length > 0) {
        const first = list[0];
        setCurrentId(first.sessionId);
        ensureSession(first.sessionId, first.tokenUsage);
      }
      setInitialized(true);
    }).catch(() => {
      setInitialized(true);
    });
  }, [workspace]);

  // Subscribe to bus events
  useEffect(() => {
    const handleEvent = (event: BusEvent) => {
      if (event.workspace !== workspace) return;

      const map = sessionMapRef.current;
      let state = map.get(event.sessionId);

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
          const chunk = event.chunk;

          // LLM-generated session title — update session list immediately
          if (chunk.type === 'session-title' && (chunk as any).title) {
            const newTitle = (chunk as any).title as string;
            setSessionList((prev) =>
              prev.map((s) =>
                s.sessionId === event.sessionId ? { ...s, title: newTitle } : s,
              ),
            );
            return;
          }

          if (!state) {
            bufferEvent(event);
            return;
          }

          // Compute the next active part type before updating messages so the
          // streaming message can be updated in a single pass.
          let nextActivePartType: UIMessage['activePartType'] | undefined;
          switch (chunk.type) {
            case 'reasoning-start':
              nextActivePartType = 'reasoning';
              break;
            case 'text-start':
              nextActivePartType = 'text';
              break;
            case 'tool-call-start':
              nextActivePartType = 'tool-call';
              break;
            case 'tool-result-start':
              nextActivePartType = 'tool-result';
              break;
            case 'reasoning-finish':
            case 'text-finish':
            case 'tool-call-finish':
            case 'tool-result-finish':
            case 'finish':
            case 'error':
              nextActivePartType = undefined;
              break;
          }

          if (chunk.type === 'message-start') {
            ensureAssistantMessage(state, chunk.messageId);
            currentMsgIdRef.current.set(event.sessionId, chunk.messageId);
          }

          const msgId = currentMsgIdRef.current.get(event.sessionId);
          if (msgId) {
            const target = state.messages.find((m) => m.id === msgId);
            if (chunk.type !== 'message-start' && (!target || target.status !== 'streaming')) {
              // chunk not appended
            }
            state.messages = state.messages.map((m) => {
              if (m.id === msgId && m.status === 'streaming') {
                const newParts = reduceStreamChunk(m.parts, chunk);
                return {
                  ...m,
                  parts: newParts,
                  activePartType: nextActivePartType ?? m.activePartType,
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
          } else if (chunk.type === 'usage') {
            state.tokenUsage = {
              inputTokens: chunk.inputTokens,
              outputTokens: chunk.outputTokens,
              totalTokens: chunk.totalTokens,
              inputTokenDetails: chunk.inputTokenDetails,
              outputTokenDetails: chunk.outputTokenDetails,
            };
            // 把本次 usage 绑定到当前正在生成的 assistant 消息
            if (msgId) {
              state.messages = state.messages.map((m) =>
                m.id === msgId ? { ...m, tokenUsage: state.tokenUsage } : m,
              );
            }
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
          } else if (chunk.type === 'step-finish') {
            state.activity = state.pendingToolCalls.size > 0 ? 'calling-function' : 'idle';
            state.pendingToolCalls.clear();
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
        case 'usage-change': {
          if (!state) {
            bufferEvent(event);
            return;
          }
          state.tokenUsage = event.usage;
          notifyChange();
          break;
        }
      }
    };

    handleEventRef.current = handleEvent;

    const unsubReconnect = bus.onReconnect(() => {
      // SSE reconnected; refresh known sessions to recover any missed events
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
      tokenUsage: state.tokenUsage,
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
        const summary = sessionList.find((s) => s.sessionId === id);
        await ensureSession(id, summary?.tokenUsage);
      }
      setCurrentId(id);
    },
    [ensureSession, sessionList],
  );

  const createSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions?workspace=${encodeURIComponent(workspace)}`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to create');
      const session = await res.json() as SessionSummary;
      setSessionList((prev) => [session, ...prev]);
      const id = session.sessionId;
      await ensureSession(id);
      setCurrentId(id);
    } catch (err) {
      // silent fail
    }
  }, [ensureSession, workspace]);

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/sessions/${id}?workspace=${encodeURIComponent(workspace)}`, { method: 'DELETE' });
        sessionMapRef.current.delete(id);
        currentMsgIdRef.current.delete(id);
        pendingEventsRef.current.delete(id);
        loadingRef.current.delete(id);
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
    [currentId, notifyChange, workspace],
  );

  const resolveApproval = useCallback(
    async (approvalId: string, decision: ApprovalDecision) => {
      if (!currentId) return;
      try {
        await agentService.resolveApproval(workspace, currentId, approvalId, decision);
      } catch {
        // silent fail; resolved chunks will update state if successful
      }
    },
    [agentService, currentId, workspace],
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
