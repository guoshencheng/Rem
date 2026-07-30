import type { Models } from '@earendil-works/pi-ai';
import type { SystemPromptAssembler } from '../sdk/system-prompt.js';
import type { ConfigProvider } from '../sdk/config-provider.js';
import type { SessionProvider } from '../sdk/session-provider.js';
import type { ToolProvider } from '../sdk/tool-provider.js';
import type { ContextProvider } from '../sdk/context-provider.js';
import type { SkillProvider } from '../sdk/skill-provider.js';
import type { BudgetPolicy } from '../sdk/budget-policy.js';
import type { ContextCompressor } from '../sdk/compressor.js';
import type { ErrorHandler } from '../sdk/error-handler.js';
import type { TitleProvider } from '../sdk/title-provider.js';
import type { McpConnectionManager } from '../infrastructure/mcp/connection-manager.js';
import type { RuleEngine } from '../security/rules/rule-engine.js';
import type { StorageProvider } from '../sdk/storage-provider.js';
import type { ToolPermissionEvaluator } from '../security/permissions/types.js';

export interface AgentDI {
  configProvider: ConfigProvider; // 基础配置

  // Agent基础配置
  sessionProvider: SessionProvider; // 会话管理
  budgetPolicy: BudgetPolicy;
  systemPromptAssembler: SystemPromptAssembler;
  // context builder
  contextProvider: ContextProvider;
  // 压缩
  compressor: ContextCompressor;
  errorHandler: ErrorHandler;
  titleProvider: TitleProvider;

  // 基础但是可有可无
  mcpManager: McpConnectionManager;

  // 业务相关
  toolProvider: ToolProvider;        // 原始本地 tools，不再预合并
  mcpProviders: ToolProvider[];
  skillProvider: SkillProvider;
  // 统一存储入口：session/rule/todo/archive/workspace 全部由其实现
  storage: StorageProvider;

  // 工具的规则校验
  ruleEngine: RuleEngine;

  permissionEvaluator: ToolPermissionEvaluator;

  models: Models;
}
