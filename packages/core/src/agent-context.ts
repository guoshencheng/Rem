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
import type { RuleStorage } from './storage/types.js';
import type { TodoService } from './todo/service.js';
import type { ToolPermissionEvaluator } from './security/permissions/types.js';
import type { SecurityMode } from './security/permissions/factory.js';
import type { ArchiveStore } from './storage/types.js';

export interface AgentContext {
  configProvider: ConfigProvider;
  sessionProvider: SessionProvider;
  toolProvider: ToolProvider;        // 原始本地 tools，不再预合并
  mcpProviders: ToolProvider[];      // 新增
  skillProvider: SkillProvider;
  toolComposer: ToolComposer;        // 新增
  contextProvider: ContextProvider;
  budgetPolicy: BudgetPolicy;
  compressor: ContextCompressor;
  errorHandler: ErrorHandler;
  titleProvider: TitleProvider;
  loopStrategy: LoopStrategy;
  mcpManager: McpConnectionManager;
  fileMutationQueue: FileMutationQueue;
  systemPromptAssembler: SystemPromptAssembler; // 新增
  ruleEngine: RuleEngine;
  ruleStore: RuleStorage;
  todoService: TodoService;
  permissionEvaluator: ToolPermissionEvaluator;
  securityMode: SecurityMode;
  archiveStore: ArchiveStore;
}
