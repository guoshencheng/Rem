import type {
  AgentConfig,
  AgentBehaviorConfig,
  AgentToolConfig,
  ConfigProvider,
  ResolvedAgentConfig,
  ResolvedModelConfig,
  ResolvedOrchestrationConfig,
  TeamInfo,
} from '../../../sdk/config-provider.js';
import type { AgentResolver, ResolvedAgentRole, ResolvedTeam } from '../../../sdk/agent-role.js';
import type { AgentPaths } from '../../../infrastructure/config/paths.js';
import { loadConfigFile, loadConfigFileSync, resolveConfigPaths } from './config-loader.js';
import { mergeFileConfig, mergeEnvConfig, applyBehaviorDefaults, mergeDeepConfig } from './config-merger.js';
import { DefaultAgentResolver } from './agent-resolver.js';
import { resolveModelConfig } from './model-config-resolver.js';
import { TeamResolver } from './team-resolver.js';

export interface DefaultConfigProviderOptions {
  env?: NodeJS.ProcessEnv;
  paths?: AgentPaths;
}

export class DefaultConfigProvider implements ConfigProvider {
  private raw?: AgentConfig;
  private rawHome?: AgentConfig;
  private env: NodeJS.ProcessEnv;
  private _paths?: AgentPaths;
  private agentResolver?: AgentResolver;
  private teamResolver?: TeamResolver;
  private workspaceCache = new Map<string, ConfigProvider>();

  constructor(private options: DefaultConfigProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this._paths = options.paths;
    if (this._paths) {
      this.loadSync();
    }
  }

  private loadSync(): void {
    const paths = this._paths as AgentPaths;
    let home: AgentConfig = {};
    const homePath = resolveConfigPaths(paths.homeConfigCandidates())[0];
    if (homePath) {
      home = mergeFileConfig(home, loadConfigFileSync(homePath));
    }
    this.rawHome = home;
    this.raw = mergeEnvConfig(home, this.env);
    this.initResolver();
  }

  private async resolvePaths(): Promise<AgentPaths> {
    if (this._paths) return this._paths;
    const { createDefaultAgentPaths } = await import('../../../infrastructure/config/paths.js');
    this._paths = createDefaultAgentPaths({ env: this.env });
    return this._paths;
  }

  async init(): Promise<void> {
    if (this._paths) {
      this.loadSync();
      return;
    }
    let home: AgentConfig = {};

    const paths = await this.resolvePaths();

    const homePath = resolveConfigPaths(paths.homeConfigCandidates())[0];
    if (homePath) {
      const homeFile = await loadConfigFile(homePath);
      home = mergeFileConfig(home, homeFile);
    }

    this.rawHome = home;
    this.raw = mergeEnvConfig(home, this.env);
    this.initResolver();
  }

  forWorkspace(workspace: string): ConfigProvider {
    const cached = this.workspaceCache.get(workspace);
    if (cached) return cached;

    const workspacePath = resolveConfigPaths(
      (this._paths as AgentPaths).workspaceConfigCandidates(workspace),
    )[0];

    // 合并优先级：home < workspace 配置文件 < env
    let raw = this.getRawConfig();
    if (workspacePath) {
      raw = mergeEnvConfig(mergeDeepConfig(this.rawHome ?? {}, loadConfigFileSync(workspacePath)), this.env);
    }

    const scoped = new DefaultConfigProvider({ env: this.env, paths: this._paths });
    scoped.raw = raw;
    scoped.initResolver();
    this.workspaceCache.set(workspace, scoped);
    return scoped;
  }

  private initResolver(): void {
    this.agentResolver = new DefaultAgentResolver({
      behavior: this.getBehaviorConfig(),
      agents: this.getRawConfig().agents,
      resolveModel: (model) => {
        if (!model || !model.provider || !model.model) return undefined;
        return resolveModelConfig(model, this.env);
      },
    });
    this.teamResolver = new TeamResolver(
      this.getRawConfig().teams ?? {},
      (id) => this.resolveAgent(id),
    );
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
    let model;
    if (modelId !== undefined) {
      const models = cfg.models;
      if (!models || !Object.hasOwn(models, modelId)) throw new Error(`Unknown model: ${safeModelId(modelId)}`);
      model = models[modelId];
    } else {
      const id = cfg.activeModel ?? 'default';
      model = cfg.models && Object.hasOwn(cfg.models, id) ? cfg.models[id] : cfg.model ?? { provider: 'openai', model: '' };
    }
    return resolveModelConfig(model, this.env);
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
    return applyBehaviorDefaults(this.getRawConfig());
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

  resolveTeam(id: string): ResolvedTeam {
    if (!this.teamResolver) throw new Error('DefaultConfigProvider must be initialized before resolving team');
    return this.teamResolver.resolveTeam(id);
  }

  listTeams(): TeamInfo[] {
    const teams = this.getRawConfig().teams ?? {};
    return Object.entries(teams).map(([id, team]) => ({
      id,
      organizer: team.organizer,
      members: [...team.members],
    }));
  }

  getOrchestrationConfig(): ResolvedOrchestrationConfig {
    const config = this.getRawConfig().orchestration;
    return {
      maxAgentRuns: config?.maxAgentRuns ?? 20,
      maxMessages: config?.maxMessages ?? 50,
      maxDepth: config?.maxDepth ?? 8,
      timeoutMs: config?.timeoutMs ?? 300_000,
      maxTokens: config?.maxTokens ?? 200_000,
      maxParallelAgents: config?.maxParallelAgents ?? 4,
    };
  }
}

function safeModelId(value: string): string { return value.replace(/[\r\n\t]/g, ' ').slice(0, 200); }
