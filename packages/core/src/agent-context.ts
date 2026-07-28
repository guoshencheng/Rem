import type { Models } from '@earendil-works/pi-ai';
import type { SystemPromptAssembler } from './sdk/system-prompt.js';
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
import type { McpConnectionManager } from './mcp/connection-manager.js';
import type { ToolComposer } from './sdk/tool-composer.js';
import type { FileMutationQueue } from './plugins/tool/file-system/shared/file-mutation-queue.js';
import type { RuleEngine } from './security/rules/rule-engine.js';
import type { StorageProvider } from './sdk/storage-provider.js';
import type { ToolPermissionEvaluator } from './security/permissions/types.js';
import type { SecurityMode } from './security/permissions/factory.js';

export interface AgentRuntimeInfo {
  platform: string;
  nodeVersion?: string;
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface AgentContext {
  configProvider: ConfigProvider; // 基础配置

  // Agent基础配置
  sessionProvider: SessionProvider; // 会话管理
  budgetPolicy: BudgetPolicy;
  systemPromptAssembler: SystemPromptAssembler; // 新增
  // context builder
  contextProvider: ContextProvider;
  // 压缩
  compressor: ContextCompressor;
  errorHandler: ErrorHandler;
  titleProvider: TitleProvider;
  loopStrategy: LoopStrategy;

  // 基础但是可有可无
  mcpManager: McpConnectionManager;

  // 业务相关
  toolProvider: ToolProvider;        // 原始本地 tools，不再预合并
  mcpProviders: ToolProvider[];      
  skillProvider: SkillProvider;
  // TODO： 这个设计是不是不应该放在这里？
  toolComposer: ToolComposer;

  // 统一存储入口：session/rule/todo/archive/workspace 全部由其实现
  storage: StorageProvider;

  // TODO： 在文件相关的工具侧自己处理，不用处理
  fileMutationQueue: FileMutationQueue;

  // 工具的规则校验
  ruleEngine: RuleEngine;

  permissionEvaluator: ToolPermissionEvaluator;

  securityMode: SecurityMode;

  models: Models;

  // TODO: env 不应该传入，看看是否只是依赖cwd，其他的Agent可以自己通过 shell 自己获取到
  runtime: AgentRuntimeInfo;
}
