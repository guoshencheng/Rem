import { registerBuiltInProviders } from './llm/providers/index.js';
import type { ProviderConfig } from './llm/types.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { ConfigProvider } from './sdk/config-provider.js';
import type { ProviderReference } from './sdk/provider-loader.js';
import type { ToolPolicyConfig } from './sdk/tool-policy.js';
import { createProviderManager } from './provider-manager.js';

export interface CreateAgentOptions {
  name?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  maxTurns?: number;
  sessionProvider?: SessionProvider;
  skillProvider?: ProviderReference<SkillProvider>;
  configProvider?: ConfigProvider;
  configPath?: string;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  toolPolicy?: ToolPolicyConfig;
}

export async function createAgentFromEnv(options?: CreateAgentOptions) {
  registerBuiltInProviders();

  const configProvider = options?.configProvider;
  const behavior = configProvider?.getBehaviorConfig?.();
  const modelCfg = configProvider?.getModelConfig?.(options?.provider);
  const provider = options?.provider ?? modelCfg?.provider ?? 'openai';

  const providerConfig: ProviderConfig | undefined =
    options?.provider !== undefined
      ? {
          model: options.model ?? '',
          apiKey: options.apiKey ?? '',
          baseURL: options.baseURL,
        }
      : options?.model !== undefined || options?.apiKey !== undefined || options?.baseURL !== undefined
        ? {
            model: options.model ?? modelCfg?.model ?? '',
            apiKey: options.apiKey ?? modelCfg?.apiKey ?? '',
            baseURL: options.baseURL ?? modelCfg?.baseURL,
          }
        : modelCfg
          ? {
              model: modelCfg.model,
              apiKey: modelCfg.apiKey,
              baseURL: modelCfg.baseURL,
            }
          : undefined;

  const name = options?.name ?? behavior?.name ?? 'Rem Agent';
  const maxTurns = options?.maxTurns ?? behavior?.maxTurns ?? 60;

  const pm = await createProviderManager({
    configProvider: options?.configProvider,
    configPath: options?.configPath,
    sessionProvider: options?.sessionProvider,
    skillProvider: options?.skillProvider ?? 'file',
    workspaceRoot: options?.workspaceRoot ?? behavior?.workspaceRoot ?? process.cwd(),
    readOnly: options?.readOnly ?? behavior?.readOnly ?? false,
    autoApproveDangerous: options?.autoApproveDangerous ?? behavior?.autoApproveDangerous ?? false,
    toolPolicy: options?.toolPolicy ?? configProvider?.getToolConfig?.().policy,
  });

  return { pm, name, maxTurns, provider, providerConfig };
}
