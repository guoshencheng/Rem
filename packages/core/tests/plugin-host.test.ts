import type {
  AgentPlugin,
  PluginRegistrationContext,
  PromptBuildContext,
  PromptSection,
} from 'rem-agent-core';
import {
  DuplicatePluginNameError,
  InvalidPluginNameError,
  PluginRegistrationError,
  ProtectedPromptSectionError,
} from 'rem-agent-core';
import { describe, expect, it } from 'vitest';
import { applyAgentPlugins } from '../src/plugin-system/plugin-host.js';
import { PromptSectionRegistryStore } from '../src/system-prompt/section-registry.js';

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

const coreSections = (): PromptSection[] => [
  { name: 'base', render: () => 'base' },
  { name: 'runtime', render: () => 'runtime' },
];

describe('applyAgentPlugins', () => {
  it('applies plugins in array order with last-write-wins', async () => {
    const store = new PromptSectionRegistryStore(coreSections());
    const plugins: AgentPlugin[] = [
      {
        name: 'plugin-a',
        register: ({ systemPrompt }) => systemPrompt.set(
          'base', { name: 'base', render: () => 'a' },
        ),
      },
      {
        name: 'plugin-b',
        register: ({ systemPrompt }) => systemPrompt.set(
          'base', { name: 'base', render: () => 'b' },
        ),
      },
    ];

    applyAgentPlugins(store, plugins);

    expect(await store.finalize()[0].render({} as never)).toBe('b');
    expect(store.diagnostics()[0].history).toEqual(['core', 'plugin-a', 'plugin-b']);
  });

  it('rejects invalid and duplicate plugin names before partial execution', () => {
    const invalid = new PromptSectionRegistryStore(coreSections());
    expect(() => applyAgentPlugins(invalid, [{ name: 'Bad Name', register: () => {} }]))
      .toThrow(InvalidPluginNameError);

    const duplicate = new PromptSectionRegistryStore(coreSections());
    expect(() => applyAgentPlugins(duplicate, [
      { name: 'same', register: () => {} },
      { name: 'same', register: () => {} },
    ])).toThrow(DuplicatePluginNameError);
    expect(duplicate.diagnostics().every((item) => item.source === 'core')).toBe(true);
  });

  it('wraps plugin errors and rolls back all operations from that plugin', () => {
    const store = new PromptSectionRegistryStore(coreSections());

    expect(() => applyAgentPlugins(store, [{
      name: 'broken-plugin',
      register({ systemPrompt }) {
        systemPrompt.set('temporary', { name: 'temporary', render: () => 'temporary' });
        systemPrompt.delete('runtime');
      },
    }])).toThrow(PluginRegistrationError);

    try {
      applyAgentPlugins(new PromptSectionRegistryStore(coreSections()), [{
        name: 'broken-plugin',
        register: ({ systemPrompt }) => systemPrompt.delete('runtime'),
      }]);
    } catch (error) {
      expect(error).toBeInstanceOf(PluginRegistrationError);
      expect((error as PluginRegistrationError).pluginName).toBe('broken-plugin');
      expect((error as Error).cause).toBeInstanceOf(ProtectedPromptSectionError);
    }
    expect(store.finalize().map((item) => item.name)).toEqual(['base', 'runtime']);
  });
});
