import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProjectAgentsMdLoader } from '../../../src/system-prompt/loaders/project-agents-md-loader.js';

describe('ProjectAgentsMdLoader', () => {
  it('returns undefined when AGENTS.md is missing', async () => {
    const loader = new ProjectAgentsMdLoader();
    const result = await loader.load('/nonexistent/path', 'Rem');
    expect(result).toBeUndefined();
  });

  it('loads and trims AGENTS.md content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rem-agent-test-'));
    await writeFile(join(dir, 'AGENTS.md'), '\n# Project Rules\n\nBe careful.\n\n');
    const loader = new ProjectAgentsMdLoader();
    const result = await loader.load(dir, 'Rem');
    expect(result).toBe('# Project Rules\n\nBe careful.');
    await rm(dir, { recursive: true, force: true });
  });

  it('returns undefined for empty AGENTS.md', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rem-agent-test-'));
    await writeFile(join(dir, 'AGENTS.md'), '   \n   ');
    const loader = new ProjectAgentsMdLoader();
    const result = await loader.load(dir, 'Rem');
    expect(result).toBeUndefined();
    await rm(dir, { recursive: true, force: true });
  });
});
