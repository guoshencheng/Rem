import { AgentToolRegistry } from '../../registry/tool-registry.js';
import type { ToolPolicyLike } from '../../sdk/tool-policy.js';
import { createReadToolDefinition, createReadToolExecutor } from './read.js';
import { createWriteToolDefinition, createWriteToolExecutor } from './write.js';
import { createEditToolDefinition, createEditToolExecutor } from './edit.js';
import { createLsToolDefinition, createLsToolExecutor } from './ls.js';

export interface FileSystemToolsOptions {
  workspaceRoot: string;
  readOnly?: boolean;
  toolPolicy?: ToolPolicyLike;
}

export function createFileSystemTools(options: FileSystemToolsOptions): AgentToolRegistry {
  const registry = new AgentToolRegistry({
    workspaceRoot: options.workspaceRoot,
    readOnly: options.readOnly,
    policy: options.toolPolicy,
  });

  registry.register(createReadToolDefinition(), createReadToolExecutor());
  registry.register(createLsToolDefinition(), createLsToolExecutor());

  if (!options.readOnly) {
    registry.register(createWriteToolDefinition(), createWriteToolExecutor());
    registry.register(createEditToolDefinition(), createEditToolExecutor());
  }

  return registry;
}
