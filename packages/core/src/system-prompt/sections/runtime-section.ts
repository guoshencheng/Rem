import type { PromptBuildContext, PromptSection } from '../../sdk/system-prompt.js';

export class RuntimeSection implements PromptSection {
  readonly name = 'runtime';

  render(ctx: PromptBuildContext): string {
    const { agentName, model, runtime } = ctx;
    const parts = [
      `Agent: ${agentName}`,
      `Provider: ${model.provider}`,
      `Model: ${model.model}`,
      `Platform: ${runtime.platform}`,
      `Node: ${runtime.nodeVersion}`,
      `Date: ${runtime.today}`,
    ];
    return `## Runtime\n\n${parts.join(' | ')}`;
  }
}
