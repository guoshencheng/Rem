import type {
  AgentRuntime,
  RuntimeRequestContext,
  ScopedAgentRuntime,
} from 'rem-agent-core';

export interface RuntimeAuthenticator {
  authenticate(request: Request): RuntimeRequestContext | Promise<RuntimeRequestContext>;
}

export interface RuntimeServiceDeps {
  runtime: AgentRuntime;
  authenticator: RuntimeAuthenticator;
  streamKeepAliveMs?: number;
}

export interface RuntimeService {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export type RuntimeRouteContext = {
  request: Request;
  scoped: ScopedAgentRuntime;
};
