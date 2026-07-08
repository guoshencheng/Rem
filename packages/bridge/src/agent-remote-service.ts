import type { ApprovalDecision, ApprovalRequest } from 'rem-agent-core';
import type { BusEvent } from './types.js';
import type { IAgentService } from './agent-service.interface.js';
import type {
  SessionSummary,
  SessionUpdate,
  InterruptRequest,
  ResetRequest,
  UIMessage,
} from './types.js';
import { parseSSEStream } from './sse.js';

export class AgentRemoteService implements IAgentService {
  constructor(private baseUrl: string) {}

  async init(): Promise<void> {
    // Remote client requires no local initialization.
  }

  async run(sessionId: string, input: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, content: input }),
    });

    if (!response.ok) {
      throw new Error(`Agent run failed: ${response.status}`);
    }
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
      throw new Error(`Failed to create session: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as SessionSummary;
  }

  async listSessions(): Promise<SessionSummary[]> {
    const response = await fetch(`${this.baseUrl}/api/sessions`);
    if (!response.ok) {
      throw new Error(`Failed to list sessions: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as SessionSummary[];
  }

  async getMessages(sessionId: string): Promise<UIMessage[]> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`);
    if (!response.ok) {
      throw new Error(`Failed to get messages: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { messages?: UIMessage[] };
    return data.messages ?? [];
  }

  async updateSession(sessionId: string, updates: SessionUpdate): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      throw new Error(`Failed to update session: ${response.status} ${response.statusText}`);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(`Failed to delete session: ${response.status} ${response.statusText}`);
    }
  }

  async listPendingApprovals(sessionId: string): Promise<ApprovalRequest[]> {
    const response = await fetch(`${this.baseUrl}/api/approvals?sessionId=${encodeURIComponent(sessionId)}`);
    if (!response.ok) {
      throw new Error(`Failed to list pending approvals: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as ApprovalRequest[];
  }

  async resolveApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/api/approvals/${encodeURIComponent(approvalId)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, decision }),
    });
    if (!response.ok) {
      throw new Error(`Failed to resolve approval: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as boolean;
  }

  async *stream(): AsyncIterable<BusEvent> {
    const response = await fetch(`${this.baseUrl}/api/agent/stream`);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to connect stream: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const events = parseSSEStream(reader);

    for await (const event of events) {
      if (event.event === 'bus' && event.data) {
        try {
          const parsed = JSON.parse(event.data) as BusEvent;
          yield parsed;
        } catch {
          // skip malformed events
        }
      }
    }
  }
}
