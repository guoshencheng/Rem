import type { AgentPaths } from '../../../infrastructure/config/paths.js';
import type {
  ResolvedRuntimeModelConfig, RuntimeConfigProvider, RuntimeDefaults,
  RuntimeModelConfig,
} from '../../../sdk/runtime-config-provider.js';
import { loadConfigFile, resolveConfigPaths } from './config-loader.js';

export interface DefaultRuntimeConfigProviderOptions {
  env?: NodeJS.ProcessEnv;
  paths?: AgentPaths;
}

/** File/env backed configuration for Runtime; agent and team resolvers are intentionally absent. */
export class DefaultRuntimeConfigProvider implements RuntimeConfigProvider {
  private raw?: RuntimeConfigFile;
  private readonly env: NodeJS.ProcessEnv;
  private paths?: AgentPaths;

  constructor(options: DefaultRuntimeConfigProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.paths = options.paths;
  }

  async init(): Promise<void> {
    if (!this.paths) {
      const { createDefaultAgentPaths } = await import('../../../infrastructure/config/paths.js');
      this.paths = createDefaultAgentPaths({ env: this.env });
    }
    let raw: RuntimeConfigFile = {};
    const path = resolveConfigPaths(this.paths.homeConfigCandidates())[0];
    if (path) raw = mergeConfig(raw, await loadConfigFile(path));
    this.raw = mergeEnvironment(raw, this.env);
  }

  getDefaults(): RuntimeDefaults {
    const raw = this.requireRaw();
    const behavior = behaviorDefaults(raw);
    return {
      config: { ...raw },
      behavior: {
        name: behavior.name,
        maxTurns: behavior.maxTurns,
        executionRoot: this.executionRoot(raw, behavior.executionRoot),
        readOnly: behavior.readOnly,
        autoApproveDangerous: behavior.autoApproveDangerous,
      },
      compression: {
        enabled: raw.compression?.enabled ?? true,
        thresholdRatio: raw.compression?.thresholdRatio ?? 0.8,
        protectHead: raw.compression?.protectHead ?? 3,
        protectTail: raw.compression?.protectTail ?? 20,
      },
      tool: { policy: isRecord(raw.toolPolicy) ? raw.toolPolicy as never : undefined },
      orchestration: {
        maxAgentRuns: raw.orchestration?.maxAgentRuns ?? 20,
        maxMessages: raw.orchestration?.maxMessages ?? 50,
        maxDepth: raw.orchestration?.maxDepth ?? 8,
        timeoutMs: raw.orchestration?.timeoutMs ?? 300_000,
        maxTokens: raw.orchestration?.maxTokens ?? 200_000,
        maxParallelAgents: raw.orchestration?.maxParallelAgents ?? 4,
      },
    };
  }

  resolveModel(modelId: string): ResolvedRuntimeModelConfig {
    const raw = this.requireRaw();
    const configured = modelId === 'default'
      ? this.defaultModel(raw)
      : raw.models?.[modelId];
    if (!configured) throw new Error(`Unknown model: ${safeModelId(modelId)}`);
    return resolveModelConfig(configured, this.env);
  }

  private defaultModel(raw: RuntimeConfigFile): RuntimeModelConfig {
    const active = raw.activeModel ?? 'default';
    return raw.models?.[active] ?? raw.model ?? { provider: 'openai', model: '' };
  }

  private requireRaw(): RuntimeConfigFile {
    if (!this.raw) throw new Error('RuntimeConfigProvider must be initialized before reading configuration');
    return this.raw;
  }

  private executionRoot(raw: RuntimeConfigFile, fallback: string): string {
    const value = raw.executionRoot;
    return typeof value === 'string' && value.trim() ? value : fallback;
  }
}

function safeModelId(value: string): string { return value.replace(/[\r\n\t]/g, ' ').slice(0, 200); }

interface RuntimeConfigFile {
  [key: string]: unknown;
  name?: string;
  maxTurns?: number;
  executionRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  model?: RuntimeModelConfig;
  models?: Record<string, RuntimeModelConfig>;
  activeModel?: string;
  toolPolicy?: unknown;
  compression?: { enabled?: boolean; thresholdRatio?: number; protectHead?: number; protectTail?: number };
  orchestration?: Partial<RuntimeDefaults['orchestration']>;
}

function mergeConfig(base: RuntimeConfigFile, file: Record<string, unknown>): RuntimeConfigFile {
  const result: RuntimeConfigFile = { ...base };
  for (const key of ['name', 'maxTurns', 'executionRoot', 'readOnly', 'autoApproveDangerous', 'activeModel'] as const) {
    if (file[key] !== undefined) result[key] = file[key] as never;
  }
  for (const key of ['model', 'models', 'toolPolicy', 'compression', 'orchestration'] as const) {
    if (isRecord(file[key])) result[key] = mergeObject(result[key], file[key]) as never;
  }
  return result;
}

function mergeEnvironment(base: RuntimeConfigFile, env: NodeJS.ProcessEnv): RuntimeConfigFile {
  const result = { ...base };
  if (env.REM_AGENT_NAME) result.name = env.REM_AGENT_NAME;
  if (env.REM_AGENT_MAX_TURNS) result.maxTurns = Number.parseInt(env.REM_AGENT_MAX_TURNS, 10);
  if (env.REM_EXECUTION_ROOT) result.executionRoot = env.REM_EXECUTION_ROOT;
  if (env.REM_AGENT_READ_ONLY) result.readOnly = env.REM_AGENT_READ_ONLY === 'true';
  if (env.REM_AGENT_AUTO_APPROVE_DANGEROUS) result.autoApproveDangerous = env.REM_AGENT_AUTO_APPROVE_DANGEROUS === 'true';
  if (env.REM_AGENT_ACTIVE_MODEL) result.activeModel = env.REM_AGENT_ACTIVE_MODEL;
  return result;
}

function behaviorDefaults(raw: RuntimeConfigFile): RuntimeDefaults['behavior'] {
  return {
    name: raw.name ?? 'Rem Agent', maxTurns: raw.maxTurns ?? 60,
    executionRoot: raw.executionRoot ?? process.cwd(),
    readOnly: raw.readOnly ?? false, autoApproveDangerous: raw.autoApproveDangerous ?? false,
  };
}

function resolveModelConfig(model: RuntimeModelConfig, env: NodeJS.ProcessEnv): ResolvedRuntimeModelConfig {
  const provider = model.provider;
  const modelName = model.model || readProviderEnv(provider, 'MODEL', env) || '';
  const apiKey = model.apiKey ? resolveApiKeyTemplate(model.apiKey, env) : readProviderEnv(provider, 'API_KEY', env) ?? '';
  const baseURL = model.baseURL ? resolveApiKeyTemplate(model.baseURL, env) : readProviderEnv(provider, 'BASE_URL', env);
  return { provider, model: modelName, apiKey, ...(baseURL ? { baseURL } : {}), ...(model.reasoning ? { reasoning: model.reasoning } : {}) };
}

function resolveApiKeyTemplate(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => env[key] || `\${${key}}`);
}

function readProviderEnv(provider: string, suffix: string, env: NodeJS.ProcessEnv): string | undefined {
  return env[`${provider.toUpperCase()}_${suffix}`] || undefined;
}

function mergeObject(base: unknown, value: Record<string, unknown>): Record<string, unknown> {
  return { ...(isRecord(base) ? base : {}), ...value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
