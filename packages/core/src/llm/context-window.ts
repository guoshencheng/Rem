import type { Models } from '@earendil-works/pi-ai';

const DEFAULT_CONTEXT_WINDOW = 1_000_000;

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
  models?: Models,
): number {
  const globalOverride = parsePositiveInt(env.MAX_CONTEXT_TOKENS);
  if (globalOverride !== undefined) {
    return globalOverride;
  }

  const modelOverride = parsePositiveInt(env[envKeyForModel(provider, model)]);
  if (modelOverride !== undefined) {
    return modelOverride;
  }

  const known = models?.getModel(provider, model);
  if (known?.contextWindow) {
    return known.contextWindow;
  }

  return DEFAULT_CONTEXT_WINDOW;
}

export function computeWindowRatio(usage: { totalTokens: number }, maxTokens: number): number {
  if (maxTokens <= 0) return 0;
  return Math.min(usage.totalTokens / maxTokens, 1);
}
