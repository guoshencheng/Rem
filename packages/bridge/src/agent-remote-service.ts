import type { ApprovalDecision, ApprovalRequest } from 'rem-agent-core';
import type { BusEvent } from './types.js';
import type { IAgentService } from './agent-service.interface.js';
import type {
  SessionSummary,
  SessionUpdate,
  InterruptRequest,
  ResetRequest,
  UIMessage,
  Workspace,
} from './types.js';
import { parseSSEStream } from './sse.js';

export class AgentRemoteService implements IAgentService {
  constructor(
    private baseUrl: string,
    private workspace: string,
  ) {}

  async init(): Promise<void> {
    // Remote client requires no local initialization.
  }

  private workspaceQuery(): string {
    return `workspace=${encodeURIComponent(this.workspace)}`;
  }

  async run(_workspace: string, sessionId: string, input: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/agent/run?${this.workspaceQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, content: input }),
    });

    if (!response.ok) {
      throw new Error(`Agent run failed: ${response.status}`);
    }
  }

  async interrupt(_workspace: string, sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/agent/interrupt?${this.workspaceQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId } satisfies InterruptRequest),
    });
    if (!response.ok) {
      throw new Error(`Failed to interrupt: ${response.status}`);
    }
  }

  async reset(_workspace: string, sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/agent/reset?${this.workspaceQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId } satisfies ResetRequest),
    });
    if (!response.ok) {
      throw new Error(`Failed to reset: ${response.status}`);
    }
  }

  async createSession(_workspace: string): Promise<SessionSummary> {
    const response = await fetch(`${this.baseUrl}/api/sessions?${this.workspaceQuery()}`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as SessionSummary;
  }

  async listSessions(_workspace: string): Promise<SessionSummary[]> {
    const response = await fetch(`${this.baseUrl}/api/sessions?${this.workspaceQuery()}`);
    if (!response.ok) {
      throw new Error(`Failed to list sessions: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as SessionSummary[];
  }

  async getMessages(_workspace: string, sessionId: string): Promise<UIMessage[]> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}?${this.workspaceQuery()}`);
    if (!response.ok) {
      throw new Error(`Failed to get messages: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { messages?: UIMessage[] };
    return data.messages ?? [];
  }

  async updateSession(_workspace: string, sessionId: string, updates: SessionUpdate): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}?${this.workspaceQuery()}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      throw new Error(`Failed to update session: ${response.status} ${response.statusText}`);
    }
  }

  async deleteSession(_workspace: string, sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}?${this.workspaceQuery()}`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(`Failed to delete session: ${response.status} ${response.statusText}`);
    }
  }

  async listPendingApprovals(_workspace: string, sessionId: string): Promise<ApprovalRequest[]> {
    const response = await fetch(`${this.baseUrl}/api/approvals?${this.workspaceQuery()}&sessionId=${encodeURIComponent(sessionId)}`);
    if (!response.ok) {
      throw new Error(`Failed to list pending approvals: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as ApprovalRequest[];
  }

  async resolveApproval(_workspace: string, sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/api/approvals/${encodeURIComponent(approvalId)}/resolve?${this.workspaceQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, decision }),
    });
    if (!response.ok) {
      throw new Error(`Failed to resolve approval: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as boolean;
  }

  async *stream(_workspace: string): AsyncIterable<BusEvent> {
    const response = await fetch(`${this.baseUrl}/api/agent/stream?${this.workspaceQuery()}`);
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

  async listWorkspaces(): Promise<Workspace[]> {
    const response = await fetch(`${this.baseUrl}/api/workspaces`);
    if (!response.ok) {
      throw new Error(`Failed to list workspaces: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as Workspace[];
  }

  async addWorkspace(path: string, name?: string): Promise<Workspace> {
    const response = await fetch(`${this.baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name }),
    });
    if (!response.ok) {
      throw new Error(`Failed to add workspace: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as Workspace;
  }

  async removeWorkspace(path: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/workspaces`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!response.ok) {
      throw new Error(`Failed to remove workspace: ${response.status} ${response.statusText}`);
    }
  }
}
