import type { PromptBuildContext, AgentPromptTemplateSelector, PromptSection, SystemPromptAssembler } from '../sdk/system-prompt.js';

export class DefaultSystemPromptAssembler implements SystemPromptAssembler {
  constructor(
    private templateSelector: AgentPromptTemplateSelector,
    private sections: PromptSection[],
  ) {}

  async assemble(ctx: PromptBuildContext): Promise<string> {
    const template = this.templateSelector.select(ctx);
    const parts: string[] = [await template.render(ctx)];
    for (const section of this.sections) {
      const content = await section.render(ctx);
      if (content) parts.push(content);
    }
    return parts.filter(Boolean).join('\n\n');
  }
}
