import { createAgentAssembly, type AgentContextBuildOptions } from './agent-context-builder.js';
import { initializeAgentDI } from './agent-context-assembler.js';
import type { AgentAssembly } from './agent-context-assembler.js';

export interface CreateAgentOptions extends AgentContextBuildOptions {}

export async function createAgentFromEnv(options?: CreateAgentOptions): Promise<AgentAssembly> {
  const assembly = createAgentAssembly(options);
  await initializeAgentDI(assembly.di, { skipMcp: !!options?.mcpProviders });
  return assembly;
}
