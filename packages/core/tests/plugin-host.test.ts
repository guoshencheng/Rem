import type {
  AgentPlugin,
  PluginRegistrationContext,
  PromptBuildContext,
  PromptSection,
} from 'rem-agent-core';
import { InvalidPluginNameError } from 'rem-agent-core';
import { describe, expect, it } from 'vitest';

const markerSection: PromptSection = {
  name: 'marker',
  render: (_ctx: PromptBuildContext) => 'marker',
};

describe('AgentPlugin public contract', () => {
  it('registers prompt sections synchronously', () => {
    const calls: string[] = [];
    const plugin: AgentPlugin = {
      name: 'example-plugin',
      register(context: PluginRegistrationContext): void {
        calls.push(plugin.name);
        context.systemPrompt.set(markerSection.name, markerSection);
      },
    };

    expect(plugin.name).toBe('example-plugin');
    expect(calls).toEqual([]);
    expect(new InvalidPluginNameError('Bad Name').pluginName).toBe('Bad Name');
  });
});
