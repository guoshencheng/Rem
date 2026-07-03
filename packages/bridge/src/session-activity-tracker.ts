import type { AgentStreamChunk } from 'rem-agent-core';
import type { SessionActivity } from './types.js';

export interface ActivityState {
  activity: SessionActivity;
  pendingToolCalls: Set<string>;
  updatedAt: number;
}

export type ActivityChangeListener = (sessionId: string, activity: SessionActivity) => void;

export class SessionActivityTracker {
  private state = new Map<string, ActivityState>();

  constructor(private onChange: ActivityChangeListener) {}

  start(sessionId: string): void {
    this.set(sessionId, 'pending');
  }

  finish(sessionId: string): void {
    this.state.delete(sessionId);
    this.onChange(sessionId, 'idle');
  }

  get(sessionId: string): SessionActivity | undefined {
    return this.state.get(sessionId)?.activity;
  }

  applyChunk(sessionId: string, chunk: AgentStreamChunk): void {
    if (chunk.type === 'finish' || chunk.type === 'error') {
      this.finish(sessionId);
      return;
    }

    const current = this.state.get(sessionId);
    if (!current) {
      this.set(sessionId, 'thinking');
    }

    if (chunk.type === 'reasoning-start' || chunk.type === 'reasoning-delta') {
      this.set(sessionId, 'thinking');
      return;
    }

    if (chunk.type === 'tool-call-start' || chunk.type === 'tool-call') {
      const next = this.state.get(sessionId) ?? this.createState('calling-function');
      next.activity = 'calling-function';
      next.pendingToolCalls.add(chunk.toolCallId);
      this.state.set(sessionId, next);
      this.emit(sessionId);
      return;
    }

    if (chunk.type === 'tool-result-start' || chunk.type === 'tool-result' || chunk.type === 'tool-result-finish') {
      const next = this.state.get(sessionId);
      if (next) {
        next.pendingToolCalls.delete(chunk.toolCallId);
        this.state.set(sessionId, next);
        this.emit(sessionId);
      }
      return;
    }

    if (chunk.type === 'text-start' || chunk.type === 'text-delta') {
      const next = this.state.get(sessionId);
      if (next && next.pendingToolCalls.size === 0) {
        this.set(sessionId, 'outputting');
      }
    }
  }

  private createState(activity: SessionActivity): ActivityState {
    return { activity, pendingToolCalls: new Set(), updatedAt: Date.now() };
  }

  private set(sessionId: string, activity: SessionActivity): void {
    const existing = this.state.get(sessionId);
    if (existing) {
      if (existing.activity === activity) return;
      existing.activity = activity;
      existing.updatedAt = Date.now();
      this.state.set(sessionId, existing);
    } else {
      this.state.set(sessionId, this.createState(activity));
    }
    this.emit(sessionId);
  }

  private emit(sessionId: string): void {
    const activity = this.state.get(sessionId)?.activity ?? 'idle';
    this.onChange(sessionId, activity);
  }
}
