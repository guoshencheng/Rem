import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type {
  AgentConfig,
  AgentBehaviorConfig,
  AgentModelConfig,
  AgentToolConfig,
  ConfigProvider,
  ResolvedAgentConfig,
  ResolvedModelConfig,
} from '../../../sdk/config-provider.js';
import type { ToolPolicyConfig } from '../../../sdk/tool-policy.js';
import { resolveTilde, getDefaultSessionsDir, getDefaultSkillsDir } from '../../../config/paths.js';

export interface ConfigFileData {
  [key: string]: unknown;
}

export interface DefaultConfigProviderOptions {
  cwd?: string;
  configPath?: string;
  overrides?: AgentConfig;
  env?: NodeJS.ProcessEnv;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadConfigFile(path: string): Promise<ConfigFileData> {
  const resolved = resolveTilde(path);
  const content = await readFile(resolved, 'utf8');
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(content) as ConfigFileData;
  }
  const { parse } = await import('yaml');
  return parse(content) as ConfigFileData;
}

function resolveConfigPath(
  explicitPath: string | undefined,
  cwd: string,
): string | undefined {
  if (explicitPath) return resolveTilde(explicitPath);
  const candidates = [
    join(cwd, 'rem-agent.config.json'),
    join(cwd, 'rem-agent.config.yaml'),
    join(cwd, 'rem-agent.config.yml'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function resolveTemplate(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => env[key] ?? '');
}

function resolveOptionalTemplate(value: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  if (value === undefined) return undefined;
  const resolved = resolveTemplate(value, env);
  return resolved === '' ? undefined : resolved;
}

function pickToolPolicy(raw: unknown): ToolPolicyConfig | undefined {
  if (!isObject(raw)) return undefined;
  const policy: ToolPolicyConfig = {};
  if (typeof raw.profile === 'string') policy.profile = raw.profile as ToolPolicyConfig['profile'];
  if (Array.isArray(raw.allow)) policy.allow = raw.allow as string[];
  if (Array.isArray(raw.alsoAllow)) policy.alsoAllow = raw.alsoAllow as string[];
  if (Array.isArray(raw.deny)) policy.deny = raw.deny as string[];
  if (isObject(raw.byProvider)) {
    policy.byProvider = Object.fromEntries(
      Object.entries(raw.byProvider).map(([k, v]) => [k, pickToolPolicy(v) ?? {}]),
    );
  }
  if (isObject(raw.toolsBySender)) {
    policy.toolsBySender = Object.fromEntries(
      Object.entries(raw.toolsBySender).map(([k, v]) => [k, pickToolPolicy(v) ?? {}]),
    );
  }
  if (isObject(raw.sandbox)) {
    policy.sandbox = {
      mode: typeof raw.sandbox.mode === 'string' ? (raw.sandbox.mode as 'off' | 'non-main' | 'all') : undefined,
      tools: pickToolPolicy(raw.sandbox.tools),
    };
  }
  return Object.keys(policy).length > 0 ? policy : undefined;
}

function pickModelConfig(raw: unknown): AgentModelConfig | undefined {
  if (!isObject(raw)) return undefined;
  const cfg: AgentModelConfig = { provider: '', model: '' };
  if (typeof raw.provider === 'string') cfg.provider = raw.provider;
  if (typeof raw.model === 'string') cfg.model = raw.model;
  if (typeof raw.apiKey === 'string') cfg.apiKey = raw.apiKey;
  if (typeof raw.apiKeyEnv === 'string') cfg.apiKeyEnv = raw.apiKeyEnv;
  if (typeof raw.baseURL === 'string') cfg.baseURL = raw.baseURL;
  return cfg.provider && cfg.model ? cfg : undefined;
}

function pickModels(raw: unknown): Record<string, AgentModelConfig> | undefined {
  if (!isObject(raw)) return undefined;
  const result: Record<string, AgentModelConfig> = {};
  for (const [key, value] of Object.entries(raw)) {
    const model = pickModelConfig(value);
    if (model) result[key] = model;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function mergeFileConfig(base: AgentConfig, file: Record<string, unknown>): AgentConfig {
  const merged: AgentConfig = { ...base };
  if (typeof file.name === 'string') merged.name = file.name;
  if (typeof file.maxTurns === 'number') merged.maxTurns = file.maxTurns;
  if (typeof file.workspaceRoot === 'string') merged.workspaceRoot = file.workspaceRoot;
  if (typeof file.readOnly === 'boolean') merged.readOnly = file.readOnly;
  if (typeof file.sessionsDir === 'string') merged.sessionsDir = file.sessionsDir;
  if (typeof file.skillsDir === 'string') merged.skillsDir = file.skillsDir;
  const toolPolicy = pickToolPolicy(file.toolPolicy);
  if (toolPolicy) merged.toolPolicy = toolPolicy;
  const models = pickModels(file.models);
  if (models) merged.models = models;
  const singleModel = pickModelConfig(file.model);
  if (singleModel) merged.model = singleModel;
  if (typeof file.activeModel === 'string') merged.activeModel = file.activeModel;
  return merged;
}

function mergeEnvConfig(base: AgentConfig, env: NodeJS.ProcessEnv): AgentConfig {
  const merged: AgentConfig = { ...base };
  if (env.REM_AGENT_NAME) merged.name = env.REM_AGENT_NAME;
  if (env.REM_AGENT_MAX_TURNS) merged.maxTurns = parseInt(env.REM_AGENT_MAX_TURNS, 10);
  if (env.REM_AGENT_WORKSPACE_ROOT) merged.workspaceRoot = env.REM_AGENT_WORKSPACE_ROOT;
  if (env.REM_AGENT_READ_ONLY) merged.readOnly = env.REM_AGENT_READ_ONLY === 'true';
  if (env.REM_AGENT_SESSIONS_DIR) merged.sessionsDir = env.REM_AGENT_SESSIONS_DIR;
  if (env.REM_AGENT_SKILLS_DIR) merged.skillsDir = env.REM_AGENT_SKILLS_DIR;
  if (env.REM_AGENT_ACTIVE_MODEL) merged.activeModel = env.REM_AGENT_ACTIVE_MODEL;
  return merged;
}

function applyBehaviorDefaults(config: AgentConfig): Required<AgentBehaviorConfig> {
  return {
    name: config.name ?? 'Rem Agent',
    maxTurns: config.maxTurns ?? 60,
    workspaceRoot: config.workspaceRoot ?? process.cwd(),
    readOnly: config.readOnly ?? false,
    sessionsDir: config.sessionsDir ?? getDefaultSessionsDir(),
    skillsDir: config.skillsDir ?? getDefaultSkillsDir(),
  };
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
