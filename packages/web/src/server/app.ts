import { Hono } from 'hono';
import type { AgentRuntime } from 'rem-agent-core';
import { createRuntimeService } from 'rem-agent-service';
import { toErrorResponse } from './errors.js';
import { localRuntimeAuthenticator } from './runtime-authenticator.js';

export interface WebAppDeps {
  runtime: AgentRuntime;
}

export function createWebApp(deps: WebAppDeps): Hono {
  const app = new Hono();
  app.onError((err, c) => toErrorResponse(err, c));
  const runtimeService = createRuntimeService({ runtime: deps.runtime, authenticator: localRuntimeAuthenticator });
  app.all('/v1', (c) => runtimeService.fetch(c.req.raw));
  app.all('/v1/*', (c) => runtimeService.fetch(c.req.raw));
  return app;
}
