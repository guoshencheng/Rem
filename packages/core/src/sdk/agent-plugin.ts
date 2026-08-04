import type { PromptSectionRegistry } from './system-prompt.js';

export interface PluginRegistrationContext {
  readonly systemPrompt: PromptSectionRegistry;
}

export interface AgentPlugin {
  readonly name: string;
  register(context: PluginRegistrationContext): void;
}
