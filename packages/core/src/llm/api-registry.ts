import type { GenerateOptions, GenerateResult, ProviderConfig, StreamChunk } from './types.js';

export interface LLMProvider {
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
  resolveConfig?(env?: NodeJS.ProcessEnv): ProviderConfig;
}

const registry = new Map<string, LLMProvider>();

export function registerProvider(id: string, provider: LLMProvider): void {
  if (registry.has(id)) {
    throw new Error(`Provider "${id}" already registered`);
  }
  registry.set(id, provider);
}

export function resolveProvider(id: string): LLMProvider {
  const provider = registry.get(id);
  if (!provider) {
    throw new Error(
      `Unknown provider: "${id}". Available: ${listProviders().join(', ') || 'none'}`,
    );
  }
  return provider;
}

export function resolveProviderConfig(id: string, env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const provider = resolveProvider(id);
  if (!provider.resolveConfig) {
    throw new Error(`Provider "${id}" does not support config resolution`);
  }
  return provider.resolveConfig(env);
}

export function listProviders(): string[] {
  return [...registry.keys()];
}

export function clearProviders(): void {
  registry.clear();
}

export type { ProviderConfig } from './types.js';
