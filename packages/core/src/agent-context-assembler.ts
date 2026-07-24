import type { Models } from '@earendil-works/pi-ai';
import type { AgentContext, AgentRuntimeInfo } from './agent-context.js';
import type { ConfigProvider } from './sdk/config-provider.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { ContextProvider } from './sdk/context-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { LoopStrategy } from './sdk/loop-strategy.js';
import type { SystemPromptAssembler } from './sdk/system-prompt.js';
import type { StorageProvider, RuleStorage } from './sdk/storage-provider.js';
import type { McpConnectionManager } from './mcp/connection-manager.js';
import type { FileMutationQueue } from './plugins/tool/file-system/shared/file-mutation-queue.js';
import type { SecurityMode } from './security/permissions/factory.js';
import type { Rule } from './security/rules/rule.js';
import { StaticToolProvider } from './plugins/tool/static/index.js';
import { EmptySkillProvider } from './plugins/skill/empty/index.js';
import { SimpleContextProvider } from './plugins/memory/simple/index.js';
import { FixedBudgetPolicy } from './plugins/budget/fixed/index.js';
import { LLMSummarizingCompressor } from './plugins/compressor/llm-summary/index.js';
import { SimpleErrorHandler } from './plugins/error/simple/index.js';
import { LLMTitleProvider } from './plugins/title/llm/index.js';
import { ReactLoop } from './plugins/loop/react/index.js';
import { DefaultToolComposer } from './tool-composer.js';
import { DefaultTodoService } from './todo/service.js';
import { RuleEngine } from './security/rules/rule-engine.js';
import { getProfileRules } from './security/rules/profiles.js';
import { createPermissionEvaluator, type ApprovalRequestFactory } from './security/permissions/factory.js';

export interface AssembleAgentContextOptions {
  configProvider: ConfigProvider;
  sessionProvider: SessionProvider;
  storageProvider: StorageProvider;
  systemPromptAssembler: SystemPromptAssembler;
  models: Models;
  runtime: AgentRuntimeInfo;
  /** 仅 Node 路径使用；浏览器可省略（runAgent 不触碰）。 */
  mcpManager?: McpConnectionManager;
  toolProvider?: ToolProvider;
  mcpProviders?: ToolProvider[];
  skillProvider?: SkillProvider;
  contextProvider?: ContextProvider;
  budgetPolicy?: BudgetPolicy;
  compressor?: ContextCompressor;
  errorHandler?: ErrorHandler;
  titleProvider?: TitleProvider;
  loopStrategy?: LoopStrategy;
  fileMutationQueue?: FileMutationQueue;
  securityMode?: SecurityMode;
}

class NoopFileMutationQueue {
  async withQueue<T>(_filePath: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

export async function buildRuleSecurity(
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
    { permission: 'todowrite', pattern: '*', action: 'allow', source: 'default' },
  ];
  const sessionRules = config.sessionRules ?? [];
  const ruleEngine = new RuleEngine([...defaultRules, ...profileRules, ...userRules, ...sessionRules]);
  return { ruleEngine, ruleStore };
}

export async function assembleAgentContext(options: AssembleAgentContextOptions): Promise<AgentContext> {
  const { configProvider, storageProvider, models, runtime } = options;

  const compressor = options.compressor
    ?? new LLMSummarizingCompressor(configProvider.getCompressionConfig(), configProvider.getModelConfig(), models, runtime.env);

  const { ruleEngine, ruleStore } = await buildRuleSecurity(configProvider, storageProvider.ruleStore);

  const approvalFactory: ApprovalRequestFactory = { create: (input) => input };
  const securityMode = options.securityMode ?? 'interactive';
  const permissionEvaluator = createPermissionEvaluator(securityMode, ruleEngine, approvalFactory);

  return {
    configProvider,
    sessionProvider: options.sessionProvider,
    toolProvider: options.toolProvider ?? new StaticToolProvider(),
    mcpProviders: options.mcpProviders ?? [],
    skillProvider: options.skillProvider ?? new EmptySkillProvider(),
    toolComposer: new DefaultToolComposer(),
    contextProvider: options.contextProvider ?? new SimpleContextProvider(configProvider),
    budgetPolicy: options.budgetPolicy ?? new FixedBudgetPolicy(configProvider),
    compressor,
    errorHandler: options.errorHandler ?? new SimpleErrorHandler(),
    titleProvider: options.titleProvider ?? new LLMTitleProvider(configProvider, models),
    loopStrategy: options.loopStrategy ?? new ReactLoop(),
    mcpManager: options.mcpManager ?? ({} as McpConnectionManager),
    fileMutationQueue: options.fileMutationQueue ?? (new NoopFileMutationQueue() as FileMutationQueue),
    systemPromptAssembler: options.systemPromptAssembler,
    ruleEngine,
    ruleStore,
    todoService: new DefaultTodoService(storageProvider.todoStore),
    permissionEvaluator,
    securityMode,
    archiveStore: storageProvider.archiveStore,
    workspaceStore: storageProvider.workspaceStore,
    models,
    runtime,
  };
}
