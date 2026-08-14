import type { AgentRuntime, ScopedAgentRuntime, StartRunInput } from 'rem-agent-core';
import { RuntimeError } from 'rem-agent-core';
import { authenticateRequest } from './request-context.js';
import { errorResponse } from './error-response.js';
import { readIntegerQuery, readJsonObject } from './json-body.js';
import { createSignalStream, SSE_HEADERS } from './sse.js';
import type { RuntimeAuthenticator, RuntimeService, RuntimeServiceDeps } from './types.js';

const DEFAULT_KEEP_ALIVE_MS = 15_000;

export function createRuntimeService(deps: RuntimeServiceDeps): RuntimeService {
  const authenticator: RuntimeAuthenticator = deps.authenticator;
  return {
    fetch: async (input, init) => {
      try {
        const request = input instanceof Request && init === undefined ? input : new Request(input, init);
        const url = new URL(request.url);
        if (url.pathname === '/v1/health') return healthRoute(deps.runtime, request);
        if (!url.pathname.startsWith('/v1/')) throw new RuntimeError('INVALID_INPUT', 'Route not found');
        const context = await authenticateRequest(authenticator, request);
        const scoped = deps.runtime.as(context);
        return await route(scoped, request, url, deps.streamKeepAliveMs ?? DEFAULT_KEEP_ALIVE_MS);
      } catch (error) {
        return errorResponse(error, error instanceof RuntimeError && error.message === 'Route not found' ? 404 : undefined);
      }
    },
  };
}

async function healthRoute(runtime: AgentRuntime, request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  try {
    const health = await runtime.health();
    const safe = {
      status: health.status, checkedAt: health.checkedAt,
      checks: { runtime: health.checks.runtime, storage: health.checks.storage, worker: health.checks.worker },
      ...(health.errorCode === undefined ? {} : { errorCode: health.errorCode }),
    };
    return Response.json(safe, { status: health.status === 'ready' ? 200 : 503 });
  } catch {
    return Response.json({
      status: 'degraded', checkedAt: new Date(),
      checks: { runtime: 'not-ready', storage: 'unknown', worker: 'stopped' }, errorCode: 'INTERNAL_ERROR',
    }, { status: 503 });
  }
}

async function route(scoped: ScopedAgentRuntime, request: Request, url: URL, keepAliveMs: number): Promise<Response> {
  const segments = url.pathname.split('/').filter(Boolean).slice(1);
  const [resource, id, action, subaction, subsubaction] = segments;
  if (resource === 'agents') return agentsRoute(scoped, request, id, url);
  if (resource === 'sessions') return sessionsRoute(scoped, request, id, action);
  if (resource === 'runs') return runsRoute(scoped, request, id, action, subaction, subsubaction, url, keepAliveMs);
  if (resource === 'artifacts') return artifactsRoute(scoped, request, id);
  throw new RuntimeError('INVALID_INPUT', 'Route not found');
}

async function sessionsRoute(
  scoped: ScopedAgentRuntime,
  request: Request,
  id: string | undefined,
  action: string | undefined,
): Promise<Response> {
  if (!id && !action && request.method === 'GET') return Response.json(await scoped.sessions.list());
  if (!id && !action && request.method === 'POST') {
    const body = await readJsonObject(request);
    if (Object.prototype.hasOwnProperty.call(body, 'tenantId')
      || Object.prototype.hasOwnProperty.call(body, 'principal')) {
      throw new RuntimeError('INVALID_INPUT', 'tenantId and principal come from authentication');
    }
    return Response.json(await scoped.sessions.create(), { status: 201 });
  }
  if (!id) throw new RuntimeError('INVALID_INPUT', 'Session id is required');
  if (!action && request.method === 'GET') return Response.json(await scoped.sessions.get(id));
  if (action === 'entries' && request.method === 'GET') return Response.json(await scoped.sessions.listEntries(id));
  if (action === 'contexts' && request.method === 'PATCH') {
    const body = await readJsonObject(request);
    if (!Object.hasOwn(body, 'patch') || !Object.hasOwn(body, 'expectedVersion')) throw new RuntimeError('INVALID_INPUT', 'patch and expectedVersion are required');
    if (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 0) throw new RuntimeError('INVALID_INPUT', 'expectedVersion must be a non-negative integer');
    return Response.json(await scoped.sessions.patchContexts(id, body.patch as never, body.expectedVersion as number));
  }
  throw new RuntimeError('INVALID_INPUT', 'Route not found');
}

async function agentsRoute(scoped: ScopedAgentRuntime, request: Request, id: string | undefined, url: URL): Promise<Response> {
  if (request.method !== 'GET') throw new RuntimeError('INVALID_INPUT', 'Method not allowed');
  if (!id) return Response.json(await scoped.agents.list());
  return Response.json(await scoped.agents.get(id, url.searchParams.get('revision') ?? undefined));
}

async function runsRoute(
  scoped: ScopedAgentRuntime,
  request: Request,
  id: string | undefined,
  action: string | undefined,
  subaction: string | undefined,
  subsubaction: string | undefined,
  url: URL,
  keepAliveMs: number,
): Promise<Response> {
  if (!id && request.method === 'GET' && !action) {
    const limit = readIntegerQuery(url, 'limit', { min: 1, max: 1000, defaultValue: 100 });
    const status = readRunStatus(url.searchParams.get('status'));
    return Response.json(await scoped.runs.list({
      sessionId: url.searchParams.get('sessionId') ?? undefined,
      ...(status === undefined ? {} : { status }),
      cursor: url.searchParams.get('cursor') ?? undefined, limit,
    }));
  }
  if (!id && request.method === 'POST' && !action) {
    const body = await readJsonObject(request);
    if (Object.prototype.hasOwnProperty.call(body, 'idempotencyKey')) {
      throw new RuntimeError('INVALID_INPUT', 'Use the Idempotency-Key header instead of request body');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'tenantId')
      || Object.prototype.hasOwnProperty.call(body, 'principal')) {
      throw new RuntimeError('INVALID_INPUT', 'tenantId and principal come from authentication');
    }
    const idempotencyKey = request.headers.get('idempotency-key') ?? undefined;
    const input = { ...body, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) } as unknown as StartRunInput;
    return Response.json(await scoped.runs.start(input), { status: 201 });
  }
  if (!id) throw new RuntimeError('INVALID_INPUT', 'Run id is required');
  if (!action && request.method === 'GET') return Response.json(await scoped.runs.get(id));
  if (action === 'cancel' && request.method === 'POST') return Response.json(await scoped.runs.cancel(id));
  if (action === 'events' && request.method === 'GET') {
    const afterSequence = readIntegerQuery(url, 'afterSequence', { min: 0, max: Number.MAX_SAFE_INTEGER });
    const limit = readIntegerQuery(url, 'limit', { min: 1, max: 1000, defaultValue: 100 });
    return Response.json(await scoped.runs.listEvents(id, afterSequence, limit));
  }
  if (action === 'artifacts' && request.method === 'GET') return Response.json(await scoped.artifacts.listByRun(id));
  if (action === 'execution' && subaction === 'nodes' && request.method === 'GET') return Response.json(await scoped.runs.listExecutionNodes(id));
  if (action === 'execution' && subaction === 'entries' && request.method === 'GET') {
    const afterSequence = readIntegerQuery(url, 'afterSequence', { min: 0, max: Number.MAX_SAFE_INTEGER });
    const limit = readIntegerQuery(url, 'limit', { min: 1, max: 1000, defaultValue: 100 });
    return Response.json(await scoped.runs.listExecutionEntries(id, { afterSequence, limit }));
  }
  if (action === 'execution' && subaction === 'deliveries' && request.method === 'GET') return Response.json(await scoped.runs.listDeliveries(id));
  if (action === 'tool-invocations' && request.method === 'GET') return Response.json(await scoped.runs.listToolInvocations(id));
  if (action === 'tool-invocations' && subaction && subsubaction === 'resolve' && request.method === 'POST') {
    const body = await readJsonObject(request);
    return Response.json(await scoped.runs.resolveToolInvocation(id, subaction, body as never));
  }
  if (action === 'stream' && request.method === 'GET') {
    const stream = createSignalStream(scoped.runs.subscribe(id, request.signal), request.signal, keepAliveMs);
    return new Response(stream, { headers: SSE_HEADERS });
  }
  throw new RuntimeError('INVALID_INPUT', 'Route not found');
}

function readRunStatus(value: string | null): 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | undefined {
  if (value === null) return undefined;
  const statuses = ['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'] as const;
  if (!(statuses as readonly string[]).includes(value)) throw new RuntimeError('INVALID_INPUT', 'Invalid run status');
  return value as (typeof statuses)[number];
}

async function artifactsRoute(scoped: ScopedAgentRuntime, request: Request, id: string | undefined): Promise<Response> {
  if (request.method !== 'GET' || !id) throw new RuntimeError('INVALID_INPUT', 'Artifact id is required');
  return Response.json(await scoped.artifacts.get(id));
}
