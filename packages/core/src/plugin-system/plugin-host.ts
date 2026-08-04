import type { AgentPlugin } from '../sdk/agent-plugin.js';
import type { PromptSectionRegistryStore } from '../system-prompt/section-registry.js';
import {
  DuplicatePluginNameError,
  InvalidPluginNameError,
  PluginRegistrationError,
} from './errors.js';

const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function applyAgentPlugins(
  systemPrompt: PromptSectionRegistryStore,
  plugins: readonly AgentPlugin[],
): void {
  const names = new Set<string>();
  for (const plugin of plugins) {
    if (!PLUGIN_NAME_PATTERN.test(plugin.name)) {
      throw new InvalidPluginNameError(plugin.name);
    }
    if (names.has(plugin.name)) {
      throw new DuplicatePluginNameError(plugin.name);
    }
    names.add(plugin.name);
  }

  for (const plugin of plugins) {
    try {
      systemPrompt.transact(plugin.name, (registry) => {
        plugin.register({ systemPrompt: registry });
      });
    } catch (error) {
      throw new PluginRegistrationError(plugin.name, error);
    }
  }
}
