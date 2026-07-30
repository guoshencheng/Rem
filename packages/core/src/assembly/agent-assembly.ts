import { join } from 'node:path';
import { createCoreModels } from '../infrastructure/llm/models.js';
import { createDefaultAgentPaths } from '../infrastructure/config/paths.js';
import { configureConsoleOutput } from '../infrastructure/observability/debug-log.js';
import { configureFileDebugLog } from '../infrastructure/observability/debug-log-file.js';
import { DefaultConfigProvider } from '../plugins/config/default/index.js';
import { createFileSystemTools } from '../plugins/tool/file-system/index.js';
import { FileSkillProvider } from '../plugins/skill/file/index.js';
import { SqliteStorageProvider } from '../plugins/storage/sqlite/index.js';
import { assembleAgentContext } from './agent-context-assembler.js';
import type { AgentAssembly } from './agent-context-assembler.js';
import type { AgentRuntimeInfo } from './runtime-config.js';
import type { ConfigProvider } from '../sdk/config-provider.js';
import type { ToolProvider } from '../sdk/tool-provider.js';
import type { SkillProvider } from '../sdk/skill-provider.js';
import type { ContextCompressor } from '../sdk/compressor.js';
import type { TitleProvider } from '../sdk/title-provider.js';
import type { AgentPaths } from '../infrastructure/config/paths.js';

export interface AgentContextBuildOptions {
  paths?: AgentPaths;
  models?: import('@earendil-works/pi-ai').Models;
  runtime?: AgentRuntimeInfo;
  configProvider?: ConfigProvider;
  toolProvider?: ToolProvider;
  skillProvider?: SkillProvider;
  compressor?: ContextCompressor;
  titleProvider?: TitleProvider;
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
  const storageProvider = new SqliteStorageProvider({ dbPath: join(paths.agentDir, 'rem-agent.db') });

  const skillProvider = options?.skillProvider ?? new FileSkillProvider(configProvider, paths);

  return assembleAgentContext({
    configProvider,
    storageProvider,
    models,
    runtime,
    toolProvider: options?.toolProvider ?? createFileSystemTools(configProvider),
    skillProvider,
    compressor: options?.compressor,
    titleProvider: options?.titleProvider,
  });
}
