import type { AgentStreamChunk } from 'rem-agent-core';
import type { BusEvent } from './types.js';
import type { IAgentService } from './agent-service.interface.js';
import type {
  RunRequest,
  SessionSummary,
  SessionUpdate,
  InterruptRequest,
  ResetRequest,
  UIMessage,
} from './types.js';
import { parseSSEStream, parseAgentStreamEvent } from './sse.js';

export class AgentRemoteService implements IAgentService {
  constructor(private baseUrl: string) {}

  async run(
    sessionId: string,
    input: string,
  ): Promise<AsyncIterable<AgentStreamChunk>> {
    const response = await fetch(`${this.baseUrl}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, content: input } satisfies RunRequest),
    });

    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to start run: ${response.status} ${response.statusText}`,
      );
    }

    const reader = response.body.getReader();
    const events = parseSSEStream(reader);

    return {
      [Symbol.asyncIterator]: async function* () {
        for await (const event of events) {
          if (
            event.event === 'chunk' ||
            event.event === 'error'
          ) {
            yield parseAgentStreamEvent(event);
          }
        }
      },
    };
  }

  async interrupt(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/agent/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId } satisfies InterruptRequest),
    });
    if (!response.ok) {
      throw new Error(`Failed to interrupt: ${response.status}`);
    }
  }

  async reset(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/agent/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId } satisfies ResetRequest),
    });
    if (!response.ok) {
      throw new Error(`Failed to reset: ${response.status}`);
    }
  }

  async createSession(): Promise<SessionSummary> {
    const response = await fetch(`${this.baseUrl}/api/sessions`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status}`);
    }
    return (await response.json()) as SessionSummary;
  }

  async listSessions(): Promise<SessionSummary[]> {
    const response = await fetch(`${this.baseUrl}/api/sessions`);
    if (!response.ok) {
      throw new Error(`Failed to list sessions: ${response.status}`);
    }
    return (await response.json()) as SessionSummary[];
  }

  async getMessages(sessionId: string): Promise<UIMessage[]> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}`);
    if (!response.ok) {
      throw new Error(`Failed to get messages: ${response.status}`);
    }
    const data = (await response.json()) as { messages?: UIMessage[] };
    return data.messages ?? [];
  }

  async updateSession(sessionId: string, updates: SessionUpdate): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      throw new Error(`Failed to update session: ${response.status}`);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(`Failed to delete session: ${response.status}`);
    }
  }

  async *stream(): AsyncIterable<BusEvent> {
    console.log('[RemoteSSE] connecting to /api/agent/stream');
    const response = await fetch(`${this.baseUrl}/api/agent/stream`);
    if (!response.ok || !response.body) {
      console.error('[RemoteSSE] connect failed', response.status);
      throw new Error(`Failed to connect stream: ${response.status} ${response.statusText}`);
    }
    console.log('[RemoteSSE] connected, reading stream');

    const reader = response.body.getReader();
    const events = parseSSEStream(reader);

    let count = 0;
    for await (const event of events) {
      if (event.event === 'bus' && event.data) {
        try {
          const parsed = JSON.parse(event.data) as BusEvent;
          count++;
          console.log(`[RemoteSSE] event #${count} session=${parsed.sessionId} type=${parsed.type}`);
          yield parsed;
        } catch {
          // skip malformed events
        }
      }
    }
  }
}
