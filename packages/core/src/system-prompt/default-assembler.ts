import type { AgentPlugin } from '../sdk/agent-plugin.js';
import type { SkillProvider } from '../sdk/skill-provider.js';
import { applyAgentPlugins } from '../plugin-system/plugin-host.js';
import { DefaultSystemPromptAssembler } from './assembler.js';
import { createDefaultPromptSections } from './default-sections.js';
import { PromptSectionRegistryStore } from './section-registry.js';
import { ProviderAwareTemplateSelector } from './template-selector.js';
import { ClaudeAgentPromptTemplate } from './templates/claude-template.js';
import { OpenAiAgentPromptTemplate } from './templates/openai-template.js';

export function createDefaultSystemPromptAssembler(
  skillProvider: SkillProvider,
  plugins: readonly AgentPlugin[] = [],
): DefaultSystemPromptAssembler {
  const sections = new PromptSectionRegistryStore(createDefaultPromptSections(skillProvider));
  applyAgentPlugins(sections, plugins);
  return new DefaultSystemPromptAssembler(
    new ProviderAwareTemplateSelector(
      new ClaudeAgentPromptTemplate(),
      { openai: new OpenAiAgentPromptTemplate() },
    ),
    sections.finalize(),
  );
}
