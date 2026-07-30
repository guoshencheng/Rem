import { describe, it, expect } from 'vitest';

describe('runAgent platform neutrality', () => {
  it('run-agent.ts does not reference process.* directly', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/run-agent.ts', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/\bprocess\.(env|platform|version|cwd)\b/);
  });
});
