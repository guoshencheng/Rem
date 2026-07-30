import type { Models } from '@earendil-works/pi-ai';
import type { ConfigProvider } from '../sdk/config-provider.js';
import type { SessionProvider } from '../sdk/session-provider.js';
import type { ToolProvider } from '../sdk/tool-provider.js';
import type { SkillProvider } from '../sdk/skill-provider.js';
import type { BudgetPolicy } from '../sdk/budget-policy.js';
import type { ContextCompressor } from '../sdk/compressor.js';
import type { ErrorHandler } from '../sdk/error-handler.js';
import type { TitleProvider } from '../sdk/title-provider.js';
import type { StorageProvider } from '../sdk/storage-provider.js';

export interface AgentDI {
  configProvider: ConfigProvider; // 基础配置

  // Agent基础配置
  sessionProvider: SessionProvider; // 会话管理
  budgetPolicy: BudgetPolicy;
  // 压缩
  compressor: ContextCompressor;
  errorHandler: ErrorHandler;
  titleProvider: TitleProvider;

  // 业务相关
  toolProvider: ToolProvider;
  skillProvider: SkillProvider;
  // 统一存储入口：session/todo/archive/workspace 全部由其实现
  storage: StorageProvider;

  models: Models;
}
