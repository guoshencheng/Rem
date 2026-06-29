import type { SessionSummary } from './types';

export async function runAgent(sessionId: string, input: string): Promise<Response> {
  const res = await fetch('/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, content: input }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to run agent: ${res.status} ${text}`);
  }
  return res;
}

export async function interruptAgent(sessionId: string): Promise<void> {
  await fetch('/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, interrupt: true }),
  });
}

export async function listSessions(q?: string): Promise<SessionSummary[]> {
  const params = q ? `?q=${encodeURIComponent(q)}` : '';
  const res = await fetch(`/api/sessions${params}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to list sessions: ${res.status} ${text}`);
  }
  return res.json() as Promise<SessionSummary[]>;
}

export async function createSession(): Promise<SessionSummary> {
  const res = await fetch('/api/sessions', { method: 'POST' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to create session: ${res.status} ${text}`);
  }
  return res.json() as Promise<SessionSummary>;
}

export async function getSession(sessionId: string): Promise<{ sessionId: string; title?: string; messages: unknown[] }> {
  const res = await fetch(`/api/sessions/${sessionId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to get session: ${res.status} ${text}`);
  }
  return res.json();
}

export async function updateSession(sessionId: string, updates: { title?: string; pinned?: boolean }): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to update session: ${res.status} ${text}`);
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to delete session: ${res.status} ${text}`);
  }
}
