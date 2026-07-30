import type { AgentDI } from '../agent-di.js';
import type { AgentRuntimeConfig } from '../agent-runtime-config.js';
import type { ConfigProvider, AgentToolConfig, ResolvedModelConfig, ResolvedAgentConfig, AgentBehaviorConfig, CompressionConfig } from '../sdk/config-provider.js';
import type { ResolvedAgentRole } from '../sdk/agent-role.js';
import type { McpServerConfig } from '../mcp/types.js';
import type { SystemPromptAssembler, PromptBuildContext } from '../sdk/system-prompt.js';
import { createPermissionEvaluator, type SecurityMode } from '../security/permissions/factory.js';

export interface BuildChildContextOptions {
  maxTurns?: number;
  systemPrompt?: string;
}

class ChildConfigProvider implements ConfigProvider {
  constructor(
    private parent: ConfigProvider,
    private overrides: { maxTurns?: number },
  ) {}

  async init(): Promise<void> {
    // 子 agent 的 parent 已初始化；不可委托 parent.init()（DefaultConfigProvider.init 重跑会覆盖 forWorkspace 合并结果）
  }

  getConfig(): ResolvedAgentConfig {
    return { ...this.parent.getConfig(), ...this.getBehaviorConfig() };
  }

  getModelConfig(modelId?: string): ResolvedModelConfig {
    return this.parent.getModelConfig(modelId);
  }

  getToolConfig(): AgentToolConfig {
    return this.parent.getToolConfig();
  }

  getBehaviorConfig(): Required<AgentBehaviorConfig> {
    const base = this.parent.getBehaviorConfig();
    return { ...base, maxTurns: this.overrides.maxTurns ?? base.maxTurns };
  }

  getMcpConfig(): Record<string, McpServerConfig> {
    return this.parent.getMcpConfig();
  }

  getCompressionConfig(): Required<CompressionConfig> {
    return this.parent.getCompressionConfig();
  }

  resolveAgent(id?: string): ResolvedAgentRole {
    return this.parent.resolveAgent(id);
  }

  forWorkspace(workspace: string): ConfigProvider {
    const scoped = this.parent.forWorkspace?.(workspace) ?? this.parent;
    return new ChildConfigProvider(scoped, this.overrides);
  }
}

class StaticSystemPromptAssembler implements SystemPromptAssembler {
  constructor(private prompt: string) {}

  async assemble(_ctx: PromptBuildContext): Promise<string> {
    return this.prompt;
  }
}

export function buildChildContext(
  di: AgentDI,
  runtimeConfig: AgentRuntimeConfig,
  options?: BuildChildContextOptions,
): { di: AgentDI; runtimeConfig: AgentRuntimeConfig } {
  const childConfigProvider = new ChildConfigProvider(di.configProvider, {
    maxTurns: options?.maxTurns,
  });
  const permissionEvaluator = createPermissionEvaluator(
    'auto' as SecurityMode,
    di.ruleEngine,
  );

  return {
    di: {
      ...di,
      configProvider: childConfigProvider,
      permissionEvaluator,
      systemPromptAssembler: options?.systemPrompt
        ? new StaticSystemPromptAssembler(options.systemPrompt)
        : di.systemPromptAssembler,
    },
    runtimeConfig: { ...runtimeConfig, securityMode: 'auto' },
  };
}
