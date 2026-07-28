import { createAgentAssembly, type AgentContextBuildOptions } from './agent-context-builder.js';
import { initRuleEngine } from './agent-context-assembler.js';
import type { AgentAssembly } from './agent-context-assembler.js';

export interface CreateAgentOptions extends AgentContextBuildOptions {}

export async function createAgentFromEnv(options?: CreateAgentOptions): Promise<AgentAssembly> {
  const assembly = createAgentAssembly(options);
  const { di } = assembly;
  await di.configProvider.init();
  await di.storage.init();
  await initRuleEngine(di);
  if (!options?.mcpProviders) {
    di.mcpProviders = await di.mcpManager.connectAll(di.configProvider.getMcpConfig());
  }
  return assembly;
}
