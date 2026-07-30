import { describe, it, expect } from 'vitest';
import { WorkspaceSection } from '../../../src/system-prompt/sections/workspace-section.js';
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

describe('WorkspaceSection', () => {
  it('returns undefined when workspaceRoot is empty', () => {
    const section = new WorkspaceSection();
    expect(section.render({ ...baseCtx, workspaceRoot: '' })).toBeUndefined();
  });

  it('shows workspace root and read-only status', () => {
    const section = new WorkspaceSection();
    const result = section.render({ ...baseCtx, readOnly: true });
    expect(result).toContain('## Workspace');
    expect(result).toContain('Working directory: /tmp');
    expect(result).toContain('Read-only mode: true');
  });
});
