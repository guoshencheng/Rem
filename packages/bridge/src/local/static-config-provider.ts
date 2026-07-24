import type {
  AgentBehaviorConfig, AgentToolConfig, CompressionConfig, ConfigProvider,
  McpServerConfig, ResolvedAgentConfig, ResolvedAgentRole, ResolvedModelConfig,
} from 'rem-agent-core/browser';

export interface StaticConfigOptions {
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  name?: string;
  maxTurns?: number;
  workspaceRoot?: string;
}

/** 浏览器用 ConfigProvider：配置全部来自构造参数，不读文件、不读 env。 */
export class StaticConfigProvider implements ConfigProvider {
  constructor(private options: StaticConfigOptions) {}

  getConfig(): ResolvedAgentConfig {
    return { ...this.getBehaviorConfig(), model: this.getModelConfig() };
  }

  getModelConfig(): ResolvedModelConfig {
    return {
      provider: this.options.provider,
      model: this.options.model,
      apiKey: this.options.apiKey,
      baseURL: this.options.baseURL,
    };
  }

  getToolConfig(): AgentToolConfig {
    return {};
  }

  getBehaviorConfig(): Required<AgentBehaviorConfig> {
    return {
      name: this.options.name ?? 'Rem',
      maxTurns: this.options.maxTurns ?? 60,
      workspaceRoot: this.options.workspaceRoot ?? '/',
      readOnly: false,
      autoApproveDangerous: true,
      sessionsDir: '',
      profile: 'coding',
      sessionRules: [],
      compression: this.getCompressionConfig(),
    };
  }

  getCompressionConfig(): Required<CompressionConfig> {
    return { enabled: false, thresholdRatio: 0.8, protectHead: 4, protectTail: 8 };
  }

  getMcpConfig(): Record<string, McpServerConfig> {
    return {};
  }

  resolveAgent(): ResolvedAgentRole {
    return {
      id: 'default',
      name: this.options.name ?? 'Rem',
      corePrompt: '',
    };
  }
}
