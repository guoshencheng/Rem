import type { AgentModelConfig, CompressionConfig } from '../../../sdk/config-provider.js';
import type { CustomAgentConfig } from '../../../sdk/agent-role.js';
import type { ToolPolicyConfig } from '../../../sdk/tool-policy.js';
import type { McpServerConfig } from '../../../mcp/types.js';

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

export function pickCompressionConfig(raw: unknown): CompressionConfig | undefined {
  if (!isObject(raw)) return undefined;
  const cfg: CompressionConfig = {};
  if (typeof raw.enabled === 'boolean') cfg.enabled = raw.enabled;
  if (typeof raw.thresholdRatio === 'number') cfg.thresholdRatio = raw.thresholdRatio;
  if (typeof raw.protectHead === 'number') cfg.protectHead = raw.protectHead;
  if (typeof raw.protectTail === 'number') cfg.protectTail = raw.protectTail;
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}

export function pickMcpConfig(raw: unknown): Record<string, McpServerConfig> | undefined {
  if (!isObject(raw)) return undefined;
  const result: Record<string, McpServerConfig> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isObject(value)) continue;
    const transport = value.transport;
    if (transport !== 'stdio' && transport !== 'sse') continue;

    let base: McpServerConfig;
    if (transport === 'stdio') {
      base = { transport: 'stdio', command: '' };
      if (typeof value.command === 'string') base.command = value.command;
    } else {
      base = { transport: 'sse', url: '' };
      if (typeof value.url === 'string') base.url = value.url;
    }

    if (Array.isArray(value.args)) (base as any).args = value.args;
    if (isObject(value.env)) (base as any).env = value.env as Record<string, string>;
    if (typeof value.prefix === 'string') (base as any).prefix = value.prefix;
    if (typeof value.disabled === 'boolean') (base as any).disabled = value.disabled;
    if (typeof value.timeoutMs === 'number') (base as any).timeoutMs = value.timeoutMs;
    result[key] = base;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
