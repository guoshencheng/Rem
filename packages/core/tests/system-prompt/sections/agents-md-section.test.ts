import { describe, it, expect } from 'vitest';
import { AgentsMdSection } from '../../../src/system-prompt/sections/agents-md-section.js';
import type { PromptBuildContext, AgentInstructionLoader } from '../../../src/sdk/system-prompt.js';

const baseCtx: PromptBuildContext = {
  agentName: 'Rem',
  workspaceRoot: '/tmp',
  readOnly: false,
  tools: [],
  skills: [],
  model: { provider: 'openai', model: 'gpt-4o' },
  runtime: { platform: 'darwin', nodeVersion: 'v20.0.0', today: '2026-07-09', cwd: '/tmp' },
};

describe('AgentsMdSection', () => {
  it('returns undefined when loader returns empty', async () => {
    const loader: AgentInstructionLoader = { load: async () => undefined };
    const section = new AgentsMdSection(loader);
    const result = await section.render(baseCtx);
    expect(result).toBeUndefined();
  });

  it('wraps loaded content with heading', async () => {
    const loader: AgentInstructionLoader = { load: async () => '# Rules\n\nBe careful.' };
    const section = new AgentsMdSection(loader);
    const result = await section.render(baseCtx);
    expect(result).toContain('## Project Instructions');
    expect(result).toContain('# Rules\n\nBe careful.');
  });
});
