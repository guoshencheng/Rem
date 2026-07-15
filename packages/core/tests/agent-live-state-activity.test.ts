import { describe, it, expect } from 'vitest';
import { AgentLiveState } from '../src/state.js';
import type { AgentStreamEvent, AssistantMessageEvent } from '../src/types.js';
import type { AssistantMessage, ToolCall } from '@earendil-works/pi-ai';

function createPartial(content: AssistantMessage['content']): AssistantMessage {
  return { content } as AssistantMessage;
}

const textPartial = createPartial([]);

describe('AgentLiveState activity', () => {
  it('starts as idle, can be set to pending', () => {
    const state = new AgentLiveState();
    expect(state.activity).toBe('idle');
    state.setActivity('pending');
    expect(state.activity).toBe('pending');
  });

  it('transitions to outputting on text events', () => {
    const state = new AgentLiveState();
    state.start();
    const event: AssistantMessageEvent = { type: 'text_start', contentIndex: 0, partial: textPartial };
    const next = state.applyChunk(event as AgentStreamEvent);
    expect(next).toBe('outputting');
    expect(state.activity).toBe('outputting');
  });

  it('stays calling-function until step-finish after tool call', () => {
    const state = new AgentLiveState();
    state.start();
    const toolCall: ToolCall = { type: 'toolCall', id: 'tc1', name: 'search', arguments: {} };
    const toolPartial = createPartial([toolCall]);
    expect(state.applyChunk({ type: 'toolcall_start', contentIndex: 0, partial: toolPartial } as AgentStreamEvent)).toBe('calling-function');
    expect(state.applyChunk({ type: 'text_start', contentIndex: 1, partial: toolPartial } as AgentStreamEvent)).toBeUndefined();
    expect(state.activity).toBe('calling-function');
    expect(state.applyChunk({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: toolPartial } as AgentStreamEvent)).toBeUndefined();
    expect(state.activity).toBe('calling-function');
    expect(state.applyChunk({ type: 'step-finish', step: 1 } as AgentStreamEvent)).toBe('idle');
    expect(state.activity).toBe('idle');
    expect(state.applyChunk({ type: 'text_delta', contentIndex: 1, delta: 'hi', partial: toolPartial } as AgentStreamEvent)).toBe('outputting');
    expect(state.activity).toBe('outputting');
  });

  it('clears to idle on finish', () => {
    const state = new AgentLiveState();
    state.start();
    state.setActivity('outputting');
    const next = state.applyChunk({ type: 'finish', output: { content: 'hi', completed: true } } as AgentStreamEvent);
    expect(next).toBe('idle');
    expect(state.activity).toBe('idle');
  });

  it('clears to idle on step-finish and text-end', () => {
    const state = new AgentLiveState();
    state.start();
    state.applyChunk({ type: 'text_start', contentIndex: 0, partial: textPartial } as AgentStreamEvent);
    expect(state.activity).toBe('outputting');

    const next = state.applyChunk({ type: 'step-finish', step: 1 } as AgentStreamEvent);
    expect(next).toBe('idle');
    expect(state.activity).toBe('idle');

    expect(state.applyChunk({ type: 'text_end', contentIndex: 0, content: '', partial: textPartial } as AgentStreamEvent)).toBeUndefined();
    expect(state.activity).toBe('idle');
  });

  it('stays calling-function across multiple parallel tool calls until step-finish', () => {
    const state = new AgentLiveState();
    state.start();
    const toolCall1: ToolCall = { type: 'toolCall', id: 'tc1', name: 'a', arguments: {} };
    const toolCall2: ToolCall = { type: 'toolCall', id: 'tc2', name: 'b', arguments: {} };
    const toolPartial = createPartial([toolCall1, toolCall2]);
    state.applyChunk({ type: 'toolcall_start', contentIndex: 0, partial: toolPartial } as AgentStreamEvent);
    state.applyChunk({ type: 'toolcall_start', contentIndex: 1, partial: toolPartial } as AgentStreamEvent);
    expect(state.activity).toBe('calling-function');
    state.applyChunk({ type: 'toolcall_end', contentIndex: 0, toolCall: toolCall1, partial: toolPartial } as AgentStreamEvent);
    expect(state.activity).toBe('calling-function');
    state.applyChunk({ type: 'toolcall_end', contentIndex: 1, toolCall: toolCall2, partial: toolPartial } as AgentStreamEvent);
    expect(state.activity).toBe('calling-function');
    expect(state.applyChunk({ type: 'step-finish', step: 1 } as AgentStreamEvent)).toBe('idle');
    expect(state.activity).toBe('idle');
    expect(state.applyChunk({ type: 'text_delta', contentIndex: 2, delta: 'x', partial: toolPartial } as AgentStreamEvent)).toBe('outputting');
    expect(state.activity).toBe('outputting');
  });
});
