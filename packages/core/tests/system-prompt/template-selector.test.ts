import { describe, it, expect } from 'vitest';
import { ProviderAwareTemplateSelector } from '../../src/system-prompt/template-selector.js';
import { ClaudeAgentPromptTemplate } from '../../src/system-prompt/templates/claude-template.js';
import { OpenAiAgentPromptTemplate } from '../../src/system-prompt/templates/openai-template.js';
import type { PromptBuildContext } from '../../src/sdk/system-prompt.js';

const baseCtx = {
  agentName: 'Rem',
  workspaceRoot: '/tmp',
  readOnly: false,
  tools: [],
  skills: [],
  runtime: { platform: 'darwin', nodeVersion: 'v20.0.0', today: '2026-07-09', cwd: '/tmp' },
} as Omit<PromptBuildContext, 'model'>;

describe('ProviderAwareTemplateSelector', () => {
  const selector = new ProviderAwareTemplateSelector(
    new ClaudeAgentPromptTemplate(),
    { openai: new OpenAiAgentPromptTemplate() },
  );

  it('selects Claude template by default', async () => {
    const ctx = { ...baseCtx, model: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } as PromptBuildContext;
    const template = selector.select(ctx);
    const rendered = await template.render(ctx);
    expect(rendered).toContain('powered by Claude');
  });

  it('selects OpenAI template for GPT models', async () => {
    const ctx = { ...baseCtx, model: { provider: 'openai', model: 'gpt-4o' } } as PromptBuildContext;
    const template = selector.select(ctx);
    const rendered = await template.render(ctx);
    expect(rendered).toContain('powered by an OpenAI model');
  });

  it('replaces agentName placeholder', async () => {
    const ctx = { ...baseCtx, agentName: 'Coder', model: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } as PromptBuildContext;
    const template = selector.select(ctx);
    const rendered = await template.render(ctx);
    expect(rendered).toContain('You are Coder,');
  });
});
