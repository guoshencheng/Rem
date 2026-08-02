import type { AgentModelConfig, CompressionConfig, OrchestrationConfig, TeamConfig } from '../../../sdk/config-provider.js';
import type { CustomAgentConfig } from '../../../sdk/agent-role.js';
import type { ToolPolicyConfig } from '../../../sdk/tool-policy.js';
import type { ThinkingLevel } from '@earendil-works/pi-ai';

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveTemplate(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => env[key] ?? '');
}

export function resolveOptionalTemplate(value: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  if (value === undefined) return undefined;
  const resolved = resolveTemplate(value, env);
  return resolved === '' ? undefined : resolved;
}

const THINKING_LEVELS: readonly ThinkingLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value);
}

export function pickToolPolicy(raw: unknown): ToolPolicyConfig | undefined {
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

export function pickModelConfig(raw: unknown): AgentModelConfig | undefined {
  if (!isObject(raw)) return undefined;
  const cfg: AgentModelConfig = { provider: '', model: '' };
  if (typeof raw.provider === 'string') cfg.provider = raw.provider;
  if (typeof raw.model === 'string') cfg.model = raw.model;
  if (typeof raw.apiKey === 'string') cfg.apiKey = raw.apiKey;
  if (typeof raw.baseURL === 'string') cfg.baseURL = raw.baseURL;
  if (isThinkingLevel(raw.reasoning)) cfg.reasoning = raw.reasoning;
  return cfg.provider ? cfg : undefined;
}

export function pickModels(raw: unknown): Record<string, AgentModelConfig> | undefined {
  if (!isObject(raw)) return undefined;
  const result: Record<string, AgentModelConfig> = {};
  for (const [key, value] of Object.entries(raw)) {
    const model = pickModelConfig(value);
    if (model) result[key] = model;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function pickCustomAgentConfig(raw: unknown): CustomAgentConfig | undefined {
  if (!isObject(raw)) return undefined;
  if (typeof raw.name !== 'string') return undefined;
  if (typeof raw.corePrompt !== 'string') return undefined;
  const cfg: CustomAgentConfig = {
    name: raw.name,
    corePrompt: raw.corePrompt,
  };
  const model = pickModelConfig(raw.model);
  if (model) cfg.model = model;
  return cfg;
}

export function pickAgents(raw: unknown): Record<string, CustomAgentConfig> | undefined {
  if (!isObject(raw)) return undefined;
  const result: Record<string, CustomAgentConfig> = {};
  for (const [key, value] of Object.entries(raw)) {
    const agent = pickCustomAgentConfig(value);
    if (agent) result[key] = agent;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function pickTeams(raw: unknown): Record<string, TeamConfig> | undefined {
  if (!isObject(raw)) return undefined;
  const result: Record<string, TeamConfig> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isObject(value) || typeof value.organizer !== 'string' || !Array.isArray(value.members)) continue;
    if (!value.members.every((member) => typeof member === 'string')) continue;
    result[id] = { organizer: value.organizer, members: value.members };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function pickOrchestrationConfig(raw: unknown): OrchestrationConfig | undefined {
  if (!isObject(raw)) return undefined;
  const config: OrchestrationConfig = {};
  for (const key of ['maxAgentRuns', 'maxMessages', 'maxDepth', 'timeoutMs', 'maxTokens', 'maxParallelAgents'] as const) {
    if (typeof raw[key] === 'number') config[key] = raw[key];
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

export function pickCompressionConfig(raw: unknown): CompressionConfig | undefined {
  if (!isObject(raw)) return undefined;
  const cfg: CompressionConfig = {};
  if (typeof raw.enabled === 'boolean') cfg.enabled = raw.enabled;
  if (typeof raw.thresholdRatio === 'number') cfg.thresholdRatio = raw.thresholdRatio;
  if (typeof raw.protectHead === 'number') cfg.protectHead = raw.protectHead;
  if (typeof raw.protectTail === 'number') cfg.protectTail = raw.protectTail;
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}
