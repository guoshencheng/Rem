import type { Models } from '@earendil-works/pi-ai';
import type { AgentDI } from './agent-di.js';
import type { AgentRuntimeConfig, AgentRuntimeInfo } from './runtime-config.js';
import type { ConfigProvider } from '../sdk/config-provider.js';
import type { SessionProvider } from '../sdk/session-provider.js';
import type { ToolProvider } from '../sdk/tool-provider.js';
import type { SkillProvider } from '../sdk/skill-provider.js';
import type { BudgetPolicy } from '../sdk/budget-policy.js';
import type { ContextCompressor } from '../sdk/compressor.js';
import type { ErrorHandler } from '../sdk/error-handler.js';
import type { TitleProvider } from '../sdk/title-provider.js';
import type { StorageProvider } from '../sdk/storage-provider.js';
import { StaticToolProvider } from '../plugins/tool/static/index.js';
import { DefaultSessionProvider } from '../plugins/session/default/index.js';
import { EmptySkillProvider } from '../plugins/skill/empty/index.js';
import { FixedBudgetPolicy } from '../plugins/budget/fixed/index.js';
import { LLMSummarizingCompressor } from '../plugins/compressor/llm-summary/index.js';
import { SimpleErrorHandler } from '../plugins/error/simple/index.js';
import { LLMTitleProvider } from '../plugins/title/llm/index.js';
import type { AgentAssembly, AssembleAgentContextOptions } from './types.js';

export type { AgentAssembly, AssembleAgentContextOptions } from './types.js';

/** 初始化 AgentDI 中的所有异步组件。调用方在创建 AgentSystem 前必须调用此函数。 */
export async function initializeAgentDI(di: AgentDI): Promise<void> {
  await di.configProvider.init();
  await di.storage.init();
}

export function assembleAgentContext(options: AssembleAgentContextOptions): AgentAssembly {
  const { configProvider, storageProvider, models, runtime } = options;

  const compressor = options.compressor
    ?? new LLMSummarizingCompressor(configProvider.getCompressionConfig(), configProvider.getModelConfig(), models, runtime.env);

  return {
    di: {
      configProvider,
      sessionProvider: new DefaultSessionProvider(storageProvider),
      toolProvider: options.toolProvider ?? new StaticToolProvider(),
      skillProvider: options.skillProvider ?? new EmptySkillProvider(),
      budgetPolicy: options.budgetPolicy ?? new FixedBudgetPolicy(configProvider),
      compressor,
      errorHandler: options.errorHandler ?? new SimpleErrorHandler(),
      titleProvider: options.titleProvider ?? new LLMTitleProvider(configProvider, models),
      storage: storageProvider,
      models,
    },
    runtimeConfig: { runtime },
  };
}
