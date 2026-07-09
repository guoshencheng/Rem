import { describe, it, expect } from 'vitest';
import { ToolingSection } from '../../../src/system-prompt/sections/tooling-section.js';
import type { PromptBuildContext } from '../../../src/sdk/system-prompt.js';

const baseCtx: PromptBuildContext = {
  agentName: 'Rem',
  workspaceRoot: '/tmp',
  readOnly: false,
  tools: [],
  skills: [],
  model: { provider: 'openai', model: 'gpt-4o' },
  runtime: { platform: 'darwin', nodeVersion: 'v20.0.0', today: '2026-07-09', cwd: '/tmp' },
};

describe('ToolingSection', () => {
  it('returns undefined when no tools', () => {
    const section = new ToolingSection();
    expect(section.render(baseCtx)).toBeUndefined();
  });

  it('lists tools with descriptions', () => {
    const section = new ToolingSection();
    const ctx = { ...baseCtx, tools: [{ name: 'read', description: 'Read file contents' }] };
    const result = section.render(ctx);
    expect(result).toContain('## Tooling');
    expect(result).toContain('- read: Read file contents');
    expect(result).toContain('Names are case-sensitive');
  });
});
