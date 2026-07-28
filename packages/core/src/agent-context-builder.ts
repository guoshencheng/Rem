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
import { assembleAgentContext, initRuleEngine } from './agent-context-assembler.js';
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
import type { AgentAssembly } from './agent-context-assembler.js';
import type { AgentRuntimeInfo } from './agent-runtime-config.js';
import type { ConfigProvider } from './sdk/config-provider.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { ContextProvider } from './sdk/context-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { LoopStrategy } from './sdk/loop-strategy.js';
import type { SystemPromptAssembler } from './sdk/system-prompt.js';
import type { AgentPaths } from './config/paths.js';

export interface AgentContextBuildOptions {
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

export function createAgentAssembly(options?: AgentContextBuildOptions): AgentAssembly {
  const models = options?.models ?? createCoreModels({ all: true });

  const runtime: AgentRuntimeInfo = options?.runtime ?? {
    platform: process.platform,
    nodeVersion: process.version,
    env: process.env,
  };

  const paths = options?.paths ?? createDefaultAgentPaths();
  configureFileDebugLog(paths.debugLogFile);
  if (paths.debugLogFile && process.env.NODE_ENV === 'development') {
    configureConsoleOutput(true);
  }

  // 注入的 configProvider 必须构造即可读（DefaultConfigProvider 需传 paths）
  const configProvider = options?.configProvider ?? new DefaultConfigProvider({ paths });
  const storageProvider = options?.storageProvider
    ?? new SqliteStorageProvider({ dbPath: join(paths.agentDir, 'rem-agent.db') });

  const fileMutationQueue = createFileMutationQueue();
  const skillProvider = options?.skillProvider ?? new FileSkillProvider(configProvider, paths);

  const mcpManager = new McpConnectionManager();

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
    mcpProviders: options?.mcpProviders,
    skillProvider,
    contextProvider: options?.contextProvider,
    compressor: options?.compressor,
    titleProvider: options?.titleProvider,
    loopStrategy: options?.loopStrategy,
    fileMutationQueue,
    securityMode: options?.securityMode,
  });
}

export async function initAgentAssembly(assembly: AgentAssembly, options?: AgentContextBuildOptions): Promise<void> {
  const { di } = assembly;
  await di.configProvider.init();
  await di.storage.init();
  await initRuleEngine(di);
  if (!options?.mcpProviders) {
    di.mcpProviders = await di.mcpManager.connectAll(di.configProvider.getMcpConfig());
  }
}

export async function buildAgentContext(options?: AgentContextBuildOptions): Promise<AgentAssembly> {
  const assembly = createAgentAssembly(options);
  await initAgentAssembly(assembly, options);
  return assembly;
}
