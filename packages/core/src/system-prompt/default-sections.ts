import type { SkillProvider } from '../sdk/skill-provider.js';
import type { PromptSection } from '../sdk/system-prompt.js';
import { ProjectAgentsMdLoader } from './loaders/project-agents-md-loader.js';
import { AgentsMdSection } from './sections/agents-md-section.js';
import { ExecutionBiasSection } from './sections/execution-bias-section.js';
import { RuntimeSection } from './sections/runtime-section.js';
import { SafetySection } from './sections/safety-section.js';
import { SkillsSection } from './sections/skills-section.js';
import { ToolingSection } from './sections/tooling-section.js';
import { WorkspaceSection } from './sections/workspace-section.js';

export function createDefaultPromptSections(skillProvider: SkillProvider): PromptSection[] {
  return [
    new ToolingSection(),
    new ExecutionBiasSection(),
    new SafetySection(),
    new AgentsMdSection(new ProjectAgentsMdLoader()),
    new SkillsSection(skillProvider),
    new WorkspaceSection(),
    new RuntimeSection(),
  ];
}
