import type { AgentStreamChunk, AgentStreamStepResult, LanguageModelUsage } from '../types.js';

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
