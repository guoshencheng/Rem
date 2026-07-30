import { describe, it, expect } from 'vitest';
import { RuntimeSection } from '../../../src/system-prompt/sections/runtime-section.js';
import type { PromptBuildContext } from '../../../src/sdk/system-prompt.js';

const ctx: PromptBuildContext = {
  agentName: 'Rem',
  workspaceRoot: '/tmp',
  readOnly: false,
  tools: [],
  skills: [],
  model: { provider: 'openai', model: 'gpt-4o' },
  runtime: { platform: 'darwin', nodeVersion: 'v20.0.0', today: '2026-07-09', cwd: '/tmp' },
};

describe('RuntimeSection', () => {
  it('contains runtime info', () => {
    const section = new RuntimeSection();
    const result = section.render(ctx);
    expect(result).toContain('## Runtime');
    expect(result).toContain('Agent: Rem');
    expect(result).toContain('Provider: openai');
    expect(result).toContain('Model: gpt-4o');
    expect(result).toContain('Platform: darwin');
    expect(result).toContain('Date: 2026-07-09');
  });
});
