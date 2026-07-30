import type { Models } from '@earendil-works/pi-ai';
import type { AgentDI } from './agent-di.js';
import type { AgentRuntimeConfig, AgentRuntimeInfo } from './runtime-config.js';
import type { ConfigProvider } from '../sdk/config-provider.js';
import type { ToolProvider } from '../sdk/tool-provider.js';
import type { SkillProvider } from '../sdk/skill-provider.js';
import type { BudgetPolicy } from '../sdk/budget-policy.js';
import type { ContextCompressor } from '../sdk/compressor.js';
import type { ErrorHandler } from '../sdk/error-handler.js';
import type { TitleProvider } from '../sdk/title-provider.js';
import type { StorageProvider } from '../sdk/storage-provider.js';

export interface AgentAssembly {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
}

export interface AssembleAgentContextOptions {
  configProvider: ConfigProvider;
  storageProvider: StorageProvider;
  models: Models;
  runtime: AgentRuntimeInfo;
  toolProvider?: ToolProvider;
  skillProvider?: SkillProvider;
  budgetPolicy?: BudgetPolicy;
  compressor?: ContextCompressor;
  errorHandler?: ErrorHandler;
  titleProvider?: TitleProvider;
}
