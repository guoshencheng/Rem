'use client';

import { useState } from 'react';
import type { TodoItem } from 'rem-agent-core';

interface TodoPanelProps {
  todos: TodoItem[];
}

const statusLabels: Record<TodoItem['status'], string> = {
  pending: 'pending',
  in_progress: 'in_progress',
  completed: 'completed',
  cancelled: 'cancelled',
};

const statusClasses: Record<TodoItem['status'], string> = {
  pending: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-400',
};

const priorityClasses: Record<TodoItem['priority'], string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-green-100 text-green-800',
};

export function TodoPanel({ todos }: TodoPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const pendingCount = todos.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length;

  if (todos.length === 0) return null;

  return (
    <div className="border border-bd rounded-card overflow-hidden bg-card mb-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-2 flex items-center justify-between bg-bg-soft border-b border-bd"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">Tasks</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">
            {pendingCount} pending
          </span>
        </div>
        <span className="text-sm text-tx2">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <ul className="px-4 py-2 space-y-2">
          {todos.map((todo, index) => (
            <li key={index} className="flex items-center gap-3 text-sm">
              <span className="text-tx2 w-5 text-right">{index + 1}.</span>
              <span
                className={`flex-1 ${
                  todo.status === 'completed' || todo.status === 'cancelled'
                    ? 'line-through text-tx2'
                    : ''
                }`}
              >
                {todo.content}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${statusClasses[todo.status]}`}>
                {statusLabels[todo.status]}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${priorityClasses[todo.priority]}`}>
                {todo.priority}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
