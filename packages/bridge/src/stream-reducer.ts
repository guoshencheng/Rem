import type { AgentStreamChunk } from 'rem-agent-core';

export interface StreamPart {
  id: string;
  type: 'text' | 'reasoning' | 'tool';
  content: string;
  startTime?: number;
  duration?: number;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: string;
  error?: string;
  status?: 'pending' | 'running' | 'success' | 'error';
}

export function reduceStreamChunk(parts: StreamPart[], chunk: AgentStreamChunk): StreamPart[] {
  switch (chunk.type) {
    case 'text-start':
      return [...parts, { id: chunk.partId, type: 'text', content: '' }];
    case 'text-delta':
      return updateLast(parts, p => ({ ...p, content: p.content + chunk.text }));
    case 'text-finish':
      return parts;
    case 'reasoning-start':
      return [...parts, { id: chunk.partId, type: 'reasoning', content: '', startTime: Date.now() }];
    case 'reasoning-delta':
      return updateLast(parts, p => ({ ...p, content: (p.content || '') + chunk.text }));
    case 'reasoning-finish':
      return updateLast(parts, p => ({ ...p, duration: Date.now() - (p.startTime || Date.now()) }));
    case 'tool-call-start':
      return [...parts, {
        id: chunk.partId,
        type: 'tool',
        content: '',
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        status: 'pending',
      }];
    case 'tool-call':
      return updateLastForId(parts, chunk.partId, p => ({ ...p, input: chunk.input }));
    case 'tool-call-finish':
      return parts;
    case 'tool-result-start':
      return updateLastForId(parts, chunk.partId, p => ({ ...p, status: 'running' }));
    case 'tool-result':
      return updateLastForId(parts, chunk.partId, p => ({
        ...p,
        output: chunk.output,
        error: chunk.error,
        status: chunk.error ? 'error' : 'success',
      }));
    case 'tool-result-finish':
      return parts;
    case 'step-start':
    case 'step-finish':
    case 'finish':
    case 'error':
    case 'session-title':
      return parts;
    default:
      return parts;
  }
}

function updateLast(parts: StreamPart[], fn: (p: StreamPart) => StreamPart): StreamPart[] {
  if (parts.length === 0) return parts;
  return [...parts.slice(0, -1), fn(parts[parts.length - 1])];
}

function updateLastForId(parts: StreamPart[], id: string, fn: (p: StreamPart) => StreamPart): StreamPart[] {
  return parts.map(p => p.id === id ? fn(p) : p);
}
