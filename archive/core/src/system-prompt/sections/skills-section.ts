import type { PromptBuildContext, PromptSection } from '../../sdk/system-prompt.js';
import type { SkillProvider, Skill } from '../../sdk/skill-provider.js';

export class SkillsSection implements PromptSection {
  readonly name = 'skills';

  constructor(private skillProvider: SkillProvider) {}

  render(ctx: PromptBuildContext): string | undefined {
    if (ctx.skills.length === 0) return undefined;
    const catalog = this.skillProvider.formatCatalog(ctx.skills as Skill[]);
    return catalog || undefined;
  }
}
