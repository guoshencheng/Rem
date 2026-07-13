'use client';

import { useEffect, useState, useCallback } from 'react';
import type { IAgentService } from 'rem-agent-bridge/client';
import type { TodoItem } from 'rem-agent-core';
import { useAgentBus } from './use-agent-bus';

export function useTodos(agentService: IAgentService, workspace: string, sessionId: string | null) {
  const { onEvent } = useAgentBus(agentService, workspace);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchTodos = useCallback(async () => {
    if (!sessionId) return;
    try {
      const list = await agentService.getTodos(workspace, sessionId);
      setTodos(list);
    } catch {
      // ignore
    } finally {
      setLoaded(true);
    }
  }, [agentService, workspace, sessionId]);

  useEffect(() => {
    setTodos([]);
    setLoaded(false);
    fetchTodos();
  }, [fetchTodos]);

  useEffect(() => {
    const handleEvent = (event: import('rem-agent-bridge/client').BusEvent) => {
      if (event.workspace !== workspace) return;
      if (event.sessionId !== sessionId) return;
      if (event.type === 'todo-updated') {
        setTodos(event.todos);
      }
    };
    return onEvent(handleEvent);
  }, [onEvent, workspace, sessionId]);

  return { todos, loaded };
}
