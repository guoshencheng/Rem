import type { BusEvent } from 'rem-agent-core';
import { REMSession } from './rem-session.js';

/** Map<sessionId, REMSession> 管理器 */
export class REMSessions {
  private readonly sessions = new Map<string, REMSession>();

  constructor(private readonly publish: (event: BusEvent) => void) {}

  get(sessionId: string): REMSession | undefined {
    return this.sessions.get(sessionId);
  }

  getOrCreate(sessionId: string, workspace: string): REMSession {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = new REMSession({ sessionId, workspace, publish: this.publish });
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  running(): REMSession[] {
    return [...this.sessions.values()].filter((s) => s.status === 'running');
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
