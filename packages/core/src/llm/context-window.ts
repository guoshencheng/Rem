import { debugLog } from '../shared/debug-log.js';

export interface ContextWindowEntry {
  maxTokens: number;
}

const BUILT_IN_CONTEXT_WINDOWS = new Map<string, ContextWindowEntry>([
  ['openai:gpt-4o', { maxTokens: 128_000 }],
  ['openai:gpt-4o-mini', { maxTokens: 128_000 }],
  ['openai:gpt-4-turbo', { maxTokens: 128_000 }],
  ['anthropic:claude-sonnet-4-20250514', { maxTokens: 200_000 }],
  ['anthropic:claude-opus-4', { maxTokens: 200_000 }],
  ['anthropic:claude-sonnet-4', { maxTokens: 200_000 }],
]);

function normalizeModelName(model: string): string {
  return model.toLowerCase().trim();
}

function buildKey(provider: string, model: string): string {
  return `${provider.toLowerCase()}:${normalizeModelName(model)}`;
}

function envKeyForModel(provider: string, model: string): string {
  const sanitized = model.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  return `${provider.toUpperCase()}_${sanitized}_MAX_CONTEXT_TOKENS`;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export function resolveContextWindow(
  provider: string,
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const globalOverride = parsePositiveInt(env.MAX_CONTEXT_TOKENS);
  if (globalOverride !== undefined) {
    return globalOverride;
  }

  const modelOverride = parsePositiveInt(env[envKeyForModel(provider, model)]);
  if (modelOverride !== undefined) {
    return modelOverride;
  }

  const builtIn = BUILT_IN_CONTEXT_WINDOWS.get(buildKey(provider, model));
  if (builtIn) {
    return builtIn.maxTokens;
  }

  debugLog('context-window', `Unknown model "${provider}:${model}", falling back to 128k`);
  return 128_000;
}

export function computeWindowRatio(usage: { totalTokens: number }, maxTokens: number): number {
  if (maxTokens <= 0) return 0;
  return Math.min(usage.totalTokens / maxTokens, 1);
}
