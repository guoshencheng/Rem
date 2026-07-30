import type { Models } from '@earendil-works/pi-ai';
import type { AgentDI } from './agent-di.js';
import type { AgentRuntimeConfig, AgentRuntimeInfo } from './runtime-config.js';
import type { ConfigProvider } from '../sdk/config-provider.js';
import type { SessionProvider } from '../sdk/session-provider.js';
import type { ToolProvider } from '../sdk/tool-provider.js';
import type { ContextProvider } from '../sdk/context-provider.js';
import type { SkillProvider } from '../sdk/skill-provider.js';
import type { BudgetPolicy } from '../sdk/budget-policy.js';
import type { ContextCompressor } from '../sdk/compressor.js';
import type { ErrorHandler } from '../sdk/error-handler.js';
import type { TitleProvider } from '../sdk/title-provider.js';
import type { SystemPromptAssembler } from '../sdk/system-prompt.js';
import type { StorageProvider } from '../sdk/storage-provider.js';
import type { McpConnectionManager } from '../infrastructure/mcp/connection-manager.js';
import type { SecurityMode } from '../security/permissions/factory.js';

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
