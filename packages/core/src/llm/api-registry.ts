import type { GenerateOptions, GenerateResult, StreamChunk } from './types.js';

export interface LLMProvider {
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
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

export function listProviders(): string[] {
  return [...registry.keys()];
}

export function clearProviders(): void {
  registry.clear();
}
