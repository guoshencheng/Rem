import type {
  AgentConfig,
  AgentBehaviorConfig,
  AgentModelConfig,
  AgentToolConfig,
  ConfigProvider,
  ResolvedAgentConfig,
  ResolvedModelConfig,
} from '../../../sdk/config-provider.js';
import type { AgentResolver, ResolvedAgentRole } from '../../../sdk/agent-role.js';
import type { McpServerConfig } from '../../../mcp/types.js';
import type { AgentPaths } from '../../../config/paths.js';
import { resolveConfigPath, loadConfigFile, resolveConfigPaths } from './config-loader.js';
import { resolveTemplate, resolveOptionalTemplate, isThinkingLevel } from './config-parser.js';
import {
  mergeFileConfig,
  mergeEnvConfig,
  applyBehaviorDefaults,
  mergeDeepConfig,
} from './config-merger.js';
import { DefaultAgentResolver } from '../../../agent-resolver.js';

export interface ConfigFileData {
  [key: string]: unknown;
}

export interface DefaultConfigProviderOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  paths?: AgentPaths;
}

export class DefaultConfigProvider implements ConfigProvider {
  private raw?: AgentConfig;
  private env: NodeJS.ProcessEnv;
  private _paths?: AgentPaths;
  private agentResolver?: AgentResolver;

  constructor(private options: DefaultConfigProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this._paths = options.paths;
  }

  private async resolvePaths(): Promise<AgentPaths> {
    if (this._paths) return this._paths;
    const { createDefaultAgentPaths } = await import('../../../config/paths.js');
    this._paths = createDefaultAgentPaths({ env: this.env });
    return this._paths;
  }

  async init(): Promise<void> {
    let config: AgentConfig = {};

    const paths = await this.resolvePaths();

    const homePath = resolveConfigPaths(paths.homeConfigCandidates())[0];
    if (homePath) {
      const homeFile = await loadConfigFile(homePath);
      config = mergeFileConfig(config, homeFile);
    }

    const workspacePath = this.options.configPath
      ? resolveConfigPath(this.options.configPath, paths)
      : resolveConfigPaths(paths.workspaceConfigCandidates())[0];
    if (workspacePath) {
      const workspaceFile = await loadConfigFile(workspacePath);
      config = mergeDeepConfig(config, workspaceFile);
    }

    config = mergeEnvConfig(config, this.env);

    this.raw = config;

    this.agentResolver = new DefaultAgentResolver({
      behavior: this.getBehaviorConfig(),
      agents: this.raw.agents,
      resolveModel: (model) => {
        if (!model || !model.provider || !model.model) return undefined;
        return this.resolveModelConfig(model);
      },
    });
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
    return this.resolveModelConfig(model);
  }

  private resolveModelConfig(model: AgentModelConfig): ResolvedModelConfig {
    const resolvedModel = model.model || this.readProviderEnv(model.provider, 'MODEL') || '';
    const resolvedBaseURL =
      resolveOptionalTemplate(model.baseURL, this.env) ??
      this.readProviderEnv(model.provider, 'BASE_URL');
    const configuredReasoning = model.reasoning ?? this.readProviderEnv(model.provider, 'REASONING_LEVEL');
    return {
      provider: model.provider,
      model: resolvedModel,
      apiKey: model.apiKey ? resolveTemplate(model.apiKey, this.env) : '',
      baseURL: resolvedBaseURL,
      reasoning: isThinkingLevel(configuredReasoning) ? configuredReasoning : undefined,
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
    if (!this._paths) {
      throw new Error('DefaultConfigProvider must be initialized before reading behavior config');
    }
    return applyBehaviorDefaults(this.getRawConfig(), this._paths.sessionsDir);
  }

  getMcpConfig(): Record<string, McpServerConfig> {
    const cfg = this.getRawConfig();
    const servers = cfg.mcpServers ?? {};
    const resolved: Record<string, McpServerConfig> = {};
    for (const [key, config] of Object.entries(servers)) {
      resolved[key] = this.resolveMcpServerConfig(config);
    }
    return resolved;
  }

  getCompressionConfig(): Required<import('../../../sdk/config-provider.js').CompressionConfig> {
    return this.getBehaviorConfig().compression as Required<import('../../../sdk/config-provider.js').CompressionConfig>;
  }

  resolveAgent(id?: string): ResolvedAgentRole {
    if (!this.agentResolver) {
      throw new Error('DefaultConfigProvider must be initialized before resolving agent');
    }
    return this.agentResolver.resolveAgent(id);
  }

  private resolveMcpServerConfig(config: McpServerConfig): McpServerConfig {
    const resolved: McpServerConfig = { ...config } as any;
    if (config.env) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(config.env)) {
        env[k] = resolveTemplate(v, this.env);
      }
      (resolved as any).env = env;
    }
    return resolved;
  }

}
