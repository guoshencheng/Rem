import { buildAgentContext, type AgentContextBuildOptions } from './agent-context-builder.js';
import type { AgentContext } from './agent-context.js';

export interface CreateAgentOptions extends AgentContextBuildOptions {}

export async function createAgentFromEnv(options?: CreateAgentOptions): Promise<AgentContext> {
  return buildAgentContext(options);
}
