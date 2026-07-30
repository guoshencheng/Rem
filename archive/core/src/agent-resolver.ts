import type { AgentResolver, CustomAgentConfig, ResolvedAgentRole } from './sdk/agent-role.js';
import type { AgentBehaviorConfig, ResolvedModelConfig } from './sdk/config-provider.js';
import { log } from './shared/debug-log.js';

export interface AgentResolverOptions {
  behavior: Required<AgentBehaviorConfig>;
  agents?: Record<string, CustomAgentConfig>;
  resolveModel(model: CustomAgentConfig['model']): ResolvedModelConfig | undefined;
}

export class DefaultAgentResolver implements AgentResolver {
  private readonly defaultRole: ResolvedAgentRole;
  private readonly agents: Map<string, ResolvedAgentRole>;

  constructor(private options: AgentResolverOptions) {
    this.defaultRole = this.buildDefaultRole();
    this.agents = this.buildAgentMap();
  }

  resolveAgent(id?: string): ResolvedAgentRole {
    if (id === undefined || id === '') return this.defaultRole;
    const role = this.agents.get(id);
    if (!role) {
      log('agent-resolver', 'unknown agent, fallback to default', { id });
      return this.defaultRole;
    }
    return role;
  }

  private buildDefaultRole(): ResolvedAgentRole {
    const userDefault = this.options.agents?.default;
    return {
      id: 'default',
      name: userDefault?.name ?? this.options.behavior.name,
      corePrompt: userDefault?.corePrompt ?? 'You help users with software engineering and daily tasks by using the tools available to you.',
      model: userDefault?.model ? this.options.resolveModel(userDefault.model) : undefined,
    };
  }

  private buildAgentMap(): Map<string, ResolvedAgentRole> {
    const map = new Map<string, ResolvedAgentRole>();
    for (const [id, cfg] of Object.entries(this.options.agents ?? {})) {
      if (id === 'default') continue;
      if (!cfg.name || !cfg.corePrompt) {
        log('agent-resolver', 'invalid agent config, skipped', { id });
        continue;
      }
      map.set(id, {
        id,
        name: cfg.name,
        corePrompt: cfg.corePrompt,
        model: cfg.model ? this.options.resolveModel(cfg.model) : undefined,
      });
    }
    return map;
  }
}
