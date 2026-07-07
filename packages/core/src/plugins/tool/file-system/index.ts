import { AgentToolRegistry } from '../../../registry/tool-registry.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';
import { createReadToolDefinition, createReadToolExecutor } from './read.js';
import { createWriteToolDefinition, createWriteToolExecutor } from './write.js';
import { createEditToolDefinition, createEditToolExecutor } from './edit.js';
import { createLsToolDefinition, createLsToolExecutor } from './ls.js';
import { createExecToolDefinition, createExecToolExecutor } from './exec.js';

export function createFileSystemTools(configProvider: ConfigProvider): AgentToolRegistry {
  const behavior = configProvider.getBehaviorConfig();
  const toolCfg = configProvider.getToolConfig();
  const registry = new AgentToolRegistry({
    workspaceRoot: behavior.workspaceRoot,
    readOnly: behavior.readOnly,
    policy: toolCfg.policy,
  });

  registry.register(createReadToolDefinition(), createReadToolExecutor());
  registry.register(createLsToolDefinition(), createLsToolExecutor());
  registry.register(createExecToolDefinition(), createExecToolExecutor());

  if (!behavior.readOnly) {
    registry.register(createWriteToolDefinition(), createWriteToolExecutor());
    registry.register(createEditToolDefinition(), createEditToolExecutor());
  }

  return registry;
}
