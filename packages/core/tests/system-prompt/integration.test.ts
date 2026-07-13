import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DefaultSystemPromptAssembler,
  ProviderAwareTemplateSelector,
  ClaudeAgentPromptTemplate,
  OpenAiAgentPromptTemplate,
  ToolingSection,
  ExecutionBiasSection,
  SafetySection,
  WorkspaceSection,
  AgentsMdSection,
  SkillsSection,
  RuntimeSection,
  ProjectAgentsMdLoader,
} from '../../src/system-prompt/index.js';
import type { PromptBuildContext } from '../../src/sdk/system-prompt.js';
import type { SkillProvider } from '../../src/sdk/skill-provider.js';
import { vi } from 'vitest';

function buildAssembler(skillProvider: SkillProvider) {
  return new DefaultSystemPromptAssembler(
    new ProviderAwareTemplateSelector(
      new ClaudeAgentPromptTemplate(),
      { openai: new OpenAiAgentPromptTemplate() },
    ),
    [
      new ToolingSection(),
      new ExecutionBiasSection(),
      new SafetySection(),
      new WorkspaceSection(),
      new AgentsMdSection(new ProjectAgentsMdLoader()),
      new SkillsSection(skillProvider),
      new RuntimeSection(),
    ],
  );
}

const baseCtx: PromptBuildContext = {
  agentName: 'Rem',
  workspaceRoot: '/tmp',
  readOnly: false,
  tools: [{ name: 'read', description: 'Read file' }],
  skills: [{ name: 'test', description: 'A skill', location: '/tmp/test', content: '' }],
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  runtime: { platform: 'darwin', nodeVersion: 'v20.0.0', today: '2026-07-09', cwd: '/tmp' },
  agentCorePrompt: 'You help users with software engineering and daily tasks by using the tools available to you.',
};

describe('system prompt integration', () => {
  it('generates full prompt for Claude model', async () => {
    const skillProvider: SkillProvider = {
      loadSkills: vi.fn(),
      formatCatalog: () => '<available_skills><skill><name>test</name></skill></available_skills>',
      readSkillRaw: vi.fn(),
    };
    const assembler = buildAssembler(skillProvider);
    const dir = await mkdtemp(join(tmpdir(), 'rem-agent-test-'));
    await writeFile(join(dir, 'AGENTS.md'), '# Project Rules\n\nAlways test.');
    const ctx = { ...baseCtx, workspaceRoot: dir };
    const result = await assembler.assemble(ctx);
    expect(result).toContain('You are Rem,');
    expect(result).toContain('## Tooling');
    expect(result).toContain('## Project Instructions');
    expect(result).toContain('## Runtime');
    expect(result.replaceAll(dir, '/tmp/rem-agent-test')).toMatchSnapshot();
    await rm(dir, { recursive: true, force: true });
  });

  it('generates full prompt for OpenAI model', async () => {
    const skillProvider: SkillProvider = {
      loadSkills: vi.fn(),
      formatCatalog: () => '',
      readSkillRaw: vi.fn(),
    };
    const assembler = buildAssembler(skillProvider);
    const ctx = { ...baseCtx, model: { provider: 'openai', model: 'gpt-4o' }, skills: [] };
    const result = await assembler.assemble(ctx);
    expect(result).toContain('powered by an OpenAI model');
    expect(result).not.toContain('## Project Instructions');
    expect(result).toMatchSnapshot();
  });
});
