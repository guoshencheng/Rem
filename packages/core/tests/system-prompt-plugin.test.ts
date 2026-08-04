import type { AgentPlugin, PromptSectionRegistry } from 'rem-agent-core';
import { describe, expect, it } from 'vitest';
import { resolveSystemPrompt } from '../src/agent/context/resolve-system-prompt.js';
import { createFakeAssembly } from './helpers/fake-di.js';

const plugin: AgentPlugin = {
  name: 'prompt-customizer',
  register({ systemPrompt }) {
    systemPrompt.delete('safety');
    systemPrompt.set('company-policy', {
      name: 'company-policy',
      render: () => '## Company Policy\n\nUse the internal policy.',
    });
    systemPrompt.set('runtime', {
      name: 'runtime',
      render: (ctx) => `## Runtime Override\n\n${ctx.agentName}`,
    });
  },
};

async function renderPrompt(plugins: readonly AgentPlugin[] = []): Promise<string> {
  const { di, runtimeConfig } = await createFakeAssembly({ plugins });
  const configProvider = di.configProvider;
  return resolveSystemPrompt({
    di,
    runtimeConfig,
    resolution: {
      behavior: configProvider.getBehaviorConfig(),
      configProvider,
      effectiveModel: configProvider.getModelConfig(),
      agentRole: configProvider.resolveAgent(),
      workspaceRoot: '/',
    },
  });
}

describe('system prompt plugins', () => {
  it('preserves default behavior without plugins and keeps runtime last', async () => {
    const prompt = await renderPrompt();
    expect(prompt).toContain('## Safety');
    expect(prompt).toContain('## Runtime');
    const headings = [...prompt.matchAll(/^## .+$/gm)].map((match) => match[0]);
    expect(headings.at(-1)).toBe('## Runtime');
  });

  it('applies additions, deletion, and runtime replacement through AgentDI', async () => {
    const prompt = await renderPrompt([plugin]);
    expect(prompt).not.toContain('## Safety');
    expect(prompt).toContain('## Company Policy\n\nUse the internal policy.');
    expect(prompt.trimEnd().endsWith('## Runtime Override\n\nTestAgent')).toBe(true);
  });

  it('keeps the assembler snapshot stable after assembly', async () => {
    let retained: PromptSectionRegistry | undefined;
    const retainingPlugin: AgentPlugin = {
      name: 'retaining-plugin',
      register({ systemPrompt }) {
        retained = systemPrompt;
        systemPrompt.set('marker', { name: 'marker', render: () => 'initial marker' });
      },
    };
    const first = await renderPrompt([retainingPlugin]);
    expect(() => retained?.set('late', {
      name: 'late', render: () => 'late marker',
    })).toThrow('no longer active');
    expect(first).toContain('initial marker');
    expect(first).not.toContain('late marker');
  });
});
