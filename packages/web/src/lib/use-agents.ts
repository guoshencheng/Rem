'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { ApprovalDecision, ApprovalRequest, Usage, Rule } from 'rem-agent-core';
import type { StreamErrorInfo } from 'rem-agent-core';
import type { IAgentService, BusEvent, SessionActivity } from 'rem-agent-bridge/client';
import type { UIMessage } from 'rem-agent-bridge';
import { reduceStreamEvent } from 'rem-agent-bridge/client';
import type { UiContentBlock } from 'rem-agent-bridge';
import { useAgentBus } from './agent-bus';
import { generateUUID } from './utils';

function cleanErrorString(value: string): string {
  const trimmed = value.trim();
  // Try to extract nested error message from strings like "401 { ... }"
  const jsonMatch = trimmed.match(/^\d+\s+(\{.*\})$/s) ?? trimmed.match(/^(\{.*\})$/s);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (typeof parsed?.error?.message === 'string') return parsed.error.message;
      if (typeof parsed?.message === 'string') return parsed.message;
    } catch {
      // ignore parse errors, fall back to original string
    }
  }
  return value;
}

function formatError(error: string | StreamErrorInfo | unknown): string {
  if (typeof error === 'string') {
    return cleanErrorString(error);
  }
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    // pi-ai 的 error 事件会携带完整 AssistantMessage，错误文本在 errorMessage 里
    if (typeof e.errorMessage === 'string' && e.errorMessage) return cleanErrorString(e.errorMessage);
    if (typeof e.message === 'string' && e.message) return cleanErrorString(e.message);
  }
  return String(error);
}

type SessionStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

export interface ChildAgentInfo {
  childSessionId: string;
  toolCallId?: string;
  summary: string;
  status: 'running' | 'completed' | 'failed';
  tokenUsage?: Usage;
}

export interface SessionView {
  id: string;
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  activity?: SessionActivity;
  pendingApprovals: ApprovalRequest[];
  tokenUsage?: Usage;
  childAgents: Map<string, ChildAgentInfo>;
}

interface SessionState {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  activity?: SessionActivity;
  pendingToolCalls: Set<string>;
  pendingApprovals: ApprovalRequest[];
  tokenUsage?: Usage;
  childAgents: Map<string, ChildAgentInfo>;
}

export interface SessionSummary {
  sessionId: string;
  workspace?: string;
  title?: string;
  updatedAt: number;
  messageCount: number;
  pinned?: boolean;
  activity?: SessionActivity;
  tokenUsage?: Usage;
  parentSessionId?: string;
}

interface UseAgentsOptions {
  workspace: string;
}

export function useAgents(agentService: IAgentService, options: UseAgentsOptions) {
  const workspace = options.workspace;
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
    async (sessionId: string, initialTokenUsage?: Usage) => {
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
          childAgents: new Map(),
        });
      } catch {
        sessionMapRef.current.set(sessionId, {
          messages: [],
          status: 'idle',
          error: null,
          pendingToolCalls: new Set(),
          pendingApprovals: [],
          childAgents: new Map(),
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
          toolResults: {},
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

  // 从历史 sessionList 重建子 agent 条目（child-agent-update 是运行时事件不持久化，
  // 刷新后靠 parentSessionId 恢复卡片入口；运行时已有的条目优先，不覆盖）
  useEffect(() => {
    let changed = false;
    for (const s of sessionList) {
      if (!s.parentSessionId) continue;
      const parentState = sessionMapRef.current.get(s.parentSessionId);
      if (!parentState) continue;
      const existing = parentState.childAgents.get(s.sessionId);
      if (existing && (existing.toolCallId || existing.status === 'running')) continue;
      parentState.childAgents.set(s.sessionId, {
        childSessionId: s.sessionId,
        summary: s.title ?? '',
        status: 'completed',
        tokenUsage: s.tokenUsage,
      });
      changed = true;
    }
    if (changed) notifyChange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionList, version]);

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
            m.id === event.messageId
              ? { ...m, parts: event.parts, toolResults: m.toolResults }
              : m,
          );
          notifyChange();
          break;
        }
        case 'chunk': {
          const chunk = event.chunk;
          console.log('[use-agents] chunk type:', chunk.type, 'sessionId:', event.sessionId);

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

          if (chunk.type === 'compress-start') {
            if (!state) {
              bufferEvent(event);
              return;
            }
            state.activity = 'compressing';
            notifyChange();
            return;
          }

          if (chunk.type === 'compress-end') {
            if (!state) {
              bufferEvent(event);
              return;
            }
            state.activity = undefined;
            notifyChange();
            return;
          }

          if (chunk.type === 'compress-error') {
            if (!state) {
              bufferEvent(event);
              return;
            }
            state.activity = undefined;
            state.error = formatError(chunk.error);
            state.status = 'error';
            notifyChange();
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
            case 'thinking_start':
              nextActivePartType = 'thinking';
              break;
            case 'text_start':
              nextActivePartType = 'text';
              break;
            case 'toolcall_start':
            case 'toolcall_end':
              nextActivePartType = 'toolCall';
              break;
            case 'thinking_end':
            case 'text_end':
            case 'finish':
            case 'error':
              nextActivePartType = undefined;
              break;
          }

          if (chunk.type === 'message-start') {
            ensureAssistantMessage(state, chunk.messageId);
            currentMsgIdRef.current.set(event.sessionId, chunk.messageId);
          }

          if (chunk.type === 'tool-result') {
            const msgId = currentMsgIdRef.current.get(event.sessionId);
            if (msgId) {
              state.messages = state.messages.map((m) => {
                if (m.id === msgId && m.status === 'streaming') {
                  return {
                    ...m,
                    toolResults: {
                      ...m.toolResults,
                      [chunk.toolCallId]: {
                        type: 'toolResult',
                        toolCallId: chunk.toolCallId,
                        toolName: chunk.toolName,
                        output: chunk.output,
                        error: chunk.error,
                      },
                    },
                  };
                }
                return m;
              });
            }
          }

          const msgId = currentMsgIdRef.current.get(event.sessionId);
          if (msgId) {
            const target = state.messages.find((m) => m.id === msgId);
            if (chunk.type !== 'message-start' && (!target || target.status !== 'streaming')) {
              // chunk not appended
            }
            state.messages = state.messages.map((m) => {
              if (m.id === msgId && m.status === 'streaming') {
                const isAssistantEvent =
                  chunk.type === 'text_start' ||
                  chunk.type === 'text_delta' ||
                  chunk.type === 'text_end' ||
                  chunk.type === 'thinking_start' ||
                  chunk.type === 'thinking_delta' ||
                  chunk.type === 'thinking_end' ||
                  chunk.type === 'toolcall_start' ||
                  chunk.type === 'toolcall_delta' ||
                  chunk.type === 'toolcall_end' ||
                  chunk.type === 'start' ||
                  chunk.type === 'done' ||
                  chunk.type === 'error';
                const newParts = isAssistantEvent
                  ? reduceStreamEvent(m.parts, chunk as import('rem-agent-core').AssistantMessageEvent)
                  : m.parts;
                return {
                  ...m,
                  parts: newParts,
                  activePartType: nextActivePartType ?? m.activePartType,
                  status: chunk.type === 'finish' ? 'done'
                    : chunk.type === 'error' ? 'error'
                    : 'streaming',
                  error: chunk.type === 'error' ? formatError(chunk.error) : undefined,
                };
              }
              return m;
            });
          }

          state.status = chunk.type === 'finish' ? 'done'
            : chunk.type === 'error' ? 'error'
            : 'streaming';
          if (chunk.type === 'error') {
            state.error = formatError(chunk.error);
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
          } else if (chunk.type === 'thinking_start' || chunk.type === 'thinking_delta') {
            state.activity = 'thinking';
          } else if (chunk.type === 'toolcall_start' || chunk.type === 'toolcall_end') {
            state.activity = 'calling-function';
            if (chunk.type === 'toolcall_end') {
              state.pendingToolCalls.add(chunk.toolCall.id);
            }
          } else if (chunk.type === 'text_start' || chunk.type === 'text_delta') {
            if (state.pendingToolCalls.size === 0) {
              state.activity = 'outputting';
            }
          } else if (chunk.type === 'step-finish') {
            state.activity = state.pendingToolCalls.size > 0 ? 'calling-function' : 'idle';
            state.pendingToolCalls.clear();
          } else if (chunk.type === 'step-start') {
            state.activity = 'pending';
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
          const errorText = formatError(event.error);
          state.status = 'error';
          state.error = errorText;
          // 把错误文本也写入当前 assistant 消息体，避免只在 error tag 里显示
          const lastAssistant = [...state.messages].reverse().find((m) => m.role === 'assistant');
          if (lastAssistant && lastAssistant.parts.length === 0) {
            lastAssistant.status = 'error';
            lastAssistant.error = errorText;
            lastAssistant.parts.push({ type: 'text', text: errorText });
          }
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
        case 'child-agent-update': {
          if (!state) {
            bufferEvent(event);
            return;
          }
          state.childAgents.set(event.childSessionId, {
            childSessionId: event.childSessionId,
            toolCallId: event.toolCallId,
            summary: event.summary,
            status: event.status,
            tokenUsage: event.tokenUsage,
          });

          setSessionList((prev) => {
            if (prev.some((s) => s.sessionId === event.childSessionId)) return prev;
            return [
              {
                sessionId: event.childSessionId,
                workspace: event.workspace,
                title: event.summary,
                updatedAt: Date.now(),
                messageCount: 0,
                parentSessionId: event.sessionId,
              },
              ...prev,
            ];
          });

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

  const currentSession = useMemo((): SessionView | null => {
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
      childAgents: state.childAgents,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, version]);

  const getSessionState = useCallback((sessionId: string): SessionView | null => {
    const state = sessionMapRef.current.get(sessionId);
    if (!state) return null;
    return {
      id: sessionId,
      messages: state.messages,
      status: state.status,
      error: state.error,
      activity: state.activity,
      pendingApprovals: state.pendingApprovals,
      tokenUsage: state.tokenUsage,
      childAgents: state.childAgents,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const send = useCallback(
    async (content: string) => {
      if (!currentId) return;
      const map = sessionMapRef.current;
      const state = map.get(currentId);
      if (!state) return;

      const userMsg: UIMessage = {
        id: generateUUID(),
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
        await bus.send(workspace, currentId, content);
      } catch (err) {
        state.status = 'error';
        state.error = err instanceof Error ? err.message : 'Send failed';
        notifyChange();
      }
    },
    [currentId, bus, notifyChange, workspace],
  );

  const interrupt = useCallback(async () => {
    if (!currentId) return;
    await bus.interrupt(workspace, currentId);
    const state = sessionMapRef.current.get(currentId);
    if (state) {
      state.status = 'done';
      notifyChange();
    }
  }, [currentId, bus, notifyChange, workspace]);

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
    async (approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>) => {
      if (!currentId) return;
      try {
        await agentService.resolveApproval(workspace, currentId, approvalId, decision, rule);
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
    getSessionState,
    loadSession: ensureSession,
  };
}
