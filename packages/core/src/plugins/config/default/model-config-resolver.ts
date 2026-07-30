import type { AgentModelConfig, ResolvedModelConfig } from '../../../sdk/config-provider.js';
import { isThinkingLevel, resolveOptionalTemplate, resolveTemplate } from './config-parser.js';

/** 解析单个模型配置：空值回落到 <PROVIDER>_* 环境变量，apiKey/baseURL 支持 ${VAR} 模板 */
export function resolveModelConfig(model: AgentModelConfig, env: NodeJS.ProcessEnv): ResolvedModelConfig {
  const resolvedModel = model.model || readProviderEnv(model.provider, 'MODEL', env) || '';
  const resolvedBaseURL =
    resolveOptionalTemplate(model.baseURL, env) ?? readProviderEnv(model.provider, 'BASE_URL', env);
  const configuredReasoning = model.reasoning ?? readProviderEnv(model.provider, 'REASONING_LEVEL', env);
  return {
    provider: model.provider,
    model: resolvedModel,
    apiKey: model.apiKey ? resolveTemplate(model.apiKey, env) : '',
    baseURL: resolvedBaseURL,
    reasoning: isThinkingLevel(configuredReasoning) ? configuredReasoning : undefined,
  };
}

export function readProviderEnv(provider: string, suffix: string, env: NodeJS.ProcessEnv): string | undefined {
  const key = `${provider.toUpperCase()}_${suffix}`;
  const value = env[key];
  return value || undefined;
}
