import type { AgentModelConfig } from '../../../sdk/config-provider.js';
import type { ToolPolicyConfig } from '../../../sdk/tool-policy.js';

function isObject(value: unknown): value is Record<string, unknown> {
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
  if (typeof raw.apiKeyEnv === 'string') cfg.apiKeyEnv = raw.apiKeyEnv;
  if (typeof raw.baseURL === 'string') cfg.baseURL = raw.baseURL;
  return cfg.provider && cfg.model ? cfg : undefined;
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
