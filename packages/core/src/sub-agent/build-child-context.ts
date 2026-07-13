import type { AgentContext } from '../agent-context.js';
import type { ConfigProvider, AgentToolConfig, ResolvedModelConfig, ResolvedAgentConfig, AgentBehaviorConfig } from '../sdk/config-provider.js';
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
}

class StaticSystemPromptAssembler implements SystemPromptAssembler {
  constructor(private prompt: string) {}

  async assemble(_ctx: PromptBuildContext): Promise<string> {
    return this.prompt;
  }
}

export function buildChildContext(
  parentCtx: AgentContext,
  options?: BuildChildContextOptions,
): AgentContext {
  const childConfigProvider = new ChildConfigProvider(parentCtx.configProvider, {
    maxTurns: options?.maxTurns,
  });
  const permissionEvaluator = createPermissionEvaluator(
    'auto' as SecurityMode,
    parentCtx.ruleEngine,
  );

  return {
    ...parentCtx,
    configProvider: childConfigProvider,
    securityMode: 'auto',
    permissionEvaluator,
    systemPromptAssembler: options?.systemPrompt
      ? new StaticSystemPromptAssembler(options.systemPrompt)
      : parentCtx.systemPromptAssembler,
  };
}
