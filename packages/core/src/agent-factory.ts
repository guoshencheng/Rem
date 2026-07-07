import { registerBuiltInProviders } from './llm/providers/index.js';
import { createDefaultAgentPaths } from './config/paths.js';
import { configureDebugLog } from './shared/debug-log.js';
import { DefaultConfigProvider } from './plugins/config/default/index.js';
import { InMemorySessionProvider } from './plugins/session/in-memory/index.js';
import { InMemoryAgentLiveProvider } from './plugins/state/in-memory/index.js';
import { createFileSystemTools } from './plugins/tool/file-system/index.js';
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

export interface CreateAgentOptions {
  name?: string;
  configPath?: string;
  maxTurns?: number;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  provider?: string;
  model?: string;
}

export async function createAgentFromEnv(options?: CreateAgentOptions): Promise<AgentContext> {
  registerBuiltInProviders();

  const paths = createDefaultAgentPaths();
  configureDebugLog(paths.debugLogFile);

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

  const sessionProvider = new InMemorySessionProvider();
  const agentLiveProvider = new InMemoryAgentLiveProvider();
  const toolProvider = createFileSystemTools(configProvider);
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
    agentLiveProvider,
    toolProvider,        // 原始本地 tools
    mcpProviders,        // 连接成功的 MCP providers
    skillProvider,
    toolComposer,
    contextProvider,
    budgetPolicy,
    compressor,
    errorHandler,
    titleProvider,
    loopStrategy,
    mcpManager,
  };
}
