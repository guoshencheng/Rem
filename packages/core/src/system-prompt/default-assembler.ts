import type { SkillProvider } from '../sdk/skill-provider.js';
import { DefaultSystemPromptAssembler } from './assembler.js';
import { ProviderAwareTemplateSelector } from './template-selector.js';
import { ClaudeAgentPromptTemplate } from './templates/claude-template.js';
import { OpenAiAgentPromptTemplate } from './templates/openai-template.js';
import { ToolingSection } from './sections/tooling-section.js';
import { ExecutionBiasSection } from './sections/execution-bias-section.js';
import { SafetySection } from './sections/safety-section.js';
import { AgentsMdSection } from './sections/agents-md-section.js';
import { SkillsSection } from './sections/skills-section.js';
import { WorkspaceSection } from './sections/workspace-section.js';
import { RuntimeSection } from './sections/runtime-section.js';
import { ProjectAgentsMdLoader } from './loaders/project-agents-md-loader.js';

export function createDefaultSystemPromptAssembler(skillProvider: SkillProvider): DefaultSystemPromptAssembler {
  return new DefaultSystemPromptAssembler(
    new ProviderAwareTemplateSelector(
      new ClaudeAgentPromptTemplate(),
      { openai: new OpenAiAgentPromptTemplate() },
    ),
    [
      new ToolingSection(),
      new ExecutionBiasSection(),
      new SafetySection(),
      new AgentsMdSection(new ProjectAgentsMdLoader()),
      new SkillsSection(skillProvider),
      new WorkspaceSection(),
      new RuntimeSection(),
    ],
  );
}
