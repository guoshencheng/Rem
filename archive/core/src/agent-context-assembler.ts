import type { Models } from '@earendil-works/pi-ai';
import type { AgentDI } from './agent-di.js';
import type { AgentRuntimeConfig, AgentRuntimeInfo } from './agent-runtime-config.js';
import type { ConfigProvider } from './sdk/config-provider.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { ContextProvider } from './sdk/context-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { SystemPromptAssembler } from './sdk/system-prompt.js';
import type { StorageProvider } from './sdk/storage-provider.js';
import type { McpConnectionManager } from './mcp/connection-manager.js';
import type { SecurityMode } from './security/permissions/factory.js';
import type { Rule } from './security/rules/rule.js';
import { StaticToolProvider } from './plugins/tool/static/index.js';
import { DefaultSessionProvider } from './plugins/session/default/index.js';
import { EmptySkillProvider } from './plugins/skill/empty/index.js';
import { SimpleContextProvider } from './plugins/memory/simple/index.js';
import { FixedBudgetPolicy } from './plugins/budget/fixed/index.js';
import { LLMSummarizingCompressor } from './plugins/compressor/llm-summary/index.js';
import { SimpleErrorHandler } from './plugins/error/simple/index.js';
import { LLMTitleProvider } from './plugins/title/llm/index.js';
import { RuleEngine } from './security/rules/rule-engine.js';
import { getProfileRules } from './security/rules/profiles.js';
import { createPermissionEvaluator, type ApprovalRequestFactory } from './security/permissions/factory.js';

export interface AgentAssembly {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
}

export interface AssembleAgentContextOptions {
  configProvider: ConfigProvider;
  /** 缺省时由 storage.sessionStore 装配 DefaultSessionProvider。 */
  sessionProvider?: SessionProvider;
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
  securityMode?: SecurityMode;
}

class NoopFileMutationQueue {
  async withQueue<T>(_filePath: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

function buildConfigRules(configProvider: ConfigProvider): Rule[] {
  const config = configProvider.getConfig();
  const profileRules = getProfileRules(config.profile ?? 'coding');
  // 只读 / 状态类工具默认放行。pattern 用 ** 才能跨路径分隔符匹配（派生 pattern 是 file:/abs/path）。
  const defaultRules: Rule[] = [
    { permission: 'read', pattern: '**', action: 'allow', source: 'default' },
    { permission: 'ls', pattern: '**', action: 'allow', source: 'default' },
    { permission: 'session_status', pattern: '*', action: 'allow', source: 'default' },
    { permission: 'todowrite', pattern: '*', action: 'allow', source: 'default' },
  ];
  return [...defaultRules, ...profileRules];
}

/** 初始化 AgentDI 中的所有异步组件。调用方在创建 AgentService 前必须调用此函数。 */
export async function initializeAgentDI(di: AgentDI, options?: { skipMcp?: boolean }): Promise<void> {
  await di.configProvider.init();
  await di.storage.init();
  await initRuleEngine(di);
  if (!options?.skipMcp) {
    di.mcpProviders = await di.mcpManager.connectAll(di.configProvider.getMcpConfig());
  }
}

/** init 阶段调用：追加持久化 userRules 与 config sessionRules，保持 [default, profile, user, session] 顺序（evaluate 用 findLast，后规则优先）。 */
export async function initRuleEngine(di: AgentDI): Promise<void> {
  const userRules = await di.storage.ruleStore.loadAll();
  const sessionRules = di.configProvider.getConfig().sessionRules ?? [];
  for (const rule of [...userRules, ...sessionRules]) {
    di.ruleEngine.addRule(rule);
  }
}

export function assembleAgentContext(options: AssembleAgentContextOptions): AgentAssembly {
  const { configProvider, storageProvider, models, runtime } = options;

  const compressor = options.compressor
    ?? new LLMSummarizingCompressor(configProvider.getCompressionConfig(), configProvider.getModelConfig(), models, runtime.env);

  const ruleEngine = new RuleEngine(buildConfigRules(configProvider));

  const approvalFactory: ApprovalRequestFactory = { create: (input) => input };
  const securityMode = options.securityMode ?? 'interactive';
  const permissionEvaluator = createPermissionEvaluator(securityMode, ruleEngine, approvalFactory);

  return {
    di: {
      configProvider,
      sessionProvider: options.sessionProvider ?? new DefaultSessionProvider(storageProvider.sessionStore),
      toolProvider: options.toolProvider ?? new StaticToolProvider(),
      mcpProviders: options.mcpProviders ?? [],
      skillProvider: options.skillProvider ?? new EmptySkillProvider(),
      contextProvider: options.contextProvider ?? new SimpleContextProvider(configProvider),
      budgetPolicy: options.budgetPolicy ?? new FixedBudgetPolicy(configProvider),
      compressor,
      errorHandler: options.errorHandler ?? new SimpleErrorHandler(),
      titleProvider: options.titleProvider ?? new LLMTitleProvider(configProvider, models),
      mcpManager: options.mcpManager ?? ({} as McpConnectionManager),
      systemPromptAssembler: options.systemPromptAssembler,
      ruleEngine,
      storage: storageProvider,
      permissionEvaluator,
      models,
    },
    runtimeConfig: { securityMode, runtime },
  };
}
