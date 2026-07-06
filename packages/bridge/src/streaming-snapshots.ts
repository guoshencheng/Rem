import type { ContentPart } from 'rem-agent-core';

export interface SnapshotEntry {
  messageId: string;
  parts: ContentPart[];
}

class StreamingSnapshots {
  private map = new Map<string, SnapshotEntry>();

  start(sessionId: string, messageId: string): void {
    this.map.set(sessionId, { messageId, parts: [] });
  }

  update(sessionId: string, parts: ContentPart[]): void {
    const entry = this.map.get(sessionId);
    if (entry) entry.parts = parts;
  }

  get(sessionId: string): SnapshotEntry | undefined {
    return this.map.get(sessionId);
  }

  clear(sessionId: string): void {
    this.map.delete(sessionId);
  }

  runningSessionIds(): string[] {
    return [...this.map.keys()];
  }
}

const globalKey = Symbol.for('rem.streaming-snapshots');
export const streamingSnapshots: StreamingSnapshots =
  (globalThis as Record<symbol, StreamingSnapshots>)[globalKey]
  ?? ((globalThis as Record<symbol, StreamingSnapshots>)[globalKey] = new StreamingSnapshots());
