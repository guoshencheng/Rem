import type { AgentStreamChunk, AgentStreamStepResult, LanguageModelUsage, ContentPart } from '../types.js';

export function aggregateText(chunks: AgentStreamChunk[]): string {
  return chunks
    .filter((c): c is Extract<AgentStreamChunk, { type: 'text-delta' }> => c.type === 'text-delta')
    .map((c) => c.text)
    .join('');
}

export function aggregateUsage(_chunks: AgentStreamChunk[]): LanguageModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  };
}

export function aggregateSteps(chunks: AgentStreamChunk[]): AgentStreamStepResult[] {
  const stepMap = new Map<number, AgentStreamStepResult>();
  for (const chunk of chunks) {
    if (chunk.type === 'step-start') {
      stepMap.set(chunk.step, { step: chunk.step, text: '', reasoning: '', toolCalls: [] });
    } else if (chunk.type === 'text-delta') {
      const step = stepMap.get(chunk.step) ?? { step: chunk.step, text: '', reasoning: '', toolCalls: [] };
      step.text += chunk.text;
      stepMap.set(chunk.step, step);
    } else if (chunk.type === 'reasoning-delta') {
      const step = stepMap.get(chunk.step) ?? { step: chunk.step, text: '', reasoning: '', toolCalls: [] };
      step.reasoning += chunk.text;
      stepMap.set(chunk.step, step);
    } else if (chunk.type === 'tool-call') {
      const step = stepMap.get(chunk.step) ?? { step: chunk.step, text: '', reasoning: '', toolCalls: [] };
      step.toolCalls.push({
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input,
      });
      stepMap.set(chunk.step, step);
    } else if (chunk.type === 'tool-result') {
      const step = stepMap.get(chunk.step) ?? { step: chunk.step, text: '', reasoning: '', toolCalls: [] };
      const tc = step.toolCalls.find((t) => t.toolCallId === chunk.toolCallId);
      if (tc) {
        tc.output = chunk.output;
        tc.error = chunk.error;
      }
      stepMap.set(chunk.step, step);
    }
  }
  return [...stepMap.values()];
}

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
    case 'message-start': case 'approval-request': case 'approval-resolved':
      return parts;
    default: return parts;
  }
}
