import { describe, it, expect, vi } from 'vitest';
import type { AgentStreamChunk } from 'rem-agent-core';
import { SessionActivityTracker } from '../src/session-activity-tracker.js';

describe('SessionActivityTracker', () => {
  it('starts as thinking', () => {
    const listener = vi.fn();
    const tracker = new SessionActivityTracker(listener);
    tracker.start('s1');
    expect(tracker.get('s1')).toBe('thinking');
    expect(listener).toHaveBeenCalledWith('s1', 'thinking');
  });

  it('transitions to outputting on text chunks', () => {
    const listener = vi.fn();
    const tracker = new SessionActivityTracker(listener);
    tracker.start('s1');
    listener.mockClear();
    tracker.applyChunk('s1', { type: 'text-start', step: 1, partId: 'p1' } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('outputting');
    expect(listener).toHaveBeenCalledWith('s1', 'outputting');
  });

  it('stays calling-function until tool result finishes', () => {
    const listener = vi.fn();
    const tracker = new SessionActivityTracker(listener);
    tracker.start('s1');
    listener.mockClear();
    tracker.applyChunk('s1', { type: 'tool-call', step: 1, partId: 'p1', toolCallId: 'tc1', toolName: 'search', input: {} } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('calling-function');
    tracker.applyChunk('s1', { type: 'text-start', step: 1, partId: 'p2' } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('calling-function');
    tracker.applyChunk('s1', { type: 'tool-result-finish', step: 1, partId: 'p1', toolCallId: 'tc1' } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('calling-function');
    tracker.applyChunk('s1', { type: 'text-delta', step: 1, partId: 'p2', text: 'hi' } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('outputting');
  });

  it('clears to idle on finish', () => {
    const listener = vi.fn();
    const tracker = new SessionActivityTracker(listener);
    tracker.start('s1');
    tracker.applyChunk('s1', { type: 'finish', output: { content: 'hi', completed: true } } as AgentStreamChunk);
    expect(tracker.get('s1')).toBeUndefined();
    expect(listener).toHaveBeenLastCalledWith('s1', 'idle');
  });

  it('stays calling-function across multiple parallel tool calls', () => {
    const listener = vi.fn();
    const tracker = new SessionActivityTracker(listener);
    tracker.start('s1');
    listener.mockClear();
    tracker.applyChunk('s1', { type: 'tool-call', step: 1, partId: 'p1', toolCallId: 'tc1', toolName: 'a', input: {} } as AgentStreamChunk);
    tracker.applyChunk('s1', { type: 'tool-call', step: 1, partId: 'p2', toolCallId: 'tc2', toolName: 'b', input: {} } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('calling-function');
    tracker.applyChunk('s1', { type: 'tool-result-finish', step: 1, partId: 'p1', toolCallId: 'tc1' } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('calling-function');
    tracker.applyChunk('s1', { type: 'tool-result-finish', step: 1, partId: 'p2', toolCallId: 'tc2' } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('calling-function');
    tracker.applyChunk('s1', { type: 'text-delta', step: 1, partId: 'p3', text: 'x' } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('outputting');
  });
});
