import { describe, it, expect } from 'vitest';
import { AgentLiveState } from '../src/state.js';
import type { AgentStreamChunk } from '../src/types.js';

describe('AgentLiveState activity', () => {
  it('starts as idle, can be set to pending', () => {
    const state = new AgentLiveState();
    expect(state.activity).toBe('idle');
    state.setActivity('pending');
    expect(state.activity).toBe('pending');
  });

  it('transitions to outputting on text chunks', () => {
    const state = new AgentLiveState();
    state.start();
    const next = state.applyChunk({ type: 'text-start', step: 1, partId: 'p1' } as AgentStreamChunk);
    expect(next).toBe('outputting');
    expect(state.activity).toBe('outputting');
  });

  it('stays calling-function until tool result finishes', () => {
    const state = new AgentLiveState();
    state.start();
    expect(state.applyChunk({ type: 'tool-call', step: 1, partId: 'p1', toolCallId: 'tc1', toolName: 'search', input: {} } as AgentStreamChunk)).toBe('calling-function');
    expect(state.applyChunk({ type: 'text-start', step: 1, partId: 'p2' } as AgentStreamChunk)).toBeUndefined();
    expect(state.activity).toBe('calling-function');
    expect(state.applyChunk({ type: 'tool-result-finish', step: 1, partId: 'p1', toolCallId: 'tc1' } as AgentStreamChunk)).toBeUndefined();
    expect(state.activity).toBe('calling-function');
    expect(state.applyChunk({ type: 'text-delta', step: 1, partId: 'p2', text: 'hi' } as AgentStreamChunk)).toBe('outputting');
    expect(state.activity).toBe('outputting');
  });

  it('clears to idle on finish', () => {
    const state = new AgentLiveState();
    state.start();
    state.setActivity('outputting');
    const next = state.applyChunk({ type: 'finish', output: { content: 'hi', completed: true } } as AgentStreamChunk);
    expect(next).toBe('idle');
    expect(state.activity).toBe('idle');
  });

  it('clears to idle on step-finish and finish chunks', () => {
    const state = new AgentLiveState();
    state.start();
    state.applyChunk({ type: 'text-start', step: 1, partId: 'p1' } as AgentStreamChunk);
    expect(state.activity).toBe('outputting');

    const next = state.applyChunk({ type: 'step-finish', step: 1 } as AgentStreamChunk);
    expect(next).toBe('idle');
    expect(state.activity).toBe('idle');

    expect(state.applyChunk({ type: 'text-finish', step: 1, partId: 'p1' } as AgentStreamChunk)).toBeUndefined();
    expect(state.activity).toBe('idle');
  });

  it('stays calling-function across multiple parallel tool calls', () => {
    const state = new AgentLiveState();
    state.start();
    state.applyChunk({ type: 'tool-call', step: 1, partId: 'p1', toolCallId: 'tc1', toolName: 'a', input: {} } as AgentStreamChunk);
    state.applyChunk({ type: 'tool-call', step: 1, partId: 'p2', toolCallId: 'tc2', toolName: 'b', input: {} } as AgentStreamChunk);
    expect(state.activity).toBe('calling-function');
    state.applyChunk({ type: 'tool-result-finish', step: 1, partId: 'p1', toolCallId: 'tc1' } as AgentStreamChunk);
    expect(state.activity).toBe('calling-function');
    state.applyChunk({ type: 'tool-result-finish', step: 1, partId: 'p2', toolCallId: 'tc2' } as AgentStreamChunk);
    expect(state.activity).toBe('calling-function');
    expect(state.applyChunk({ type: 'text-delta', step: 1, partId: 'p3', text: 'x' } as AgentStreamChunk)).toBe('outputting');
    expect(state.activity).toBe('outputting');
  });
});
