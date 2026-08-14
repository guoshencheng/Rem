import type { AgentDefinition } from '../domain/agent-definition/types.js';
import type { AgentRun } from '../domain/run/types.js';
import type { RuntimeConfigProvider } from '../sdk/runtime-config-provider.js';
import type { RuntimeConfigResolution } from './runtime-config-layers.js';
import { resolveRuntimeConfigLayers } from './runtime-config-layers.js';

export function resolveRunConfig(
  provider: RuntimeConfigProvider,
  definition: AgentDefinition,
  run: AgentRun,
): RuntimeConfigResolution {
  return resolveRuntimeConfigLayers(provider, definition, run.contextSnapshot.configLayers);
}
