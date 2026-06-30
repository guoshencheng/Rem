import type { AgentStreamChunk, ContentPart } from 'rem-agent-core';

function updateLast<T>(parts: T[], fn: (p: T) => T): T[] {
  if (parts.length === 0) return parts;
  return [...parts.slice(0, -1), fn(parts[parts.length - 1])];
}

export function reduceStreamChunk(parts: ContentPart[], chunk: AgentStreamChunk): ContentPart[] {
  const last = parts[parts.length - 1];
  switch (chunk.type) {
    case 'text-start':
      return [...parts, { type: 'text', text: '' }];
    case 'text-delta':
      if (last?.type === 'text') return updateLast(parts, p => p.type === 'text' ? { ...p, text: p.text + chunk.text } : p);
      return [...parts, { type: 'text', text: chunk.text }];
    case 'reasoning-start':
      return [...parts, { type: 'reasoning', text: '' }];
    case 'reasoning-delta':
      if (last?.type === 'reasoning') return updateLast(parts, p => p.type === 'reasoning' ? { ...p, text: p.text + chunk.text } : p);
      return [...parts, { type: 'reasoning', text: chunk.text }];
    case 'tool-call-start':
      return [...parts, { type: 'tool-call', toolCallId: chunk.toolCallId, toolName: chunk.toolName, arguments: undefined }];
    case 'tool-call':
      return parts.map(p => p.type === 'tool-call' && p.toolCallId === chunk.toolCallId ? { ...p, arguments: chunk.input } : p);
    case 'tool-result-start':
      return [...parts, { type: 'tool-result', toolCallId: chunk.toolCallId, toolName: chunk.toolName, output: '' }];
    case 'tool-result':
      return parts.map(p => p.type === 'tool-result' && p.toolCallId === chunk.toolCallId ? { ...p, output: chunk.output, error: chunk.error } : p);
    case 'text-finish': case 'reasoning-finish': case 'tool-call-finish': case 'tool-result-finish':
    case 'step-start': case 'step-finish': case 'finish': case 'error': case 'session-title':
      return parts;
    default: return parts;
  }
}
