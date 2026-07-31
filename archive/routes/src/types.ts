import type { IAgentService } from 'rem-agent-bridge';

export type GetAgentService = () => Promise<IAgentService> | IAgentService;

export interface RemRoutesOptions {
  getAgentService: GetAgentService;
}

export interface HandlerContext {
  req: Request;
  params: Record<string, string>;
  getAgentService: GetAgentService;
}

export type Handler = (ctx: HandlerContext) => Promise<Response>;

export interface RouteDefinition {
  pattern: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  handler: Handler;
}
