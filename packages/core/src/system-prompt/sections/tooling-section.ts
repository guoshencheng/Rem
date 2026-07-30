import type { PromptBuildContext, PromptSection } from '../../sdk/system-prompt.js';

export class ToolingSection implements PromptSection {
  readonly name = 'tooling';

  render(ctx: PromptBuildContext): string | undefined {
    if (ctx.tools.length === 0) return undefined;
    const lines = [
      '## Tooling',
      '',
      'You have access to the following tools. Names are case-sensitive; call exactly as listed.',
      '',
      ...ctx.tools.map((t) => `- ${t.name}: ${t.description}`),
    ];
    return lines.join('\n');
  }
}
