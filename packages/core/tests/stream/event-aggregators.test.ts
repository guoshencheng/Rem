import { describe, it, expect } from 'vitest';
import {
  aggregateText,
  aggregateUsage,
  aggregateSteps,
  reduceStreamEvent,
  compactContentBlocks,
} from '../../src/stream/event-aggregators.js';
import type { AssistantMessageEvent, AssistantMessage } from '@earendil-works/pi-ai';

describe('event-aggregators', () => {
  it('aggregates text from text_delta events', () => {
    const events: AssistantMessageEvent[] = [
      { type: 'text_delta', contentIndex: 0, delta: 'Hello ', partial: {} as AssistantMessage },
      { type: 'text_delta', contentIndex: 0, delta: 'world', partial: {} as AssistantMessage },
    ];
    expect(aggregateText(events)).toBe('Hello world');
  });

  it('aggregates usage from done events', () => {
    const events: AssistantMessageEvent[] = [
      {
        type: 'done',
        reason: 'stop',
        message: {
          content: [],
          usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        } as AssistantMessage,
      },
    ];
    const usage = aggregateUsage(events);
    expect(usage.input).toBe(10);
    expect(usage.output).toBe(5);
    expect(usage.totalTokens).toBe(15);
  });

  it('aggregates steps from meta and assistant events', () => {
    const events: unknown[] = [
      { type: 'step-start', step: 1 },
      { type: 'text_delta', contentIndex: 0, delta: 'hello', partial: {} as AssistantMessage },
      { type: 'thinking_delta', contentIndex: 1, delta: 'thinking', partial: {} as AssistantMessage },
      {
        type: 'toolcall_end',
        contentIndex: 2,
        toolCall: { type: 'toolCall', id: 'tc1', name: 'read', arguments: { path: 'x' } },
        partial: {} as AssistantMessage,
      },
    ];
    const steps = aggregateSteps(events as AssistantMessageEvent[]);
    expect(steps).toHaveLength(1);
    expect(steps[0].text).toBe('hello');
    expect(steps[0].reasoning).toBe('thinking');
    expect(steps[0].toolCalls).toHaveLength(1);
    expect(steps[0].toolCalls[0].toolName).toBe('read');
  });

  it('reduces text events into content blocks', () => {
    let parts = reduceStreamEvent([], { type: 'text_start', contentIndex: 0, partial: {} as AssistantMessage });
    parts = reduceStreamEvent(parts, { type: 'text_delta', contentIndex: 0, delta: 'hello', partial: {} as AssistantMessage });
    const compact = compactContentBlocks(parts);
    expect(compact).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('reduces thinking and toolcall events', () => {
    let parts = reduceStreamEvent([], { type: 'thinking_start', contentIndex: 0, partial: {} as AssistantMessage });
    parts = reduceStreamEvent(parts, { type: 'thinking_delta', contentIndex: 0, delta: 'reasoning', partial: {} as AssistantMessage });
    parts = reduceStreamEvent(parts, {
      type: 'toolcall_end',
      contentIndex: 1,
      toolCall: { type: 'toolCall', id: 'tc1', name: 'tool', arguments: {} },
      partial: {} as AssistantMessage,
    });
    const compact = compactContentBlocks(parts);
    expect(compact).toEqual([
      { type: 'thinking', thinking: 'reasoning' },
      { type: 'toolCall', id: 'tc1', name: 'tool', arguments: {} },
    ]);
  });
});
