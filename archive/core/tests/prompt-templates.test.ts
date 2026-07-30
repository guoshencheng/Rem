import { describe, it, expect } from 'vitest';
import { ClaudeAgentPromptTemplate } from '../src/system-prompt/templates/claude-template.js';
import { OpenAiAgentPromptTemplate } from '../src/system-prompt/templates/openai-template.js';

describe('prompt templates', () => {
  it('templates have no fs/url/path imports', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const f of ['claude-template.ts', 'openai-template.ts']) {
      const src = await readFile(new URL(`../src/system-prompt/templates/${f}`, import.meta.url), 'utf-8');
      expect(src).not.toMatch(/^import .* from '(node:)?(fs|url|path)/m);
    }
  });

  it('renders agent variables into inlined content', async () => {
    const t = new ClaudeAgentPromptTemplate();
    const out = await t.render({ agentName: 'TestAgent', agentCorePrompt: 'CORE' } as never);
    expect(out.length).toBeGreaterThan(100);
  });

  it('openai template renders inlined content', async () => {
    const t = new OpenAiAgentPromptTemplate();
    const out = await t.render({ agentName: 'TestAgent', agentCorePrompt: 'CORE' } as never);
    expect(out.length).toBeGreaterThan(100);
  });
});
