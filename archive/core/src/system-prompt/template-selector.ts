import type { PromptBuildContext, AgentPromptTemplate, AgentPromptTemplateSelector } from '../sdk/system-prompt.js';

export class ProviderAwareTemplateSelector implements AgentPromptTemplateSelector {
  constructor(
    private defaultTemplate: AgentPromptTemplate,
    private providerTemplates: Record<string, AgentPromptTemplate>,
  ) {}

  select(ctx: PromptBuildContext): AgentPromptTemplate {
    const key = `${ctx.model.provider}/${ctx.model.model}`.toLowerCase();
    if (key.includes('openai') || key.includes('gpt')) {
      return this.providerTemplates['openai'] ?? this.defaultTemplate;
    }
    return this.defaultTemplate;
  }
}
