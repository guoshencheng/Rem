import { registerProvider } from '../api-registry.js';
import { openaiProvider } from './openai.js';
import { anthropicProvider } from './anthropic.js';

export function registerBuiltInProviders(): void {
  registerProvider('openai', openaiProvider);
  registerProvider('anthropic', anthropicProvider);
}

export { openaiProvider, anthropicProvider };
