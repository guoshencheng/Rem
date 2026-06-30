import type {
  AgentConfig,
  AgentBehaviorConfig,
  AgentModelConfig,
  AgentToolConfig,
  ConfigProvider,
  ResolvedAgentConfig,
  ResolvedModelConfig,
} from '../../../sdk/config-provider.js';
import { resolveConfigPath, loadConfigFile } from './config-loader.js';
import { resolveTemplate, resolveOptionalTemplate, pickToolPolicy } from './config-parser.js';
import { mergeFileConfig, mergeEnvConfig, applyBehaviorDefaults } from './config-merger.js';

export interface ConfigFileData {
  [key: string]: unknown;
}

export interface DefaultConfigProviderOptions {
  cwd?: string;
  configPath?: string;
  overrides?: AgentConfig;
  env?: NodeJS.ProcessEnv;
}

export class DefaultConfigProvider implements ConfigProvider {
  private raw?: AgentConfig;
  private env: NodeJS.ProcessEnv;

  constructor(private options: DefaultConfigProviderOptions = {}) {
    this.env = options.env ?? process.env;
  }

  async init(): Promise<void> {
    const cwd = this.options.cwd ?? process.cwd();
    let config: AgentConfig = {};

    const configPath = resolveConfigPath(this.options.configPath, cwd);
    if (configPath) {
      const file = await loadConfigFile(configPath);
      config = mergeFileConfig(config, file);
    }

    config = mergeEnvConfig(config, this.env);

    if (this.options.overrides) {
      config = { ...config, ...this.options.overrides };
      const overridePolicy = pickToolPolicy(this.options.overrides.toolPolicy);
      if (overridePolicy) config.toolPolicy = overridePolicy;
      if (this.options.overrides.model) config.model = this.options.overrides.model;
      if (this.options.overrides.models) config.models = this.options.overrides.models;
      if (this.options.overrides.activeModel) config.activeModel = this.options.overrides.activeModel;
    }

    this.raw = config;
  }

  private getRawConfig(): AgentConfig {
    if (!this.raw) {
      throw new Error('DefaultConfigProvider must be initialized before reading config');
    }
    return this.raw;
  }

  getConfig(): ResolvedAgentConfig {
    return {
      ...this.getBehaviorConfig(),
      policy: this.getToolConfig().policy,
      model: this.getModelConfig(),
    };
  }

  getModelConfig(modelId?: string): ResolvedModelConfig {
    const cfg = this.getRawConfig();
    const id = modelId ?? cfg.activeModel ?? 'default';
    const model = cfg.models?.[id] ?? cfg.model ?? { provider: 'openai', model: '' };

    const resolvedModel = model.model || this.readProviderEnv(model.provider, 'MODEL') || '';
    const resolvedBaseURL =
      resolveOptionalTemplate(model.baseURL, this.env) ??
      this.readProviderEnv(model.provider, 'BASE_URL');

    return {
      provider: model.provider,
      model: resolvedModel,
      apiKey: this.resolveApiKey(model),
      baseURL: resolvedBaseURL,
    };
  }

  private readProviderEnv(provider: string, suffix: string): string | undefined {
    const key = `${provider.toUpperCase()}_${suffix}`;
    const value = this.env[key];
    return value || undefined;
  }

  getToolConfig(): AgentToolConfig {
    const cfg = this.getRawConfig();
    return {
      policy: cfg.toolPolicy,
    };
  }

  getBehaviorConfig(): Required<AgentBehaviorConfig> {
    return applyBehaviorDefaults(this.getRawConfig());
  }

  private resolveApiKey(model: AgentModelConfig): string {
    if (model.apiKeyEnv) {
      const value = this.env[model.apiKeyEnv];
      if (value) return value;
    }
    if (model.apiKey) {
      return resolveTemplate(model.apiKey, this.env);
    }
    const defaultEnv = model.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    return this.env[defaultEnv] ?? '';
  }
}

export function createProvider(options: DefaultConfigProviderOptions = {}): DefaultConfigProvider {
  return new DefaultConfigProvider(options);
}
