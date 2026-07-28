import { createAgentAssembly, initAgentAssembly, type AgentContextBuildOptions } from './agent-context-builder.js';
import type { AgentAssembly } from './agent-context-assembler.js';

export interface CreateAgentOptions extends AgentContextBuildOptions {}

export async function createAgentFromEnv(options?: CreateAgentOptions): Promise<AgentAssembly> {
  const assembly = createAgentAssembly(options);
  await initAgentAssembly(assembly, options);
  return assembly;
}
