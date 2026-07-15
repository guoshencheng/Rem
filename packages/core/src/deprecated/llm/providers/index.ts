import { registerProvider, resolveProvider } from '../api-registry.js';
import { openaiProvider } from './openai.js';
import { anthropicProvider } from './anthropic.js';

function registerIfMissing(id: string, provider: any): void {
  try {
    resolveProvider(id);
  } catch {
    registerProvider(id, provider);
  }
}

export function registerBuiltInProviders(): void {
  registerIfMissing('openai', openaiProvider);
  registerIfMissing('anthropic', anthropicProvider);
}

export { openaiProvider, anthropicProvider };
