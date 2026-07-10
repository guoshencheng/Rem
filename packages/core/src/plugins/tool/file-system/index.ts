import type { ConfigProvider } from '../../../sdk/config-provider.js';
import type { FileMutationQueue } from './shared/file-mutation-queue.js';
import type { Rule } from '../../../security/rules/rule.js';
import { AgentToolRegistry } from '../../../registry/tool-registry.js';
import { createReadToolDefinition, createReadToolExecutor } from './read.js';
import { createWriteToolDefinition, createWriteToolExecutor } from './write.js';
import { createEditToolDefinition, createEditToolExecutor } from './edit.js';
import { createLsToolDefinition, createLsToolExecutor } from './ls.js';
import { createExecToolDefinition, createExecToolExecutor } from './exec.js';
import {
  createGlobToolDefinition,
  createGlobToolExecutor,
  deriveGlobPatterns,
  deriveGlobAlwaysOptions,
} from './glob.js';
import {
  createFindToolDefinition,
  createFindToolExecutor,
  deriveFindPatterns,
  deriveFindAlwaysOptions,
} from './find.js';
import {
  createGrepToolDefinition,
  createGrepToolExecutor,
  deriveGrepPatterns,
  deriveGrepAlwaysOptions,
} from './grep.js';
import {
  createApplyPatchToolDefinition,
  createApplyPatchToolExecutor,
  deriveApplyPatchPatterns,
  deriveApplyPatchAlwaysOptions,
} from './apply-patch.js';
import { classifyCommand } from '../../../security/exec-classifier.js';

function deriveFilePatterns(input: { path?: string }): string[] {
  const p = input.path ?? '';
  return [`file:${p}`];
}

function deriveFileAlwaysOptions(input: { path?: string }): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  const p = input.path ?? '';
  const parts = p.split('/').filter(Boolean);
  const options: Array<{ label: string; rule: Omit<Rule, 'source'> }> = [];
  options.push({ label: p, rule: { permission: 'write', pattern: p, action: 'allow' } });
  if (parts.length >= 2) {
    const dir = parts.slice(0, -1).join('/') + '/*';
    options.push({ label: dir, rule: { permission: 'write', pattern: dir, action: 'allow' } });
  }
  if (p.includes('.')) {
    const ext = '*.' + p.split('.').pop();
    options.push({ label: ext, rule: { permission: 'write', pattern: ext, action: 'allow' } });
  }
  options.push({ label: 'all', rule: { permission: 'write', pattern: '*', action: 'allow' } });
  return options;
}

export function createFileSystemTools(
  configProvider: ConfigProvider,
  fileMutationQueue: FileMutationQueue,
): AgentToolRegistry {
  const behavior = configProvider.getBehaviorConfig();
  const toolCfg = configProvider.getToolConfig();
  const registry = new AgentToolRegistry({
    workspaceRoot: behavior.workspaceRoot,
    readOnly: behavior.readOnly,
    policy: toolCfg.policy,
  });

  const readDef = createReadToolDefinition();
  registry.register(
    {
      ...readDef,
      derivePatterns: deriveFilePatterns,
      deriveAlwaysOptions: deriveFileAlwaysOptions,
    },
    createReadToolExecutor(),
  );

  const lsDef = createLsToolDefinition();
  registry.register(
    {
      ...lsDef,
      derivePatterns: deriveFilePatterns,
      deriveAlwaysOptions: deriveFileAlwaysOptions,
    },
    createLsToolExecutor(),
  );

  const execDef = createExecToolDefinition();
  registry.register(
    {
      ...execDef,
      derivePatterns: (input) => {
        const c = classifyCommand(input.command);
        return c.patterns;
      },
      deriveAlwaysOptions: (input) => {
        const c = classifyCommand(input.command);
        return c.patterns.map((pattern) => ({
          label: pattern,
          rule: { permission: 'exec', pattern, action: 'allow' },
        }));
      },
    },
    createExecToolExecutor(),
  );

  const globDef = createGlobToolDefinition();
  registry.register(
    {
      ...globDef,
      derivePatterns: deriveGlobPatterns,
      deriveAlwaysOptions: deriveGlobAlwaysOptions,
    },
    createGlobToolExecutor(),
  );

  const findDef = createFindToolDefinition();
  registry.register(
    {
      ...findDef,
      derivePatterns: deriveFindPatterns,
      deriveAlwaysOptions: deriveFindAlwaysOptions,
    },
    createFindToolExecutor(),
  );

  const grepDef = createGrepToolDefinition();
  registry.register(
    {
      ...grepDef,
      derivePatterns: deriveGrepPatterns,
      deriveAlwaysOptions: deriveGrepAlwaysOptions,
    },
    createGrepToolExecutor(),
  );

  if (!behavior.readOnly) {
    const writeDef = createWriteToolDefinition();
    registry.register(
      {
        ...writeDef,
        derivePatterns: deriveFilePatterns,
        deriveAlwaysOptions: deriveFileAlwaysOptions,
      },
      createWriteToolExecutor(fileMutationQueue),
    );

    const editDef = createEditToolDefinition();
    registry.register(
      {
        ...editDef,
        derivePatterns: deriveFilePatterns,
        deriveAlwaysOptions: deriveFileAlwaysOptions,
      },
      createEditToolExecutor(fileMutationQueue),
    );

    const applyPatchDef = createApplyPatchToolDefinition();
    registry.register(
      {
        ...applyPatchDef,
        derivePatterns: deriveApplyPatchPatterns,
        deriveAlwaysOptions: deriveApplyPatchAlwaysOptions,
      },
      createApplyPatchToolExecutor(fileMutationQueue),
    );
  }

  return registry;
}
