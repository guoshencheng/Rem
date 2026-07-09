import { registerBuiltInProviders } from './llm/providers/index.js';
import { createDefaultAgentPaths } from './config/paths.js';
import { configureDebugLog, configureConsoleOutput } from './shared/debug-log.js';
import { DefaultConfigProvider } from './plugins/config/default/index.js';
import { FileSessionProvider } from './plugins/session/file/index.js';
import { createFileSystemTools } from './plugins/tool/file-system/index.js';
import { createFileMutationQueue } from './plugins/tool/file-system/shared/file-mutation-queue.js';
import { SimpleContextProvider } from './plugins/memory/simple/index.js';
import { FileSkillProvider } from './plugins/skill/file/index.js';
import { FixedBudgetPolicy } from './plugins/budget/fixed/index.js';
import { NoOpCompressor } from './plugins/compressor/no-op/index.js';
import { SimpleErrorHandler } from './plugins/error/simple/index.js';
import { LLMTitleProvider } from './plugins/title/llm/index.js';
import { ReactLoop } from './plugins/loop/react/index.js';
import { McpConnectionManager } from './mcp/connection-manager.js';
import { DefaultToolComposer } from './tool-composer.js';
import type { AgentContext } from './agent-context.js';

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
}

export async function buildAgentContext(options?: AgentContextBuildOptions): Promise<AgentContext> {
  registerBuiltInProviders();

  const paths = createDefaultAgentPaths({ sessionsDir: options?.sessionsDir });
  configureDebugLog(paths.debugLogFile);
  if (paths.debugLogFile && process.env.NODE_ENV === 'development') {
    configureConsoleOutput(true);
  }

  const configProvider = new DefaultConfigProvider({
    paths,
    configPath: options?.configPath,
    overrides: {
      name: options?.name,
      maxTurns: options?.maxTurns,
      workspaceRoot: options?.workspaceRoot,
      readOnly: options?.readOnly,
      autoApproveDangerous: options?.autoApproveDangerous,
      ...(options?.provider ? { model: { provider: options.provider, model: options.model ?? '' } } : {}),
    },
  });
  await configProvider.init();

  const sessionProvider = new FileSessionProvider(paths.sessionsDir);
  const fileMutationQueue = createFileMutationQueue();
  const toolProvider = createFileSystemTools(configProvider, fileMutationQueue);
  const contextProvider = new SimpleContextProvider(configProvider);
  const skillProvider = new FileSkillProvider(configProvider, paths);
  const budgetPolicy = new FixedBudgetPolicy(configProvider);
  const compressor = new NoOpCompressor();
  const errorHandler = new SimpleErrorHandler();
  const titleProvider = new LLMTitleProvider(configProvider);
  const loopStrategy = new ReactLoop();

  const mcpConfig = configProvider.getMcpConfig();
  const mcpManager = new McpConnectionManager();
  const mcpProviders = await mcpManager.connectAll(mcpConfig);

  const toolComposer = new DefaultToolComposer();

  return {
    configProvider,
    sessionProvider,
    toolProvider,
    mcpProviders,
    skillProvider,
    toolComposer,
    contextProvider,
    budgetPolicy,
    compressor,
    errorHandler,
    titleProvider,
    loopStrategy,
    mcpManager,
    fileMutationQueue,
  };
}
