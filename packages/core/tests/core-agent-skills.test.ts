import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CoreAgent } from '../src/core-agent.js';
import { IterationBudget } from '../src/budget.js';
import { registerProvider, clearProviders } from '../src/llm/api-registry.js';

const createMockModel = (): any => ({ provider: 'test', modelId: 'test-model' });

describe('CoreAgent skill integration', () => {
  let tempDir: string;

  beforeEach(() => {
    clearProviders();
    tempDir = mkdtempSync(join(tmpdir(), 'agent-harness-core-skills-'));
    registerProvider('openai', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'Done!' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      },
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createSkill(name: string, description: string, body = '') {
    const skillDir = join(tempDir, name);
    mkdirSync(skillDir);
    const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
    writeFileSync(join(skillDir, 'SKILL.md'), content);
  }

  it('injects skill catalog into system prompt via FileSkillProvider', async () => {
    createSkill('github', 'Use gh for GitHub issues and PRs.');
    createSkill('pdf-processing', 'Handle PDF files.', 'Detailed body.');

    let capturedSystem = '';
    registerProvider('skill-capture-openai', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'Captured!' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      },
    });

    const { FileSkillProvider } = await import('../src/plugins/file-skill-provider.js');
    const skillProvider = new FileSkillProvider({ skillsDir: tempDir });

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      budget: new IterationBudget({ maxTurns: 5 }),
      provider: 'skill-capture-openai',
      providerConfig: { apiKey: 'key', model: 'model' },
      skillProvider,
    });

    await agent.initialize();
    const result = await agent.run({ content: 'List my GitHub issues' }).output;

    expect(result.content).toBe('Captured!');
  });

  it('createAgentFromEnv accepts custom skillProvider', async () => {
    createSkill('roll-dice', 'Roll dice.');

    registerProvider('env-openai', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'Env!' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      },
      resolveConfig: () => ({ apiKey: 'env-key', model: 'env-model' }),
    });

    const { FileSkillProvider } = await import('../src/plugins/file-skill-provider.js');
    const skillProvider = new FileSkillProvider({ skillsDir: tempDir });

    const { createAgentFromEnv } = await import('../src/core-agent.js');
    const created = createAgentFromEnv({ name: 'env-test', provider: 'env-openai', skillProvider });

    await created.initialize();
    const result = await created.run({ content: 'Hello' }).output;

    expect(result.content).toBe('Env!');
    expect(created['config'].skillProvider).toBe(skillProvider);
  });
});
