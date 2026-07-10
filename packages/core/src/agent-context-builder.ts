import { join } from 'node:path';
import { registerBuiltInProviders } from './llm/providers/index.js';
import { createDefaultAgentPaths } from './config/paths.js';
import { configureDebugLog, configureConsoleOutput } from './shared/debug-log.js';
import { DefaultConfigProvider } from './plugins/config/default/index.js';
import { SqliteSessionProvider } from './plugins/session/sqlite/index.js';
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
import { RuleEngine } from './security/rules/rule-engine.js';
import { RuleStore } from './security/rules/rule-store.js';
import { getProfileRules } from './security/rules/profiles.js';
import type { Rule } from './security/rules/rule.js';
import { SqliteStorageProvider, type RuleStorage, type StorageProvider } from './storage/index.js';
import {
  createPermissionEvaluator,
  type ApprovalRequestFactory,
  type SecurityMode,
} from './security/permissions/factory.js';
import {
  DefaultSystemPromptAssembler,
  ProviderAwareTemplateSelector,
  ClaudeAgentPromptTemplate,
  OpenAiAgentPromptTemplate,
  ToolingSection,
  ExecutionBiasSection,
  SafetySection,
  WorkspaceSection,
  AgentsMdSection,
  SkillsSection,
  RuntimeSection,
  ProjectAgentsMdLoader,
} from './system-prompt/index.js';
import type { AgentContext } from './agent-context.js';
import type { ConfigProvider } from './sdk/config-provider.js';

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
}

async function buildRuleSecurity(
  configProvider: ConfigProvider,
  ruleStore: RuleStorage,
): Promise<{ ruleEngine: RuleEngine; ruleStore: RuleStorage }> {
  const userRules = await ruleStore.loadAll();
  const config = configProvider.getConfig();
  const profileRules = getProfileRules(config.profile ?? 'coding');
  // 只读 / 状态类工具默认放行。pattern 用 ** 才能跨路径分隔符匹配（派生 pattern 是 file:/abs/path）。
  const defaultRules: Rule[] = [
    { permission: 'read', pattern: '**', action: 'allow', source: 'default' },
    { permission: 'ls', pattern: '**', action: 'allow', source: 'default' },
    { permission: 'session_status', pattern: '*', action: 'allow', source: 'default' },
  ];
  const sessionRules = config.sessionRules ?? [];
  const ruleEngine = new RuleEngine([...defaultRules, ...profileRules, ...userRules, ...sessionRules]);
  return { ruleEngine, ruleStore };
}

export async function buildAgentContext(options?: AgentContextBuildOptions): Promise<AgentContext> {
  registerBuiltInProviders();

  const paths = options?.paths ?? createDefaultAgentPaths({ sessionsDir: options?.sessionsDir });
  configureDebugLog(paths.debugLogFile);
  if (paths.debugLogFile && process.env.NODE_ENV === 'development') {
    configureConsoleOutput(true);
  }

  const configProvider = new DefaultConfigProvider({
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
  await configProvider.init();

  const storageProvider = options?.storageProvider
    ?? new SqliteStorageProvider({ dbPath: join(paths.agentDir, 'rem-agent.db') });
  await storageProvider.init();

  const sessionProvider = new SqliteSessionProvider(storageProvider.sessionStore);
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

  const templateSelector = new ProviderAwareTemplateSelector(
    new ClaudeAgentPromptTemplate(),
    { openai: new OpenAiAgentPromptTemplate() },
  );

  const systemPromptAssembler = new DefaultSystemPromptAssembler(
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

  const { ruleEngine, ruleStore } = await buildRuleSecurity(configProvider, storageProvider.ruleStore);

  const approvalFactory: ApprovalRequestFactory = {
    create: (input) => input,
  };

  const securityMode = options?.securityMode ?? 'interactive';

  const permissionEvaluator = createPermissionEvaluator(
    securityMode,
    ruleEngine,
    approvalFactory,
  );

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
    systemPromptAssembler,
    ruleEngine,
    ruleStore,
    permissionEvaluator,
    securityMode,
  };
}
