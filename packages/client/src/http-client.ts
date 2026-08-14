import type { AgentDefinition, Artifact, Run, RunEvent, RuntimeSessionEntry, RuntimeSessionSummary, Session, StartRunInput, ContextPatch, RunExecutionNode, RunExecutionEntry, RunDelivery, RuntimeToolInvocation, ToolInvocationResolution, RuntimeHealth } from 'rem-agent-core';
import { RuntimeClientError } from './client-error.js';
import { decodeArtifact, decodeDelivery, decodeEvent, decodeExecutionEntry, decodeExecutionNode, decodeHealth, decodeMessageCount, decodeRun, decodeSession, decodeSessionEntry, decodeToolInvocation } from './wire-values.js';
import type { ListEventsOptions, RuntimeClientOptions } from './types.js';

export class RuntimeHttpClient {
  readonly baseUrl: string;
  private readonly requestFetch: typeof globalThis.fetch;
  private readonly defaultHeaders: Headers;

  constructor(options: RuntimeClientOptions) {
    if (typeof options.baseUrl !== 'string') throw new TypeError('RuntimeClient baseUrl must be a string');
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.requestFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.defaultHeaders = new Headers(options.headers);
  }

  async listAgents(): Promise<AgentDefinition[]> {
    return this.request<AgentDefinition[]>('/v1/agents');
  }

  async getHealth(): Promise<RuntimeHealth> {
    const headers = new Headers(this.defaultHeaders);
    const response = await this.requestFetch(`${this.baseUrl}/v1/health`, { method: 'GET', headers });
    if (response.status !== 200 && response.status !== 503) throw await parseError(response);
    try { return decodeHealth(await response.json()); }
    catch (error) {
      if (error instanceof RuntimeClientError) throw error;
      throw new RuntimeClientError('INTERNAL_ERROR', 'Service returned invalid health JSON', response.status, false, undefined, { cause: error });
    }
  }

  async getAgent(agentId: string, revision?: string): Promise<AgentDefinition> {
    const query = revision === undefined ? '' : `?revision=${encodeURIComponent(revision)}`;
    return this.request<AgentDefinition>(`/v1/agents/${encodeURIComponent(agentId)}${query}`);
  }

  async getSession(sessionId: string): Promise<Session> {
    return decodeSession(await this.request<Session>(`/v1/sessions/${encodeURIComponent(sessionId)}`));
  }

  async patchSessionContexts(sessionId: string, patch: ContextPatch, expectedVersion: number): Promise<Session> {
    return decodeSession(await this.request<Session>(`/v1/sessions/${encodeURIComponent(sessionId)}/contexts`, { method: 'PATCH', body: { patch, expectedVersion } }));
  }

  async listSessions(): Promise<RuntimeSessionSummary[]> {
    const sessions = await this.request<RuntimeSessionSummary[]>('/v1/sessions');
    return sessions.map((session) => ({ ...decodeSession(session), messageCount: decodeMessageCount(session.messageCount) }));
  }

  async createSession(): Promise<Session> {
    return decodeSession(await this.request<Session>('/v1/sessions', { method: 'POST', body: {} }));
  }

  async listSessionEntries(sessionId: string): Promise<RuntimeSessionEntry[]> {
    const entries = await this.request<RuntimeSessionEntry[]>(`/v1/sessions/${encodeURIComponent(sessionId)}/entries`);
    return entries.map(decodeSessionEntry);
  }

  async startRun(input: StartRunInput): Promise<Run> {
    const headers = input.idempotencyKey === undefined ? undefined : { 'Idempotency-Key': input.idempotencyKey };
    const { idempotencyKey: _ignored, ...body } = input;
    return decodeRun(await this.request<Run>('/v1/runs', { method: 'POST', body, headers }));
  }

  async listRuns(options: { sessionId?: string; status?: Run['status']; cursor?: string; limit?: number } = {}): Promise<{ items: Run[]; nextCursor?: string }> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) if (value !== undefined) query.set(key, String(value));
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    const result = await this.request<{ items: Run[]; nextCursor?: string }>(`/v1/runs${suffix}`);
    return { ...result, items: result.items.map(decodeRun) };
  }

  async getRun(runId: string): Promise<Run> {
    return decodeRun(await this.request<Run>(`/v1/runs/${encodeURIComponent(runId)}`));
  }

  async cancelRun(runId: string): Promise<Run> {
    return decodeRun(await this.request<Run>(`/v1/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }));
  }

  async listEvents(runId: string, options?: ListEventsOptions): Promise<RunEvent[]> {
    const query = new URLSearchParams();
    if (options?.afterSequence !== undefined) query.set('afterSequence', String(options.afterSequence));
    if (options?.limit !== undefined) query.set('limit', String(options.limit));
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    const events = await this.request<RunEvent[]>(`/v1/runs/${encodeURIComponent(runId)}/events${suffix}`);
    return events.map(decodeEvent);
  }

  async listArtifacts(runId: string): Promise<Artifact[]> {
    const artifacts = await this.request<Artifact[]>(`/v1/runs/${encodeURIComponent(runId)}/artifacts`);
    return artifacts.map(decodeArtifact);
  }

  async getArtifact(artifactId: string): Promise<Artifact> { return decodeArtifact(await this.request<Artifact>(`/v1/artifacts/${encodeURIComponent(artifactId)}`)); }
  async listExecutionNodes(runId: string): Promise<RunExecutionNode[]> { return (await this.request<RunExecutionNode[]>(`/v1/runs/${encodeURIComponent(runId)}/execution/nodes`)).map(decodeExecutionNode); }
  async listExecutionEntries(runId: string, options: ListEventsOptions = {}): Promise<RunExecutionEntry[]> {
    const query = new URLSearchParams(); if (options.afterSequence !== undefined) query.set('afterSequence', String(options.afterSequence)); if (options.limit !== undefined) query.set('limit', String(options.limit));
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    return (await this.request<RunExecutionEntry[]>(`/v1/runs/${encodeURIComponent(runId)}/execution/entries${suffix}`)).map(decodeExecutionEntry);
  }
  async listDeliveries(runId: string): Promise<RunDelivery[]> { return (await this.request<RunDelivery[]>(`/v1/runs/${encodeURIComponent(runId)}/execution/deliveries`)).map(decodeDelivery); }
  async listToolInvocations(runId: string): Promise<RuntimeToolInvocation[]> {
    return (await this.request<RuntimeToolInvocation[]>(`/v1/runs/${encodeURIComponent(runId)}/tool-invocations`)).map(decodeToolInvocation);
  }
  async resolveToolInvocation(runId: string, invocationId: string, resolution: ToolInvocationResolution): Promise<Run> {
    return decodeRun(await this.request<Run>(`/v1/runs/${encodeURIComponent(runId)}/tool-invocations/${encodeURIComponent(invocationId)}/resolve`, { method: 'POST', body: resolution }));
  }

  async raw(path: string, options: { method?: string; headers?: HeadersInit; signal?: AbortSignal } = {}): Promise<Response> {
    const headers = new Headers(this.defaultHeaders);
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    return this.requestFetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET', headers, signal: options.signal,
    });
  }

  async request<T>(path: string, options: { method?: string; body?: unknown; headers?: HeadersInit } = {}): Promise<T> {
    const headers = new Headers(this.defaultHeaders);
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    const response = await this.requestFetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET', headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) throw await parseError(response);
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; } catch (error) {
      throw new RuntimeClientError('INTERNAL_ERROR', 'Service returned invalid JSON', response.status, false, undefined, { cause: error });
    }
  }
}

export async function parseError(response: Response): Promise<RuntimeClientError> {
  const fallback = `Runtime Service returned HTTP ${response.status}`;
  try {
    const body = await response.json() as { error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } };
    const error = body.error;
    return new RuntimeClientError(error?.code ?? 'INTERNAL_ERROR', error?.message ?? fallback,
      response.status, error?.retryable === true, error?.details);
  } catch {
    return new RuntimeClientError('INTERNAL_ERROR', fallback, response.status);
  }
}
