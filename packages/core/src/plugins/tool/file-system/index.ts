import type { ApprovalOrchestrator } from '../../../sdk/approval-orchestrator.js';
import { AgentToolRegistry } from '../../../registry/tool-registry.js';
import type { ToolPolicyLike } from '../../../sdk/tool-policy.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';
import { createReadToolDefinition, createReadToolExecutor } from './read.js';
import { createWriteToolDefinition, createWriteToolExecutor } from './write.js';
import { createEditToolDefinition, createEditToolExecutor } from './edit.js';
import { createLsToolDefinition, createLsToolExecutor } from './ls.js';
import { createExecToolDefinition, createExecToolExecutor } from './exec.js';

export interface FileSystemToolsOptions {
  workspaceRoot: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  approvalOrchestrator?: ApprovalOrchestrator;
  toolPolicy?: ToolPolicyLike;
}

export function createFileSystemTools(options: FileSystemToolsOptions): AgentToolRegistry {
  const registry = new AgentToolRegistry({
    workspaceRoot: options.workspaceRoot,
    readOnly: options.readOnly,
    autoApproveDangerous: options.autoApproveDangerous,
    approvalOrchestrator: options.approvalOrchestrator,
    policy: options.toolPolicy,
  });

  registry.register(createReadToolDefinition(), createReadToolExecutor());
  registry.register(createLsToolDefinition(), createLsToolExecutor());
  registry.register(createExecToolDefinition(), createExecToolExecutor());

  if (!options.readOnly) {
    registry.register(createWriteToolDefinition(), createWriteToolExecutor());
    registry.register(createEditToolDefinition(), createEditToolExecutor());
  }

  return registry;
}

export function createProvider(options: FileSystemToolsOptions | undefined): AgentToolRegistry {
  if (!options?.workspaceRoot) {
    throw new Error('FileSystemTools requires workspaceRoot');
  }
  return createFileSystemTools(options);
}

export function getDefaultOptions(ctx: ProviderLoaderContext): FileSystemToolsOptions {
  return {
    workspaceRoot: ctx.workspaceRoot,
    readOnly: ctx.readOnly,
    autoApproveDangerous: ctx.autoApproveDangerous,
    approvalOrchestrator: ctx.approvalOrchestrator,
    toolPolicy: ctx.toolPolicy,
  };
}
