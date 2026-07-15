import type { AssistantMessageEvent, TextContent, ThinkingContent, ToolCall, Usage } from '@earendil-works/pi-ai';
import type { AgentStreamEvent, AgentStreamStepResult } from '../types.js';
import { addUsage, emptyUsage } from '../token-usage.js';

export function aggregateText(events: AgentStreamEvent[]): string {
  return events
    .filter((e): e is Extract<AssistantMessageEvent, { type: 'text_delta' }> => e.type === 'text_delta')
    .map((e) => e.delta)
    .join('');
}

export function aggregateUsage(events: AgentStreamEvent[]): Usage {
  return events
    .filter((e): e is Extract<AssistantMessageEvent, { type: 'done' }> => e.type === 'done')
    .map((e) => e.message.usage)
    .reduce((acc, usage) => addUsage(acc, usage), emptyUsage());
}

export function aggregateSteps(events: AgentStreamEvent[]): AgentStreamStepResult[] {
  const stepMap = new Map<number, AgentStreamStepResult>();
  let currentStep = 1;
  for (const event of events) {
    if (event.type === 'step-start') {
      currentStep = event.step;
      stepMap.set(currentStep, { step: currentStep, text: '', reasoning: '', toolCalls: [] });
    } else if (event.type === 'text_delta') {
      const step = stepMap.get(currentStep) ?? { step: currentStep, text: '', reasoning: '', toolCalls: [] };
      step.text += event.delta;
      stepMap.set(currentStep, step);
    } else if (event.type === 'thinking_delta') {
      const step = stepMap.get(currentStep) ?? { step: currentStep, text: '', reasoning: '', toolCalls: [] };
      step.reasoning += event.delta;
      stepMap.set(currentStep, step);
    } else if (event.type === 'toolcall_end') {
      const step = stepMap.get(currentStep) ?? { step: currentStep, text: '', reasoning: '', toolCalls: [] };
      step.toolCalls.push({
        toolCallId: event.toolCall.id,
        toolName: event.toolCall.name,
        input: event.toolCall.arguments,
      });
      stepMap.set(currentStep, step);
    }
  }
  return [...stepMap.values()];
}

export type StreamingContentBlock = TextContent | ThinkingContent | ToolCall;

export function reduceStreamEvent(
  parts: Array<StreamingContentBlock | undefined>,
  event: AssistantMessageEvent,
): Array<StreamingContentBlock | undefined> {
  const next = [...parts];
  switch (event.type) {
    case 'text_start':
      next[event.contentIndex] = { type: 'text', text: '' };
      break;
    case 'text_delta': {
      const existing = next[event.contentIndex];
      if (existing?.type === 'text') {
        next[event.contentIndex] = { type: 'text', text: existing.text + event.delta };
      } else {
        next[event.contentIndex] = { type: 'text', text: event.delta };
      }
      break;
    }
    case 'thinking_start':
      next[event.contentIndex] = { type: 'thinking', thinking: '' };
      break;
    case 'thinking_delta': {
      const existing = next[event.contentIndex];
      if (existing?.type === 'thinking') {
        next[event.contentIndex] = { type: 'thinking', thinking: existing.thinking + event.delta };
      } else {
        next[event.contentIndex] = { type: 'thinking', thinking: event.delta };
      }
      break;
    }
    case 'toolcall_end':
      next[event.contentIndex] = event.toolCall;
      break;
    case 'text_end':
    case 'thinking_end':
    case 'toolcall_start':
    case 'toolcall_delta':
    case 'start':
    case 'done':
    case 'error':
      break;
  }
  return next;
}

export function compactContentBlocks(
  parts: Array<StreamingContentBlock | undefined>,
): StreamingContentBlock[] {
  return parts.filter((p): p is StreamingContentBlock => p !== undefined);
}
