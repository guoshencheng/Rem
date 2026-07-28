import { join } from 'node:path';
import { createCoreModels } from './llm/models.js';
import { createDefaultAgentPaths } from './config/paths.js';
import { configureConsoleOutput } from './shared/debug-log.js';
import { configureFileDebugLog } from './shared/debug-log-file.js';
import { DefaultConfigProvider } from './plugins/config/default/index.js';
import { createFileSystemTools } from './plugins/tool/file-system/index.js';
import { createFileMutationQueue } from './plugins/tool/file-system/shared/file-mutation-queue.js';
import { FileSkillProvider } from './plugins/skill/file/index.js';
import { McpConnectionManager } from './mcp/connection-manager.js';
import { SqliteStorageProvider } from './plugins/storage/sqlite/index.js';
import type { StorageProvider } from './sdk/storage-provider.js';
import { assembleAgentContext } from './agent-context-assembler.js';
import type { SecurityMode } from './security/permissions/factory.js';
import {
  DefaultSystemPromptAssembler,
  ProviderAwareTemplateSelector,
  ClaudeAgentPromptTemplate,
  OpenAiAgentPromptTemplate,
  ToolingSection,
  ExecutionBiasSection,
  SafetySection,
  AgentsMdSection,
  SkillsSection,
  WorkspaceSection,
  RuntimeSection,
  ProjectAgentsMdLoader,
} from './system-prompt/index.js';
import type { AgentContext, AgentRuntimeInfo } from './agent-context.js';
import type { ConfigProvider } from './sdk/config-provider.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { ContextProvider } from './sdk/context-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { LoopStrategy } from './sdk/loop-strategy.js';
import type { SystemPromptAssembler } from './sdk/system-prompt.js';
import type { Rule } from './security/rules/rule.js';

import type { AgentPaths } from './config/paths.js';

export interface AgentContextBuildOptions {
  name?: string;
  configPath?: string;
  maxTurns?: number;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  provider?: string;
  model?: string;
  sessionsDir?: string;
  profile?: import('./security/rules/profiles.js').ToolProfileId;
  sessionRules?: Rule[];
  securityMode?: SecurityMode;
  paths?: AgentPaths;
  storageProvider?: StorageProvider;
  models?: import('@earendil-works/pi-ai').Models;
  runtime?: AgentRuntimeInfo;
  configProvider?: ConfigProvider;
  sessionProvider?: SessionProvider;
  toolProvider?: ToolProvider;
  skillProvider?: SkillProvider;
  contextProvider?: ContextProvider;
  compressor?: ContextCompressor;
  titleProvider?: TitleProvider;
  loopStrategy?: LoopStrategy;
  systemPromptAssembler?: SystemPromptAssembler;
  mcpProviders?: ToolProvider[];
}

export async function buildAgentContext(options?: AgentContextBuildOptions): Promise<AgentContext> {
  const models = options?.models ?? createCoreModels({ all: true });

  const runtime: AgentRuntimeInfo = options?.runtime ?? {
    platform: process.platform,
    nodeVersion: process.version,
    cwd: process.cwd(),
    env: process.env,
  };

  const paths = options?.paths ?? createDefaultAgentPaths({ sessionsDir: options?.sessionsDir });
  configureFileDebugLog(paths.debugLogFile);
  if (paths.debugLogFile && process.env.NODE_ENV === 'development') {
    configureConsoleOutput(true);
  }

  const configProvider = options?.configProvider ?? new DefaultConfigProvider({
    paths,
    cwd: options?.workspaceRoot ?? process.cwd(),
    configPath: options?.configPath,
    overrides: {
      name: options?.name,
      maxTurns: options?.maxTurns,
      workspaceRoot: options?.workspaceRoot,
      readOnly: options?.readOnly,
      autoApproveDangerous: options?.autoApproveDangerous,
      profile: options?.profile,
      sessionRules: options?.sessionRules,
      ...(options?.provider ? { model: { provider: options.provider, model: options.model ?? '' } } : {}),
    },
  });
  await (configProvider as { init?: () => Promise<void> }).init?.();

  const storageProvider = options?.storageProvider
    ?? new SqliteStorageProvider({ dbPath: join(paths.agentDir, 'rem-agent.db') });
  await storageProvider.init();

  const fileMutationQueue = createFileMutationQueue();
  const skillProvider = options?.skillProvider ?? new FileSkillProvider(configProvider, paths);

  const mcpManager = new McpConnectionManager();
  const mcpProviders = options?.mcpProviders ?? await mcpManager.connectAll(configProvider.getMcpConfig());

  const templateSelector = new ProviderAwareTemplateSelector(
    new ClaudeAgentPromptTemplate(),
    { openai: new OpenAiAgentPromptTemplate() },
  );

  const defaultAssembler = new DefaultSystemPromptAssembler(
    templateSelector,
    [
      new ToolingSection(),
      new ExecutionBiasSection(),
      new SafetySection(),
      new AgentsMdSection(new ProjectAgentsMdLoader()),
      new SkillsSection(skillProvider),
      new WorkspaceSection(),
      new RuntimeSection(),
    ],
  );

  return assembleAgentContext({
    configProvider,
    sessionProvider: options?.sessionProvider,
    storageProvider,
    systemPromptAssembler: options?.systemPromptAssembler ?? defaultAssembler,
    models,
    runtime,
    mcpManager,
    toolProvider: options?.toolProvider ?? createFileSystemTools(configProvider, fileMutationQueue),
    mcpProviders,
    skillProvider,
    contextProvider: options?.contextProvider,
    compressor: options?.compressor,
    titleProvider: options?.titleProvider,
    loopStrategy: options?.loopStrategy,
    fileMutationQueue,
    securityMode: options?.securityMode,
  });
}
